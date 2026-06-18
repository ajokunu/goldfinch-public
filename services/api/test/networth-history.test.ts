import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ErrorEnvelope, NetWorthHistoryResponse } from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import { makeEvent, makeNetWorthItem, parseBody, setTestEnv } from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

const ROUTE = 'GET /networth/history';

/** First Query (Limit 1) finds the earliest snapshot; second drains the range. */
function mockSnapshots(first: ReturnType<typeof makeNetWorthItem> | undefined, range: unknown[]) {
  ddbMock.on(QueryCommand).callsFake((input: Record<string, unknown>) => {
    if (input['Limit'] === 1) {
      return { Items: first === undefined ? [] : [first] };
    }
    return { Items: range };
  });
}

describe('GET /networth/history', () => {
  it('returns an empty series with a null firstSnapshotDate before the first snapshot', async () => {
    mockSnapshots(undefined, []);
    const res = await handler(makeEvent({ routeKey: ROUTE }));
    expect(res.statusCode).toBe(200);
    expect(parseBody<NetWorthHistoryResponse>(res)).toEqual({
      items: [],
      firstSnapshotDate: null,
    });
  });

  it('defaults from to the earliest snapshot and maps per-currency slices', async () => {
    const first = makeNetWorthItem('2026-06-01');
    mockSnapshots(first, [
      first,
      makeNetWorthItem('2026-06-02', {
        perCurrency: {
          USD: { assetsMinor: 1_800_000, liabilitiesMinor: 680_000, netMinor: 1_120_000 },
          EUR: { assetsMinor: 50_000, liabilitiesMinor: 0, netMinor: 50_000 },
        },
      }),
    ]);
    const res = await handler(makeEvent({ routeKey: ROUTE }));
    const body = parseBody<NetWorthHistoryResponse>(res);
    expect(body.firstSnapshotDate).toBe('2026-06-01');
    expect(body.items).toHaveLength(2);
    const second = body.items[1]!;
    expect(second.net).toBe('10880.55');
    // perCurrency is an array sorted by currency code, base included.
    expect(second.perCurrency.map((slice) => slice.currency)).toEqual(['EUR', 'USD']);
    expect(second.perCurrency[0]!.net).toBe('500.00');

    const rangeQuery = ddbMock.commandCalls(QueryCommand)[1]!.args[0].input;
    expect(rangeQuery.ExpressionAttributeValues?.[':start']).toBe('NETWORTH#2026-06-01');
  });

  it('respects an explicit from/to window', async () => {
    mockSnapshots(makeNetWorthItem('2026-01-01'), [makeNetWorthItem('2026-06-02')]);
    const res = await handler(
      makeEvent({ routeKey: ROUTE, query: { from: '2026-06-02', to: '2026-06-05' } }),
    );
    expect(res.statusCode).toBe(200);
    const rangeQuery = ddbMock.commandCalls(QueryCommand)[1]!.args[0].input;
    expect(rangeQuery.ExpressionAttributeValues?.[':start']).toBe('NETWORTH#2026-06-02');
    expect(rangeQuery.ExpressionAttributeValues?.[':end']).toBe('NETWORTH#2026-06-05~');
  });

  it('rejects from after to with 400', async () => {
    mockSnapshots(makeNetWorthItem('2026-01-01'), []);
    const res = await handler(
      makeEvent({ routeKey: ROUTE, query: { from: '2026-06-05', to: '2026-06-02' } }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed date with 400', async () => {
    mockSnapshots(makeNetWorthItem('2026-01-01'), []);
    const res = await handler(
      makeEvent({ routeKey: ROUTE, query: { to: 'June 5th' } }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('401s without the household claim', async () => {
    const res = await handler(makeEvent({ routeKey: ROUTE, claims: { sub: 's' } }));
    expect(res.statusCode).toBe(401);
  });
});
