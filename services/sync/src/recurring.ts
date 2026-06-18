/**
 * Recurring/subscription detection pass (P7-1, tuned per P8-5.2/5.3).
 *
 * Runs inside the daily sync Lambda AFTER a fully persisted upsert pass:
 *
 *   1. Query the household's posted transactions over the lookback window
 *      (RECURRENCE_LOOKBACK_DAYS, default 400 — long enough that yearly
 *      cadences stay detectable from accrued history; the SimpleFIN 90-day
 *      cap only bounds what one run fetches, not what is stored).
 *   2. Run the SHARED detector (@goldfinch/shared/recurrence) — the single
 *      implementation of payee normalization, amount tolerance (12%, P8-5.2),
 *      cadence classification, and the deterministic seriesId. The pass feeds
 *      it the OBSERVED window (earliest candidate date -> run date) so the
 *      short-window monthly relaxation (2 occurrences under 3 periods) engages
 *      exactly while stored history is shorter than 90 days, and the
 *      'subscriptions' hint category so >= 2-occurrence subscription payees
 *      surface as 'category-hint' series even at low cadence confidence
 *      (P8-5.3).
 *   3. Upsert one RECURRING#<seriesId> item per detected series via an
 *      attribute-scoped UpdateCommand. `status` is written with
 *      if_not_exists(#status, 'detected'), so re-detection NEVER overwrites a
 *      user's confirm/ignore decision: new series start 'detected'; confirmed
 *      and ignored series keep their status while their bank-derived fields
 *      (lastDate, nextExpectedDate, avgAmountMinor, occurrenceCount, payee,
 *      source) stay fresh. Ignored series are refreshed but never resurrected.
 *
 * The detector contract requires POSTED rows only; pending rows are filtered
 * here (a pending newest occurrence is excluded WITHOUT harming the series:
 * detection still runs over the posted history and picks the pending row up
 * on the run after it posts — locked by test). Imported/manual transactions
 * participate too — recurrence is a household-level signal, not a
 * SimpleFIN-only one.
 */

import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DEFAULT_TZ, SCHEMA_VERSION } from '@goldfinch/shared/constants';
import { isoDateInTz } from '@goldfinch/shared/dates';
import {
  parseTxnSk,
  recurringSk,
  txnDateRangeBounds,
  userPk,
} from '@goldfinch/shared/keys';
import type { UserPk } from '@goldfinch/shared/keys';
import type { Logger } from '@goldfinch/shared/logger';
import {
  SUBSCRIPTIONS_HINT_CATEGORY_ID,
  daysBetween,
  detectRecurringSeries,
} from '@goldfinch/shared/recurrence';
import type {
  DetectedSeries,
  RecurrenceCandidateTxn,
} from '@goldfinch/shared/recurrence';
import type { IsoTimestamp, TransactionItem } from '@goldfinch/shared/types';

import type { DocClient } from './writer.js';

const MS_PER_DAY = 86_400_000;

export interface RecurrencePassOptions {
  docClient: DocClient;
  tableName: string;
  household: string;
  /** Run clock; the lookback window ends at this instant's DEFAULT_TZ date. */
  now: Date;
  /** Days of posted history fed to the detector. */
  lookbackDays: number;
  logger: Logger;
}

export interface RecurrencePassResult {
  /** Posted transactions that qualified as detector input. */
  candidateCount: number;
  /** RECURRING# items upserted this pass. */
  seriesUpserted: number;
}

/** Paginated Query over TXN# rows in [from, to] (exact-key role: no Scan/Get). */
async function loadTransactions(
  docClient: DocClient,
  tableName: string,
  pk: UserPk,
  from: string,
  to: string,
): Promise<TransactionItem[]> {
  const bounds = txnDateRangeBounds(from, to);
  const items: TransactionItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':start': bounds.start,
          ':end': bounds.end,
        },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const raw of response.Items ?? []) {
      items.push(raw as unknown as TransactionItem);
    }
    exclusiveStartKey = response.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (exclusiveStartKey !== undefined);
  return items;
}

/**
 * Map a stored transaction onto the detector's candidate shape, or null when
 * it must not feed detection: pending rows (detector contract: POSTED only),
 * empty payees (cannot group / would make seriesIdFor throw). Structurally
 * corrupt rows are skipped WITH a warning — never silently.
 */
export function toRecurrenceCandidate(
  item: TransactionItem,
  logger: Logger,
): RecurrenceCandidateTxn | null {
  if (item.entityType !== 'TRANSACTION' || item.pending === true) {
    return null;
  }
  if (typeof item.payee !== 'string' || item.payee.trim().length === 0) {
    return null; // payee-less rows are normal SimpleFIN data, not corruption
  }
  if (!Number.isSafeInteger(item.amountMinor)) {
    logger.warn('skipping transaction with non-integer amountMinor in recurrence pass', {
      sk: item.SK,
      amountMinor: item.amountMinor,
    });
    return null;
  }
  if (typeof item.currency !== 'string' || item.currency.length === 0) {
    logger.warn('skipping transaction with missing currency in recurrence pass', {
      sk: item.SK,
    });
    return null;
  }
  try {
    const { date, txnId } = parseTxnSk(item.SK);
    return {
      txnId: item.simplefinTxnId ?? txnId,
      payee: item.payee,
      amountMinor: item.amountMinor,
      currency: item.currency,
      date,
      accountId: item.accountId,
      // P8-5.3: the category-hint pass needs the slug; null == uncategorized.
      categoryId: item.categoryId ?? null,
    };
  } catch (err) {
    logger.warn('skipping transaction with malformed SK in recurrence pass', {
      sk: item.SK,
      error: err,
    });
    return null;
  }
}

/**
 * Upsert one RECURRING# item. UpdateCommand creates the item when absent;
 * `createdAt` and `status` are if_not_exists so first detection stamps them
 * and every later pass preserves them (status confirmed/ignored survives).
 */
async function upsertSeries(
  docClient: DocClient,
  tableName: string,
  pk: UserPk,
  series: DetectedSeries,
  nowIso: IsoTimestamp,
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: pk, SK: recurringSk(series.seriesId) },
      UpdateExpression:
        'SET #entityType = :entityType, #schemaVersion = :schemaVersion, ' +
        '#seriesId = :seriesId, #payee = :payee, ' +
        '#payeeNormalized = :payeeNormalized, #cadence = :cadence, ' +
        '#avgAmountMinor = :avgAmountMinor, #currency = :currency, ' +
        '#lastDate = :lastDate, #nextExpectedDate = :nextExpectedDate, ' +
        '#accountId = :accountId, #occurrenceCount = :occurrenceCount, ' +
        '#source = :source, ' +
        '#updatedAt = :now, #createdAt = if_not_exists(#createdAt, :now), ' +
        '#status = if_not_exists(#status, :detected)',
      ExpressionAttributeNames: {
        '#entityType': 'entityType',
        '#schemaVersion': 'schemaVersion',
        '#seriesId': 'seriesId',
        '#payee': 'payee',
        '#payeeNormalized': 'payeeNormalized',
        '#cadence': 'cadence',
        '#avgAmountMinor': 'avgAmountMinor',
        '#currency': 'currency',
        '#lastDate': 'lastDate',
        '#nextExpectedDate': 'nextExpectedDate',
        '#accountId': 'accountId',
        '#occurrenceCount': 'occurrenceCount',
        '#source': 'source',
        '#updatedAt': 'updatedAt',
        '#createdAt': 'createdAt',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':entityType': 'RECURRING_SERIES',
        ':schemaVersion': SCHEMA_VERSION,
        ':seriesId': series.seriesId,
        ':payee': series.payee,
        ':payeeNormalized': series.payeeNormalized,
        ':cadence': series.cadence,
        ':avgAmountMinor': series.avgAmountMinor,
        ':currency': series.currency,
        ':lastDate': series.lastDate,
        ':nextExpectedDate': series.nextExpectedDate,
        ':accountId': series.accountId,
        ':occurrenceCount': series.occurrenceCount,
        // P8-5.3: refreshed every pass — a hint series upgrades to 'detector'
        // once cadence confidence is reached.
        ':source': series.source,
        ':now': nowIso,
        ':detected': 'detected',
      },
    }),
  );
}

/**
 * The full detection pass: load recent posted transactions, run the shared
 * detector, upsert every detected series. Errors propagate — the writes are
 * idempotent and the next scheduled run repairs anything a crash left behind,
 * while the Lambda Errors alarm surfaces the failure.
 */
export async function runRecurrencePass(
  options: RecurrencePassOptions,
): Promise<RecurrencePassResult> {
  const { docClient, tableName, household, now, lookbackDays, logger } = options;
  const pk = userPk(household);
  const toDate = isoDateInTz(now, DEFAULT_TZ);
  const fromDate = isoDateInTz(
    new Date(now.getTime() - lookbackDays * MS_PER_DAY),
    DEFAULT_TZ,
  );

  const rows = await loadTransactions(docClient, tableName, pk, fromDate, toDate);
  const candidates: RecurrenceCandidateTxn[] = [];
  for (const row of rows) {
    const candidate = toRecurrenceCandidate(row, logger);
    if (candidate !== null) {
      candidates.push(candidate);
    }
  }

  // P8-5.2: the OBSERVED window is the span of data we actually hold
  // (earliest candidate -> run date), not the query lookback. While it is
  // shorter than 3 monthly periods (the 90-day SimpleFIN first-link shape),
  // the detector accepts monthly at 2 occurrences; once history accrues past
  // 90 days the relaxation self-disables.
  let observedWindowDays: number | undefined;
  for (const candidate of candidates) {
    const span = daysBetween(candidate.date, toDate);
    if (observedWindowDays === undefined || span > observedWindowDays) {
      observedWindowDays = span;
    }
  }

  const series = detectRecurringSeries(candidates, {
    observedWindowDays,
    // P8-5.3: subscriptions cross-seed, single-sourced slug from shared.
    hintCategoryId: SUBSCRIPTIONS_HINT_CATEGORY_ID,
  });
  const nowIso = now.toISOString();
  for (const detected of series) {
    await upsertSeries(docClient, tableName, pk, detected, nowIso);
  }

  const hintCount = series.filter((s) => s.source === 'category-hint').length;
  logger.info('recurrence pass complete', {
    fromDate,
    toDate,
    observedWindowDays,
    transactionsScanned: rows.length,
    candidateCount: candidates.length,
    seriesUpserted: series.length,
    categoryHintSeries: hintCount,
  });
  return { candidateCount: candidates.length, seriesUpserted: series.length };
}
