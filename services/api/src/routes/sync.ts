/**
 * GET /sync/status, POST /sync/run — the on-demand "Sync now" backend.
 *
 * - GET /sync/status reads the household's SYNC#STATE singleton (written by
 *   services/sync after every run) and maps it to SyncStatusResponse. A
 *   household that has never synced has NO record yet; that is NOT a 404 —
 *   the response carries nulls and an empty accounts array. Field shapes
 *   mirror the record exactly (ISO-8601 run/account timestamps, epoch-seconds
 *   success cursor); nothing is converted here.
 *
 * - POST /sync/run asynchronously invokes the sync Lambda (InvocationType
 *   Event — fire-and-forget; the run's outcome lands in SYNC#STATE, which
 *   clients poll via GET /sync/status). Two layers of tap-spam protection:
 *
 *   1. Debounce: when SYNC#STATE lastRunAt is within SYNC_RUN_DEBOUNCE_SECONDS
 *      the handler does NOT invoke and answers { accepted: false,
 *      alreadyRunning: true }. lastRunAt is written by the PRODUCER at the END
 *      of a run, so on its own it cannot stop a burst of taps that all land
 *      before the first run finishes.
 *
 *   2. In-flight marker (the fan-out fix): BEFORE the invoke, the API claims a
 *      SYNC#RUNNING singleton with a conditional PutItem — succeed only if no
 *      marker exists or the existing one is stale (runningSince older than
 *      SYNC_RUNNING_TTL_SECONDS, i.e. a crashed run). A concurrent tap loses
 *      the conditional write and is refused with { accepted: false,
 *      alreadyRunning: true }, so only ONE full SimpleFIN-pull Lambda is ever
 *      dispatched per in-flight run (cost/DoS guard; avoids a SimpleFIN
 *      402/403 wedge from parallel pulls). The sync handler DELETES the marker
 *      when its run finishes (services/sync handler), so the next run proceeds;
 *      the soft TTL guarantees a crash cannot wedge the button shut forever.
 *      If the invoke itself fails after the claim, the API releases the marker
 *      so a retry is not blocked.
 *
 *   The sync handler itself ignores its event payload (services/sync handler
 *   signature is `_event: unknown`), so the invoke carries none.
 *
 * The household is ALWAYS re-derived from the JWT claims (decision KEY),
 * never from client input. The IAM grant backing the invoke is scoped to
 * exactly the sync function's ARN (infra ApiStack, sid InvokeSyncFunction).
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  SCHEMA_VERSION,
  SYNC_RUN_DEBOUNCE_SECONDS,
  SYNC_RUNNING_TTL_SECONDS,
} from '@goldfinch/shared/constants';
import { syncRunningSk, syncStateSk, userPk } from '@goldfinch/shared/keys';
import type {
  SyncRunningItem,
  SyncRunResponse,
  SyncStateItem,
  SyncStatusResponse,
} from '@goldfinch/shared/types';
import { getIdentity } from '../context.js';
import { ddb, isConditionalCheckFailure } from '../ddb.js';
import { getEnv, getSyncFnName } from '../env.js';
import { ApiError, json } from '../http.js';
import { logger } from '../logger.js';

/** Module-scope Lambda client (warm-invocation reuse, like ddb.ts). */
const lambda = new LambdaClient({});

/**
 * Exact-key read of the SYNC#STATE singleton. SYNC#STATE is exclusively
 * entityType SYNC_STATE; anything else is corrupt data these routes must not
 * serve (treated as absent, like profile.ts does for PROFILE# items).
 */
async function readSyncState(
  tableName: string,
  household: string,
): Promise<SyncStateItem | undefined> {
  const res = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: userPk(household), SK: syncStateSk() },
    }),
  );
  const item = res.Item as SyncStateItem | undefined;
  return item !== undefined && item.entityType === 'SYNC_STATE' ? item : undefined;
}

/** True when the last run finished inside the debounce window. */
function isWithinDebounce(lastRunAt: string, nowMs: number): boolean {
  const lastRunMs = Date.parse(lastRunAt);
  // An unparseable timestamp must never wedge the button shut: treat it as
  // stale and allow the invoke.
  return (
    Number.isFinite(lastRunMs) && nowMs - lastRunMs < SYNC_RUN_DEBOUNCE_SECONDS * 1000
  );
}

export async function getSyncStatus(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const record = await readSyncState(env.tableName, household);

  const body: SyncStatusResponse =
    record === undefined
      ? { lastRunAt: null, lastRunStatus: null, lastSuccessAt: null, accounts: [] }
      : {
          lastRunAt: record.lastRunAt,
          lastRunStatus: record.lastRunStatus,
          lastSuccessAt: record.lastSuccessEpoch ?? null,
          accounts: Object.entries(record.perAccount ?? {})
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([accountId, account]) => ({
              accountId,
              status: account.status,
              lastSyncedAt: account.lastSyncedAt ?? null,
              errorReason: account.errorReason ?? null,
            })),
        };
  return json(200, body);
}

/**
 * Atomically claim the SYNC#RUNNING in-flight marker for this household.
 *
 * The conditional PutItem succeeds only when no marker exists OR the existing
 * marker is stale (runningSince older than SYNC_RUNNING_TTL_SECONDS — a run
 * that crashed before clearing it). A concurrent tap that loses the race gets
 * a ConditionalCheckFailedException, which maps to `false` (refuse the run).
 *
 * Returns true when the marker was claimed (caller may invoke), false when a
 * fresh marker already holds the slot (caller refuses with alreadyRunning).
 */
async function claimSyncRunning(
  tableName: string,
  household: string,
  nowMs: number,
): Promise<boolean> {
  const staleBeforeIso = new Date(nowMs - SYNC_RUNNING_TTL_SECONDS * 1000).toISOString();
  const item: SyncRunningItem = {
    PK: userPk(household),
    SK: syncRunningSk(),
    entityType: 'SYNC_RUNNING',
    schemaVersion: SCHEMA_VERSION,
    runningSince: new Date(nowMs).toISOString(),
  };
  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName,
        // Spread: interfaces lack the implicit index signature Item requires.
        Item: { ...item },
        // Claim when absent, OR when the held marker is stale (crashed run).
        // attribute_type guards a legacy/corrupt marker missing runningSince:
        // such an item is treated as claimable rather than wedging forever.
        ConditionExpression:
          'attribute_not_exists(SK) OR attribute_not_exists(#runningSince) OR #runningSince < :stale',
        ExpressionAttributeNames: { '#runningSince': 'runningSince' },
        ExpressionAttributeValues: { ':stale': staleBeforeIso },
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      return false;
    }
    throw err;
  }
}

/**
 * Best-effort release of the in-flight marker after a FAILED invoke, so a
 * transient invoke error does not block the next tap for a full TTL. Logged
 * but never thrown: the soft TTL is the backstop if this delete also fails.
 */
async function releaseSyncRunning(tableName: string, household: string): Promise<void> {
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { PK: userPk(household), SK: syncRunningSk() },
      }),
    );
  } catch (err) {
    logger.error('failed to release SYNC#RUNNING marker after invoke failure', {
      household,
      err,
    });
  }
}

export async function runSync(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const syncFnName = getSyncFnName();

  const record = await readSyncState(env.tableName, household);
  if (record !== undefined && isWithinDebounce(record.lastRunAt, Date.now())) {
    const body: SyncRunResponse = { accepted: false, alreadyRunning: true };
    return json(200, body);
  }

  // At-START in-flight claim (the fan-out fix): only the tap that wins this
  // conditional write dispatches a Lambda; concurrent taps are refused before
  // any SimpleFIN pull is spent. Cleared by the sync handler on completion.
  const claimed = await claimSyncRunning(env.tableName, household, Date.now());
  if (!claimed) {
    const body: SyncRunResponse = { accepted: false, alreadyRunning: true };
    return json(200, body);
  }

  try {
    await lambda.send(
      new InvokeCommand({ FunctionName: syncFnName, InvocationType: 'Event' }),
    );
  } catch (err) {
    // The run never started, so do not leave the marker held for a full TTL.
    await releaseSyncRunning(env.tableName, household);
    logger.error('sync Lambda async invoke failed', {
      routeKey: event.routeKey,
      syncFnName,
      err,
    });
    throw new ApiError(
      502,
      'SYNC_INVOKE_FAILED',
      'could not start the sync run; try again shortly',
    );
  }

  const body: SyncRunResponse = { accepted: true };
  return json(202, body);
}
