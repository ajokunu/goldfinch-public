/**
 * Lambda entry point for the SyncCompleted event (P7-8).
 *
 * The sync Lambda emits one EventBridge event per run on the default bus
 * (source SYNC_EVENT_SOURCE 'goldfinch.sync', detail-type
 * SYNC_COMPLETED_DETAIL_TYPE 'SyncCompleted', detail { runId, status,
 * household, newTxnCount? }); an EventBridge rule routes it here. The handler
 * also accepts the bare detail object for direct async invokes in tests.
 *
 * One event drives BOTH notification classes:
 *  - sync push: "Sync complete -- N new transactions", only when the detail
 *    carries a positive new-row count and sync prefs are on.
 *  - budget push: the handler computes the current month's per-category spend
 *    from the table (same row set as the API's GET /budgets, see budget.ts),
 *    evaluates 80%/100% thresholds with the SHARED budgetMath floor helper,
 *    and notifies each newly crossed category once per period.
 *
 * Marker-after-send (the P7-8 bug fix): SENTNOTIF# dedup markers are written
 * ONLY after the Expo relay accepted the message. Existing markers are READ
 * up front to decide what to send; nothing is written before the send, so a
 * failed send leaves no marker and the next SyncCompleted run retries.
 *
 * Degraded mode (P7-8): a missing Expo access token, relay rejections, and
 * DeviceNotRegistered tokens are structured-logged (with token cleanup where
 * applicable) -- they never crash the handler.
 */

import {
  DEFAULT_TZ,
  SYNC_COMPLETED_DETAIL_TYPE,
} from '@goldfinch/shared/constants';
import { isoDateInTz } from '@goldfinch/shared/dates';
import { createLogger, type Logger } from '@goldfinch/shared/logger';
import type { IsoMonth, SyncRunStatus, UserProfileItem } from '@goldfinch/shared/types';
import {
  buildSentNotifItem,
  evaluateBudgetThresholds,
  spendByCategory,
  type ThresholdCrossing,
} from './budget.js';
import { sentNotifSk } from './keys.js';
import {
  buildBudgetThresholdMessage,
  buildSyncCompleteMessage,
} from './payload.js';
import { sendNotifications, type KindedMessage, type SendDeps } from './send.js';
import type { HandlerResult, SyncCompletedDetail } from './types.js';

export class EventParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventParseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SYNC_RUN_STATUSES: readonly SyncRunStatus[] = ['success', 'partial', 'error'];

function optionalCount(detail: Record<string, unknown>, field: string): number | undefined {
  const value = detail[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new EventParseError(`${field} must be a non-negative integer when present`);
  }
  return value;
}

function parseDetail(detail: Record<string, unknown>): SyncCompletedDetail {
  const { runId, status, household } = detail;
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new EventParseError('SyncCompleted detail requires a non-empty runId');
  }
  if (typeof status !== 'string' || !SYNC_RUN_STATUSES.includes(status as SyncRunStatus)) {
    throw new EventParseError(
      `SyncCompleted detail requires status in ${SYNC_RUN_STATUSES.join('|')}, got "${String(status)}"`,
    );
  }
  if (typeof household !== 'string' || household.length === 0) {
    throw new EventParseError('SyncCompleted detail requires a non-empty household');
  }
  const newTxnCount = optionalCount(detail, 'newTxnCount');
  const txnsUpserted = optionalCount(detail, 'txnsUpserted');
  return {
    runId,
    status: status as SyncRunStatus,
    household,
    ...(newTxnCount !== undefined ? { newTxnCount } : {}),
    ...(txnsUpserted !== undefined ? { txnsUpserted } : {}),
    ...(typeof detail.syncedAt === 'string' ? { syncedAt: detail.syncedAt } : {}),
  };
}

/**
 * Accepts an EventBridge envelope (detail-type 'SyncCompleted') or the bare
 * detail object from a direct Lambda invoke. Throws EventParseError on
 * anything else -- a malformed event is an emitter bug, and the Lambda async
 * retry/DLQ path is the right place for it to land.
 */
export function parseSyncCompletedEvent(raw: unknown): SyncCompletedDetail {
  if (!isRecord(raw)) {
    throw new EventParseError('event must be a JSON object');
  }
  const detailType = raw['detail-type'];
  if (detailType !== undefined) {
    if (detailType !== SYNC_COMPLETED_DETAIL_TYPE) {
      throw new EventParseError(`unknown detail-type "${String(detailType)}"`);
    }
    if (!isRecord(raw.detail)) {
      throw new EventParseError('SyncCompleted event requires a detail object');
    }
    return parseDetail(raw.detail);
  }
  return parseDetail(raw);
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export interface NotifPrefs {
  sync: boolean;
  budget: boolean;
}

interface NotifPrefsShape {
  sync?: unknown;
  budget?: unknown;
}

/**
 * Household-level preference resolution. Prefs live on each PROFILE item as
 * `settings.notifPrefs = { sync?: boolean, budget?: boolean }` and default ON.
 * Because PUSHTOKEN# rows are not attributed to a Cognito user, delivery is
 * household-wide: a kind is disabled only when EVERY profile explicitly sets it
 * to false. (Per-user muting belongs on the device via Android channels / iOS
 * notification settings until tokens carry an owner sub.)
 */
export function resolveNotifPrefs(profiles: readonly UserProfileItem[]): NotifPrefs {
  const resolve = (kind: keyof NotifPrefs): boolean => {
    if (profiles.length === 0) return true;
    return profiles.some((profile) => {
      const prefs = profile.settings?.notifPrefs as NotifPrefsShape | undefined;
      return prefs?.[kind] !== false;
    });
  };
  return { sync: resolve('sync'), budget: resolve('budget') };
}

// ---------------------------------------------------------------------------
// Event processing
// ---------------------------------------------------------------------------

export interface HandlerDeps extends SendDeps {
  /** True when the Expo access token could not be loaded (degraded mode). */
  degraded?: boolean;
}

interface BudgetPlan {
  crossings: ThresholdCrossing[];
  skippedReason?: 'prefs-disabled' | 'no-budgets' | 'no-thresholds-crossed';
}

async function planBudgetMessages(
  deps: HandlerDeps,
  prefs: NotifPrefs,
  period: IsoMonth,
): Promise<BudgetPlan> {
  if (!prefs.budget) {
    return { crossings: [], skippedReason: 'prefs-disabled' };
  }
  const budgets = await deps.store.loadBudgets();
  if (budgets.length === 0) {
    return { crossings: [], skippedReason: 'no-budgets' };
  }
  const [categories, transactions, existingMarkers] = await Promise.all([
    deps.store.loadCategories(),
    deps.store.loadMonthTransactions(period),
    deps.store.listSentNotifs(period),
  ]);
  const spend = spendByCategory(transactions);
  const allCrossings = evaluateBudgetThresholds({ spend, budgets, categories });

  // READ-ONLY dedup: a crossing is sendable only when its highest threshold
  // has no marker yet. Markers are written after the send succeeds.
  const marked = new Set(existingMarkers.map((marker) => marker.SK));
  const crossings = allCrossings.filter(
    (crossing) => !marked.has(sentNotifSk(period, crossing.categoryId, crossing.threshold)),
  );
  if (crossings.length === 0) {
    return { crossings, skippedReason: 'no-thresholds-crossed' };
  }
  return { crossings };
}

/** Pure-DI core, exercised directly by unit tests. */
export async function processSyncCompleted(
  detail: SyncCompletedDetail,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const logger = deps.logger.child({ runId: detail.runId });
  const result: HandlerResult = {
    runId: detail.runId,
    status: detail.status,
    attempted: 0,
    accepted: 0,
    disabledTokens: [],
    notifiedCategories: [],
    retryCategories: [],
    degraded: deps.degraded === true,
  };

  if (detail.household !== deps.household) {
    logger.warn('ignoring SyncCompleted event for a different household', {
      eventHousehold: detail.household,
      configuredHousehold: deps.household,
    });
    return { ...result, skippedReason: 'household-mismatch' };
  }
  if (detail.status === 'error') {
    logger.info('sync run failed; skipping notifications (sync alarms own failures)');
    return { ...result, skippedReason: 'sync-error' };
  }

  const now = deps.now ?? (() => new Date());
  const period: IsoMonth = isoDateInTz(now(), DEFAULT_TZ).slice(0, 7);
  const prefs = resolveNotifPrefs(await deps.store.loadProfiles());

  // --- sync-complete push ------------------------------------------------
  const newTxnCount = detail.newTxnCount ?? detail.txnsUpserted;
  const messages: KindedMessage[] = [];
  let syncMessageIndex = -1;
  if (!prefs.sync) {
    result.syncSkippedReason = 'prefs-disabled';
  } else if (newTxnCount === undefined) {
    logger.info('SyncCompleted detail carries no transaction count; skipping sync push');
    result.syncSkippedReason = 'unknown-count';
  } else if (newTxnCount <= 0) {
    result.syncSkippedReason = 'no-new-transactions';
  } else {
    syncMessageIndex = messages.length;
    messages.push({ kind: 'sync', message: buildSyncCompleteMessage(newTxnCount) });
  }

  // --- budget-threshold push ----------------------------------------------
  const plan = await planBudgetMessages(deps, prefs, period);
  if (plan.skippedReason !== undefined) {
    result.budgetSkippedReason = plan.skippedReason;
  }
  const budgetMessageIndex = new Map<number, ThresholdCrossing>();
  for (const crossing of plan.crossings) {
    budgetMessageIndex.set(messages.length, crossing);
    messages.push({
      kind: 'budget',
      message: buildBudgetThresholdMessage(
        crossing.categoryName,
        crossing.categoryId,
        crossing.pctUsed,
      ),
    });
  }

  if (messages.length === 0) {
    logger.info('nothing to send', {
      syncSkippedReason: result.syncSkippedReason,
      budgetSkippedReason: result.budgetSkippedReason,
    });
    return result;
  }

  // --- send, then mark successes (P7-8 marker-after-send) -----------------
  const outcome = await sendNotifications({ ...deps, logger }, messages);
  result.attempted = outcome.attempted;
  result.accepted = outcome.accepted.filter(Boolean).length;
  result.disabledTokens = outcome.disabledTokens;

  if (syncMessageIndex >= 0 && outcome.accepted[syncMessageIndex] !== true) {
    logger.warn('sync-complete push was not accepted by the relay', {
      newTxnCount,
    });
  }

  for (const [index, crossing] of budgetMessageIndex) {
    if (outcome.accepted[index] !== true) {
      // No marker: the next SyncCompleted run re-evaluates and retries.
      result.retryCategories.push(crossing.categoryId);
      logger.warn('budget push not accepted; marker withheld for retry', {
        categoryId: crossing.categoryId,
        threshold: crossing.threshold,
      });
      continue;
    }
    // Mark every reached threshold (not just the highest), so a category that
    // jumped straight past 80% to 100% never gets a late, stale 80% push.
    for (const threshold of crossing.crossedThresholds) {
      const created = await deps.store.tryPutSentNotif(
        buildSentNotifItem(period, crossing.categoryId, threshold, now(), deps.household),
      );
      if (!created) {
        logger.info('dedup marker already existed (concurrent run)', {
          categoryId: crossing.categoryId,
          threshold,
        });
      }
    }
    result.notifiedCategories.push(crossing.categoryId);
  }

  logger.info('SyncCompleted event processed', { ...result });
  return result;
}

/**
 * Lambda entry point. Real AWS dependencies are loaded lazily (dynamic import)
 * so importing this module in tests never touches the AWS SDK.
 */
export async function handler(event: unknown): Promise<HandlerResult> {
  const logger = createLogger({ base: { service: 'notifications' } });
  const detail = parseSyncCompletedEvent(event);
  const { getRuntimeDeps } = await import('./aws.js');
  return processSyncCompleted(detail, await getRuntimeDeps(logger));
}

export default handler;
