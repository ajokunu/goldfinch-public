/**
 * On-demand "Sync now" routes (Phase 8):
 * - GET /sync/status maps the SYNC#STATE singleton to SyncStatusResponse; a
 *   household that has never synced gets nulls + an empty accounts array,
 *   NEVER a 404.
 * - POST /sync/run async-invokes the sync Lambda (InvocationType Event) with
 *   the SYNC_RUN_DEBOUNCE_SECONDS tap-spam guard and a 502 on invoke failure.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { SYNC_RUNNING_TTL_SECONDS } from '@goldfinch/shared/constants';
import type {
  ErrorEnvelope,
  SyncRunResponse,
  SyncStatusResponse,
} from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import { logger } from '../src/logger.js';
import { PK, makeEvent, makeSyncStateItem, parseBody, setTestEnv } from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);
const lambdaMock = mockClient(LambdaClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
  lambdaMock.reset();
  vi.restoreAllMocks();
});

describe('GET /sync/status', () => {
  it('returns nulls and an empty accounts array for a household that has never synced (no 404)', async () => {
    ddbMock.on(GetCommand).resolves({});
    const res = await handler(makeEvent({ routeKey: 'GET /sync/status' }));
    expect(res.statusCode).toBe(200);
    expect(parseBody<SyncStatusResponse>(res)).toEqual({
      lastRunAt: null,
      lastRunStatus: null,
      lastSuccessAt: null,
      accounts: [],
    });
    // Exact-key read of the singleton, household from the JWT claim.
    expect(ddbMock.commandCalls(GetCommand)[0]!.args[0].input).toEqual({
      TableName: 'GoldFinch',
      Key: { PK, SK: 'SYNC#STATE' },
    });
  });

  it('maps the SYNC#STATE record to the DTO (sorted accounts, error reasons, success cursor)', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: makeSyncStateItem({
        lastRunAt: '2026-06-11T13:00:00.000Z',
        lastRunStatus: 'partial',
        lastSuccessEpoch: 1_781_096_400,
        perAccount: {
          // Deliberately not in accountId order: the DTO must sort.
          'acct-2': {
            lastSyncedAt: '2026-06-10T13:00:00.000Z',
            status: 'error',
            txnCount: 0,
            errorReason: '500: institution unavailable',
          },
          'acct-1': {
            lastSyncedAt: '2026-06-11T13:00:00.000Z',
            status: 'success',
            txnCount: 12,
          },
        },
      }),
    });
    const res = await handler(makeEvent({ routeKey: 'GET /sync/status' }));
    expect(res.statusCode).toBe(200);
    expect(parseBody<SyncStatusResponse>(res)).toEqual({
      lastRunAt: '2026-06-11T13:00:00.000Z',
      lastRunStatus: 'partial',
      lastSuccessAt: 1_781_096_400,
      accounts: [
        {
          accountId: 'acct-1',
          status: 'success',
          lastSyncedAt: '2026-06-11T13:00:00.000Z',
          errorReason: null,
        },
        {
          accountId: 'acct-2',
          status: 'error',
          lastSyncedAt: '2026-06-10T13:00:00.000Z',
          errorReason: '500: institution unavailable',
        },
      ],
    });
  });

  it('treats a legacy record without the optional cursor as lastSuccessAt null', async () => {
    const item = makeSyncStateItem();
    delete (item as Record<string, unknown>)['lastSuccessEpoch'];
    ddbMock.on(GetCommand).resolves({ Item: item });
    const res = await handler(makeEvent({ routeKey: 'GET /sync/status' }));
    const body = parseBody<SyncStatusResponse>(res);
    expect(body.lastSuccessAt).toBeNull();
    expect(body.lastRunAt).toBe('2026-06-10T13:00:00.000Z');
  });

  it('serves a corrupt item at the SYNC#STATE key as if no record existed', async () => {
    ddbMock
      .on(GetCommand)
      .resolves({ Item: { PK, SK: 'SYNC#STATE', entityType: 'ACCOUNT' } });
    const res = await handler(makeEvent({ routeKey: 'GET /sync/status' }));
    expect(res.statusCode).toBe(200);
    expect(parseBody<SyncStatusResponse>(res).lastRunStatus).toBeNull();
  });
});

describe('POST /sync/run', () => {
  it('async-invokes the sync Lambda and answers 202 accepted when no run state exists yet', async () => {
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    lambdaMock.on(InvokeCommand).resolves({ StatusCode: 202 });
    const res = await handler(makeEvent({ routeKey: 'POST /sync/run' }));
    expect(res.statusCode).toBe(202);
    expect(parseBody<SyncRunResponse>(res)).toEqual({ accepted: true });

    const calls = lambdaMock.commandCalls(InvokeCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toEqual({
      FunctionName: 'goldfinch-sync-test',
      InvocationType: 'Event',
    });
  });

  it('claims the SYNC#RUNNING marker conditionally BEFORE invoking (the fan-out guard)', async () => {
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    lambdaMock.on(InvokeCommand).resolves({ StatusCode: 202 });
    const res = await handler(makeEvent({ routeKey: 'POST /sync/run' }));
    expect(res.statusCode).toBe(202);

    const puts = ddbMock.commandCalls(PutCommand);
    expect(puts).toHaveLength(1);
    const input = puts[0]!.args[0].input;
    expect(input.Key).toBeUndefined();
    expect(input.Item).toMatchObject({
      PK,
      SK: 'SYNC#RUNNING',
      entityType: 'SYNC_RUNNING',
    });
    expect(typeof (input.Item as Record<string, unknown>).runningSince).toBe('string');
    // Claim only when absent or stale — never overwrite a fresh in-flight marker.
    expect(input.ConditionExpression).toContain('attribute_not_exists(SK)');
    expect(input.ConditionExpression).toContain('#runningSince < :stale');
    // The marker is claimed strictly before the invoke is sent.
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(1);
  });

  it('refuses a concurrent run (alreadyRunning) when a fresh marker holds the slot, without invoking', async () => {
    // A second, near-simultaneous tap: SYNC#STATE has no fresh lastRunAt (the
    // first run has not finished), so the debounce does not catch it — the
    // in-flight marker must. The conditional PutItem loses the race.
    ddbMock.on(GetCommand).resolves({});
    ddbMock
      .on(PutCommand)
      .rejects(
        new ConditionalCheckFailedException({
          message: 'The conditional request failed',
          $metadata: {},
        }),
      );
    const res = await handler(makeEvent({ routeKey: 'POST /sync/run' }));
    expect(res.statusCode).toBe(200);
    expect(parseBody<SyncRunResponse>(res)).toEqual({
      accepted: false,
      alreadyRunning: true,
    });
    // No Lambda spent on the refused tap — the whole point of the guard.
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('uses a stale-before cutoff of SYNC_RUNNING_TTL_SECONDS so a crashed run self-heals', async () => {
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    lambdaMock.on(InvokeCommand).resolves({ StatusCode: 202 });
    const before = Date.now();
    await handler(makeEvent({ routeKey: 'POST /sync/run' }));
    const after = Date.now();

    const input = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    const stale = Date.parse(
      (input.ExpressionAttributeValues as Record<string, string>)[':stale'] as string,
    );
    // The cutoff is exactly TTL seconds before "now" (the request clock).
    expect(stale).toBeGreaterThanOrEqual(before - SYNC_RUNNING_TTL_SECONDS * 1000 - 5);
    expect(stale).toBeLessThanOrEqual(after - SYNC_RUNNING_TTL_SECONDS * 1000 + 5);
  });

  it('releases the marker when the invoke fails, so a retry is not blocked for a full TTL', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(DeleteCommand).resolves({});
    lambdaMock.on(InvokeCommand).rejects(new Error('AccessDeniedException'));
    const res = await handler(makeEvent({ routeKey: 'POST /sync/run' }));
    expect(res.statusCode).toBe(502);

    // The claimed marker is deleted on the failed-invoke path.
    const deletes = ddbMock.commandCalls(DeleteCommand);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.args[0].input.Key).toEqual({ PK, SK: 'SYNC#RUNNING' });
  });

  it('does not claim the marker (or invoke) when the debounce window already short-circuits', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: makeSyncStateItem({
        lastRunAt: new Date(Date.now() - 30_000).toISOString(),
      }),
    });
    const res = await handler(makeEvent({ routeKey: 'POST /sync/run' }));
    expect(res.statusCode).toBe(200);
    expect(parseBody<SyncRunResponse>(res).alreadyRunning).toBe(true);
    // Debounce wins first: no marker write, no invoke.
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('debounces without invoking when the last run is inside the 120s window', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: makeSyncStateItem({
        lastRunAt: new Date(Date.now() - 30_000).toISOString(),
      }),
    });
    const res = await handler(makeEvent({ routeKey: 'POST /sync/run' }));
    expect(res.statusCode).toBe(200);
    expect(parseBody<SyncRunResponse>(res)).toEqual({
      accepted: false,
      alreadyRunning: true,
    });
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('invokes again once the last run is at or past the window edge', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: makeSyncStateItem({
        lastRunAt: new Date(Date.now() - 120_000).toISOString(),
      }),
    });
    ddbMock.on(PutCommand).resolves({});
    lambdaMock.on(InvokeCommand).resolves({ StatusCode: 202 });
    const res = await handler(makeEvent({ routeKey: 'POST /sync/run' }));
    expect(res.statusCode).toBe(202);
    expect(parseBody<SyncRunResponse>(res)).toEqual({ accepted: true });
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(1);
  });

  it('treats an unparseable lastRunAt as stale rather than wedging the button shut', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: makeSyncStateItem({ lastRunAt: 'not-a-timestamp' }),
    });
    ddbMock.on(PutCommand).resolves({});
    lambdaMock.on(InvokeCommand).resolves({ StatusCode: 202 });
    const res = await handler(makeEvent({ routeKey: 'POST /sync/run' }));
    expect(res.statusCode).toBe(202);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(1);
  });

  it('answers 502 SYNC_INVOKE_FAILED and logs when the invoke fails', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(DeleteCommand).resolves({});
    lambdaMock.on(InvokeCommand).rejects(new Error('AccessDeniedException'));
    const res = await handler(makeEvent({ routeKey: 'POST /sync/run' }));
    expect(res.statusCode).toBe(502);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('SYNC_INVOKE_FAILED');
    expect(errorSpy).toHaveBeenCalledWith(
      'sync Lambda async invoke failed',
      expect.objectContaining({ syncFnName: 'goldfinch-sync-test' }),
    );
  });

  it('surfaces a missing SYNC_FN_NAME as the generic 500 without invoking anything', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    delete process.env.SYNC_FN_NAME;
    ddbMock.on(GetCommand).resolves({});
    const res = await handler(makeEvent({ routeKey: 'POST /sync/run' }));
    expect(res.statusCode).toBe(500);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('INTERNAL_ERROR');
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });
});
