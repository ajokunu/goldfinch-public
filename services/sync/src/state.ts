/**
 * SYNC#STATE manager: the singleton item recording each run's outcome plus the
 * sync cursors.
 *
 * Cursor semantics (revised after code review):
 *
 *   - The authoritative cursor is PER ACCOUNT: perAccount[id].lastSuccessEpoch
 *     is the end of the last run whose fetch window fully covered that
 *     account's history gap and whose data was fully persisted. Healthy
 *     accounts keep advancing even when another institution's connection is
 *     broken (a "partial" run), so one chronically failing institution can no
 *     longer pin the whole household at daily full-history re-pulls.
 *
 *   - The fetch window starts at min(cursors of accounts whose last run
 *     SUCCEEDED) - OVERLAP_BUFFER_DAYS, clamped to now - MAX_HISTORY_DAYS.
 *     Errored accounts are deliberately EXCLUDED from that min; their stale
 *     cursors are not lost, though: an account's cursor only advances when the
 *     window actually covered its gap, so when a failing account recovers, its
 *     old cursor re-enters the min (it is a success account again but its
 *     cursor did not advance), the next run's window widens to cover the gap,
 *     and only then does its cursor jump forward. Self-healing, bounded by the
 *     history cap.
 *
 *   - The record-level lastSuccessEpoch is kept for backward compatibility as
 *     the MIN over all per-account cursors: the conservative point before
 *     which every account's data is known persisted. It is also the fallback
 *     window cursor when no per-account cursor exists yet.
 *
 * Error attribution: SimpleFIN's errlist entries carry code+msg only (no org
 * or account ids), so errors cannot be correlated to accounts directly.
 * Attribution is by ABSENCE instead: any previously known account missing
 * from a run's payload is marked status 'error' with lastErrorAt and the
 * errlist text as the reason. Accounts present with data in a partial run are
 * treated as healthy; a connection that silently serves stale data is covered
 * by the OVERLAP_BUFFER_DAYS re-pull window.
 *
 * IAM note: the sync role is granted dynamodb:Query / PutItem /
 * BatchWriteItem / UpdateItem / DeleteItem - deliberately NOT GetItem - so the
 * state read is an exact-key Query.
 */

import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SCHEMA_VERSION } from '@goldfinch/shared/constants';
import { syncRunningSk, syncStateSk, userPk } from '@goldfinch/shared/keys';
import type {
  EpochSeconds,
  IsoTimestamp,
  SyncErrorEntry,
  SyncRunStatus,
} from '@goldfinch/shared/types';

import type { SyncAccountState, SyncStateRecord } from './types.js';
import type { DdbItem, DocClient } from './writer.js';

export async function readSyncState(
  docClient: DocClient,
  tableName: string,
  household: string,
): Promise<SyncStateRecord | null> {
  const response = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': userPk(household),
        ':sk': syncStateSk(),
      },
      Limit: 1,
    }),
  );
  const item = response.Items?.[0];
  return item === undefined ? null : (item as unknown as SyncStateRecord);
}

export async function writeSyncState(
  docClient: DocClient,
  tableName: string,
  record: SyncStateRecord,
): Promise<void> {
  // DdbItem cast: interfaces lack the index signature the SDK's Item type wants.
  await docClient.send(
    new PutCommand({ TableName: tableName, Item: record as DdbItem }),
  );
}

/**
 * Clear the on-demand SYNC#RUNNING in-flight marker. The marker is claimed by
 * the API (POST /sync/run) before it async-invokes this Lambda so a tap-spam
 * burst cannot fan out concurrent SimpleFIN pulls; this delete — run at the
 * END of every sync run, success or failure — frees the slot for the next run.
 *
 * Unconditional delete: deleting an absent marker is a harmless no-op, so a
 * scheduled (cron) run that never claimed a marker simply does nothing here. A
 * crashed run that never reaches this point self-heals via the marker's soft
 * TTL (SYNC_RUNNING_TTL_SECONDS) on the API side.
 */
export async function clearSyncRunning(
  docClient: DocClient,
  tableName: string,
  household: string,
): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: userPk(household), SK: syncRunningSk() },
    }),
  );
}

/**
 * The effective window cursor: min over the per-account cursors of accounts
 * whose last run succeeded (see module header for why errored accounts are
 * excluded). Returns undefined when a full-history pull is required - no
 * state at all, or a success account that has never had a covered window
 * (e.g. an account first seen during a narrow-window run).
 */
function effectiveWindowCursor(previous: SyncStateRecord | null): EpochSeconds | undefined {
  if (previous === null) {
    return undefined;
  }
  const successes = Object.values(previous.perAccount ?? {}).filter(
    (account) => account.status === 'success',
  );
  if (successes.length === 0) {
    // No per-account cursors (legacy record or every account errored): fall
    // back to the conservative record-level cursor.
    return previous.lastSuccessEpoch;
  }
  let min: EpochSeconds | undefined;
  for (const account of successes) {
    if (account.lastSuccessEpoch === undefined) {
      return undefined; // a success account still owed a full backfill
    }
    min = min === undefined ? account.lastSuccessEpoch : Math.min(min, account.lastSuccessEpoch);
  }
  return min;
}

/**
 * Compute the start-date for this run's /accounts request:
 * effective cursor minus the overlap buffer, clamped to SimpleFIN's history
 * cap. No cursor yet (first run) => full MAX_HISTORY_DAYS backfill.
 */
export function computeWindowStart(
  previous: SyncStateRecord | null,
  nowEpoch: EpochSeconds,
  overlapBufferDays: number,
  maxHistoryDays: number,
): EpochSeconds {
  const earliest = nowEpoch - maxHistoryDays * 86_400;
  const cursor = effectiveWindowCursor(previous);
  if (cursor === undefined) {
    return earliest;
  }
  return Math.max(earliest, cursor - overlapBufferDays * 86_400);
}

export interface RunOutcome {
  nowIso: IsoTimestamp;
  nowEpoch: EpochSeconds;
  status: SyncRunStatus;
  windowStartEpoch: EpochSeconds;
  /** now - MAX_HISTORY_DAYS: a window starting here is a full-history pull. */
  earliestEpoch: EpochSeconds;
  perAccountTxnCounts: Record<string, number>;
  errlist: SyncErrorEntry[];
}

/**
 * Build the post-run state item.
 *
 * Accounts present in the payload of a fully persisted run are 'success'.
 * Their cursor advances to nowEpoch ONLY if this run's window covered their
 * gap (window reached their previous cursor, or was a full-history pull);
 * otherwise the old cursor is kept so the next run widens the window and
 * heals the gap (see module header).
 *
 * Accounts previously known but ABSENT from the payload are marked 'error'
 * (their institution failed, or SimpleFIN dropped them) with lastErrorAt and
 * the errlist text as the reason; their cursors and counters are preserved.
 *
 * A run that failed to fully persist (status 'error') marks every account it
 * touched 'error' and advances no cursor.
 */
export function buildRunState(
  previous: SyncStateRecord | null,
  household: string,
  outcome: RunOutcome,
): SyncStateRecord {
  const perAccount: Record<string, SyncAccountState> = { ...previous?.perAccount };
  const runFailed = outcome.status === 'error';
  const errlistText = outcome.errlist.map((entry) => `${entry.code}: ${entry.msg}`).join('; ');

  for (const [accountId, txnCount] of Object.entries(outcome.perAccountTxnCounts)) {
    const prior = perAccount[accountId];
    if (runFailed) {
      perAccount[accountId] = {
        ...prior,
        lastSyncedAt: outcome.nowIso,
        status: 'error',
        txnCount,
        lastErrorAt: outcome.nowIso,
        errorReason: 'run did not fully persist (unprocessed writes); cursor held',
      };
      continue;
    }
    const covered =
      outcome.windowStartEpoch <= outcome.earliestEpoch ||
      (prior?.lastSuccessEpoch !== undefined &&
        outcome.windowStartEpoch <= prior.lastSuccessEpoch);
    const entry: SyncAccountState = {
      lastSyncedAt: outcome.nowIso,
      status: 'success',
      txnCount,
    };
    const cursor = covered ? outcome.nowEpoch : prior?.lastSuccessEpoch;
    if (cursor !== undefined) {
      entry.lastSuccessEpoch = cursor;
    }
    perAccount[accountId] = entry;
  }

  // Attribution by absence: previously known accounts missing from this
  // payload belong to a failed connection (or were dropped by SimpleFIN).
  for (const [accountId, prior] of Object.entries(previous?.perAccount ?? {})) {
    if (outcome.perAccountTxnCounts[accountId] !== undefined) {
      continue;
    }
    perAccount[accountId] = {
      ...prior,
      status: 'error',
      lastErrorAt: outcome.nowIso,
      errorReason:
        errlistText.length > 0 ? errlistText : 'account missing from SimpleFIN payload',
    };
  }

  const record: SyncStateRecord = {
    PK: userPk(household),
    SK: syncStateSk(),
    entityType: 'SYNC_STATE',
    schemaVersion: SCHEMA_VERSION,
    lastRunAt: outcome.nowIso,
    lastRunStatus: outcome.status,
    perAccount,
    windowStartEpoch: outcome.windowStartEpoch,
  };
  if (outcome.errlist.length > 0) {
    record.lastErrlist = outcome.errlist;
  }

  // Backward-compatible record-level cursor: min over per-account cursors.
  const cursors = Object.values(perAccount)
    .map((account) => account.lastSuccessEpoch)
    .filter((cursor): cursor is EpochSeconds => cursor !== undefined);
  if (cursors.length > 0) {
    record.lastSuccessEpoch = Math.min(...cursors);
  } else if (previous?.lastSuccessEpoch !== undefined) {
    record.lastSuccessEpoch = previous.lastSuccessEpoch;
  }
  return record;
}

/**
 * Build the state item for a run that failed before (or while) persisting
 * data. Keeps the previous cursors and per-account map; records the error so
 * the dashboard / runbook can show why the feed is stale.
 */
export function buildFailureState(
  previous: SyncStateRecord | null,
  household: string,
  nowIso: IsoTimestamp,
  error: SyncErrorEntry,
): SyncStateRecord {
  const record: SyncStateRecord = {
    PK: userPk(household),
    SK: syncStateSk(),
    entityType: 'SYNC_STATE',
    schemaVersion: SCHEMA_VERSION,
    lastRunAt: nowIso,
    lastRunStatus: 'error',
    perAccount: { ...previous?.perAccount },
    lastErrlist: [error],
  };
  if (previous?.windowStartEpoch !== undefined) {
    record.windowStartEpoch = previous.windowStartEpoch;
  }
  if (previous?.lastSuccessEpoch !== undefined) {
    record.lastSuccessEpoch = previous.lastSuccessEpoch;
  }
  return record;
}
