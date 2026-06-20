/**
 * GoldFinch daily SimpleFIN sync Lambda (master plan parts 9 + 10).
 *
 * Invoked once a day by EventBridge Scheduler (cron(0 9 * * ? *) ET). Flow:
 *   1. Read the access URL from SSM (module-scope cache with TTL; CMK-decrypt).
 *   2. Read SYNC#STATE; compute the window start (cursor - overlap, clamped to
 *      the 90-day history cap).
 *   3. One GET /accounts?start-date=...&pending=1&version=2 with in-Lambda
 *      retry on 429/5xx only.
 *   4. Normalize (shared normalizer + sync enrichment: amountRaw, balanceRaw,
 *      isLiability, payeeLower) and idempotently upsert: TXNPTR pointers,
 *      crash-safe pending->posted re-keying, BatchWrite for new rows with
 *      UnprocessedItems backoff, and attribute-scoped UpdateCommands for
 *      existing rows so user edits (category/note/transfer) are never touched.
 *   5. Write SYNC#STATE (per-account status + per-account cursors, errlist,
 *      window). An account's cursor advances only when the run fully
 *      persisted AND its window covered the account's gap; the window derives
 *      from the healthy accounts' cursors (see state.ts).
 *   6. Post-upsert passes, only after the run fully persisted (Phase 7):
 *      a. P7-1 recurrence detection (shared detector) -> RECURRING# upserts
 *         that preserve user confirm/ignore status;
 *      b. P7-3 SimpleFIN holdings -> HOLDING# replace-per-account;
 *      c. P7-4 daily NETWORTH#<date> snapshot from the stored ACCT# items.
 *      Failures here propagate (idempotent writes; the alarm pages and the
 *      next run repairs) — but the cursor already advanced, so bank data is
 *      never re-pulled because of a post-pass failure.
 *   7. Emit the SyncCompleted EventBridge event (P7-8). Emission failure is
 *      logged loudly but NEVER fails the run.
 *   8. Emit EMF metrics (GoldFinch/Sync: TxnsUpserted, AccountsSynced,
 *      SyncErrors, TerminalErrors) and rethrow terminal/hard failures so the
 *      Lambda Errors alarm and the Scheduler DLQ fire.
 *
 * SECURITY: the access URL is the only secret. It is never logged; SimpleFIN
 * errors from the shared client carry the host only.
 */

import { randomUUID } from 'node:crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createLogger, type LogSink } from '@goldfinch/shared/logger';
import {
  SimpleFinAuthError,
  SimpleFinPaymentRequiredError,
  parseAccessUrl,
  type FetchLike,
} from '@goldfinch/shared/simplefin';
import type { IsoDate, SyncRunStatus } from '@goldfinch/shared/types';
import type { Context } from 'aws-lambda';

import { loadEnv } from './env.js';
import { emitSyncCompleted, type PutEventsFn } from './events.js';
import { fetchAccountsWithRetry } from './fetch-retry.js';
import {
  applyHoldingsSupported,
  ingestHoldings,
  loadPriorAccountState,
} from './holdings.js';
import { emitSyncMetrics, type MetricsWriter, type SyncMetrics } from './metrics.js';
import { writeNetWorthSnapshot } from './networth.js';
import { normalizeForSync } from './normalize.js';
import { runRecurrencePass } from './recurring.js';
import {
  AccessUrlMissingError,
  getAccessUrl,
  type SsmClientLike,
} from './secrets.js';
import {
  buildFailureState,
  buildRunState,
  clearSyncRunning,
  computeWindowStart,
  readSyncState,
  writeSyncState,
} from './state.js';
import type { SyncStateRecord } from './types.js';
import {
  SyncWriteIncompleteError,
  upsertSyncItems,
  type DocClient,
  type SleepFn,
} from './writer.js';

export interface HandlerDeps {
  ssmClient?: SsmClientLike;
  docClient?: DocClient;
  fetchImpl?: FetchLike;
  /** Clock injection for tests. */
  now?: () => Date;
  /** EMF sink injection for tests. */
  metricsWrite?: MetricsWriter;
  /** Backoff sleep injection for tests (writer + fetch retry). */
  sleep?: SleepFn;
  /** EventBridge PutEvents injection for tests (P7-8). */
  putEvents?: PutEventsFn;
  /** Structured-logger sink injection for tests. */
  logSink?: LogSink;
}

export interface SyncRunSummary {
  runId: string;
  status: SyncRunStatus;
  accountsSynced: number;
  txnsUpserted: number;
  staleDeletes: number;
  errlistCount: number;
  windowStartEpoch: number;
  /** P7-1: RECURRING# items upserted by this run's detection pass. */
  recurringSeriesUpserted: number;
  /** P7-3: HOLDING# items written this run (replace-per-account). */
  holdingsWritten: number;
  /** P7-4: calendar date (DEFAULT_TZ) of the NETWORTH# snapshot written. */
  netWorthSnapshotDate: IsoDate;
  /** P7-8: whether EventBridge accepted the SyncCompleted event. */
  syncCompletedEventEmitted: boolean;
}

// Module-scope clients for warm reuse; created lazily so tests that inject
// fakes never touch the real SDK clients.
let defaultSsm: SsmClientLike | undefined;
let defaultDoc: DocClient | undefined;

function ssmClient(): SsmClientLike {
  defaultSsm ??= new SSMClient({});
  return defaultSsm;
}

function docClient(): DocClient {
  defaultDoc ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return defaultDoc;
}

/** Terminal = retries cannot fix it; a human must act (runbook). */
function isTerminal(err: unknown): boolean {
  return (
    err instanceof SimpleFinAuthError ||
    err instanceof SimpleFinPaymentRequiredError ||
    err instanceof AccessUrlMissingError
  );
}

function errorCode(err: unknown): string {
  if (err instanceof SimpleFinPaymentRequiredError) return 'simplefin.402';
  if (err instanceof SimpleFinAuthError) return 'simplefin.403';
  if (err instanceof AccessUrlMissingError) return 'secrets.missing';
  if (err instanceof SyncWriteIncompleteError) return 'dynamo.unprocessed';
  return 'sync.error';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createHandler(deps: HandlerDeps = {}) {
  return async function syncHandler(
    _event: unknown,
    context?: Context,
  ): Promise<SyncRunSummary> {
    const runId = context?.awsRequestId ?? randomUUID();
    // Shared structured logger (P7-10): JSON lines with service + runId on
    // every line.
    const logger = createLogger({
      base: { service: 'sync', runId },
      sink: deps.logSink,
    });
    const env = loadEnv();
    const nowDate = deps.now?.() ?? new Date();
    const nowEpoch = Math.trunc(nowDate.getTime() / 1000);
    const nowIso = nowDate.toISOString();
    const ddb = deps.docClient ?? docClient();

    const metrics: SyncMetrics = {
      TxnsUpserted: 0,
      AccountsSynced: 0,
      SyncErrors: 0,
      TerminalErrors: 0,
    };

    let previousState: SyncStateRecord | null = null;
    let stateWritten = false;

    try {
      const accessUrl = await getAccessUrl(env.simplefinParamName, {
        client: deps.ssmClient ?? ssmClient(),
      });
      // parseAccessUrl strips credentials; only the host is ever logged.
      const { host } = parseAccessUrl(accessUrl);

      previousState = await readSyncState(ddb, env.tableName, env.householdId);
      const earliestEpoch = nowEpoch - env.maxHistoryDays * 86_400;
      const windowStartEpoch = computeWindowStart(
        previousState,
        nowEpoch,
        env.overlapBufferDays,
        env.maxHistoryDays,
      );
      logger.info('sync run started', { host, windowStartEpoch });

      const accountSet = await fetchAccountsWithRetry(
        accessUrl,
        { startDate: windowStartEpoch, pending: true },
        { fetchImpl: deps.fetchImpl, sleep: deps.sleep, logger },
      );

      // Prior per-account state (one begins_with Query over the ACCT# rows),
      // read BEFORE normalize/upsert. Feeds two sticky behaviors from the same
      // stored rows: (1) priorInvestmentIds so a transient empty/absent
      // holdings payload no longer flips a known investment account to 'other'
      // (which would also mis-sign that run's 401k contribution as spend), and
      // (2) holdingsSupported -- sticky "ever returned a holdings array" --
      // merged onto the fresh items so the account writer SETs the merged value
      // (P8-4: attribute-scoped, never REMOVEs the flag, never touches overrides).
      const priorAccountState = await loadPriorAccountState(
        ddb,
        env.tableName,
        env.householdId,
      );
      const normalized = normalizeForSync(accountSet, {
        household: env.householdId,
        now: nowDate,
        accountTypes: env.accountTypes,
        priorInvestmentIds: priorAccountState.investmentIds,
      });
      applyHoldingsSupported(
        normalized.accounts,
        accountSet.accounts,
        priorAccountState.holdingsSupported,
      );
      logger.info('simplefin payload fetched', {
        accounts: normalized.accounts.length,
        transactions: normalized.transactions.length,
        errlistCount: normalized.errlist.length,
      });
      if (normalized.errlist.length > 0) {
        // Institution-level failures also persist to SYNC#STATE, but P7-10
        // wants them findable with a level=warn CloudWatch Insights filter.
        logger.warn('simplefin reported institution errors', {
          errlist: normalized.errlist.map(({ code, msg }) => ({ code, msg })),
        });
      }

      const result = await upsertSyncItems(normalized, {
        docClient: ddb,
        tableName: env.tableName,
        household: env.householdId,
        sleep: deps.sleep,
        logger,
      });

      metrics.TxnsUpserted = result.txnsUpserted;
      metrics.AccountsSynced = result.accountsUpserted;
      metrics.SyncErrors = normalized.errlist.length;

      const fullyPersisted = result.unprocessedCount === 0;
      const status: SyncRunStatus = !fullyPersisted
        ? 'error'
        : normalized.errlist.length > 0
          ? 'partial'
          : 'success';

      const state = buildRunState(previousState, env.householdId, {
        nowIso,
        nowEpoch,
        status,
        windowStartEpoch,
        earliestEpoch,
        perAccountTxnCounts: normalized.perAccountTxnCounts,
        errlist: normalized.errlist.map(({ code, msg }) => ({ code, msg })),
      });
      await writeSyncState(ddb, env.tableName, state);
      stateWritten = true;

      if (!fullyPersisted) {
        throw new SyncWriteIncompleteError(result.unprocessedCount);
      }

      // ----- Post-upsert passes (Phase 7); run only on fully persisted runs.

      // P7-1: recurrence detection over the household's recent posted
      // transactions (shared detector; user confirm/ignore status preserved).
      const recurrence = await runRecurrencePass({
        docClient: ddb,
        tableName: env.tableName,
        household: env.householdId,
        now: nowDate,
        lookbackDays: env.recurrenceLookbackDays,
        logger,
      });

      // P7-3: SimpleFIN holdings -> HOLDING# items, replace-per-account.
      const holdings = await ingestHoldings(accountSet.accounts, {
        docClient: ddb,
        tableName: env.tableName,
        household: env.householdId,
        now: nowDate,
        logger,
      });

      // P7-4: daily net-worth snapshot from the stored ACCT# items.
      const snapshot = await writeNetWorthSnapshot({
        docClient: ddb,
        tableName: env.tableName,
        household: env.householdId,
        now: nowDate,
        baseCurrency: env.baseCurrency,
        logger,
      });

      // P7-8: SyncCompleted event. emitSyncCompleted never throws; a failed
      // emission is logged loudly inside and reported here as `false`.
      const syncCompletedEventEmitted = await emitSyncCompleted(
        {
          runId,
          status,
          accountsSynced: result.accountsUpserted,
          txnsUpserted: result.txnsUpserted,
          household: env.householdId,
        },
        {
          busName: env.eventBusName,
          source: env.eventSource,
          logger,
          putEvents: deps.putEvents,
        },
      );

      const summary: SyncRunSummary = {
        runId,
        status,
        accountsSynced: result.accountsUpserted,
        txnsUpserted: result.txnsUpserted,
        staleDeletes: result.staleDeletes,
        errlistCount: normalized.errlist.length,
        windowStartEpoch,
        recurringSeriesUpserted: recurrence.seriesUpserted,
        holdingsWritten: holdings.holdingsWritten,
        netWorthSnapshotDate: snapshot.date,
        syncCompletedEventEmitted,
      };
      logger.info('sync run complete', { ...summary });
      return summary;
    } catch (err) {
      metrics.SyncErrors += 1;
      const terminal = isTerminal(err);
      if (terminal) {
        metrics.TerminalErrors += 1;
      }
      // Record the failure in SYNC#STATE (best effort) unless the run already
      // wrote a richer state item before throwing (undrained-writes path).
      if (!stateWritten) {
        try {
          await writeSyncState(
            ddb,
            env.tableName,
            buildFailureState(previousState, env.householdId, nowIso, {
              code: errorCode(err),
              msg: errorMessage(err),
            }),
          );
        } catch (stateErr) {
          logger.error('failed to record failure state in SYNC#STATE', {
            error: stateErr,
          });
        }
      }
      logger.error('sync run failed', {
        terminal,
        code: errorCode(err),
        error: err,
      });
      // Rethrow so Lambda Errors -> alarm, and Scheduler retry/DLQ engage.
      // Terminal failures (402/403/missing secret) also rethrow: the run IS
      // failed and the alarm must page; the in-Lambda fetch layer simply never
      // retried them.
      throw err;
    } finally {
      // Release the on-demand in-flight marker the API claimed before invoking
      // (security hardening: stops POST /sync/run tap-spam from fanning out
      // concurrent SimpleFIN pulls). Best-effort: a failure here is logged but
      // never fails the run, and the marker's soft TTL is the backstop.
      try {
        await clearSyncRunning(ddb, env.tableName, env.householdId);
      } catch (clearErr) {
        logger.error('failed to clear SYNC#RUNNING marker', { error: clearErr });
      }
      emitSyncMetrics(metrics, {
        namespace: env.metricsNamespace,
        write: deps.metricsWrite,
        timestampMs: nowDate.getTime(),
      });
    }
  };
}

/** Lambda entry point (SyncStack bundles services/sync/src/handler.ts#handler). */
export const handler = createHandler();
