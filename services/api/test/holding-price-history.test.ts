import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ErrorEnvelope, HoldingPriceHistoryResponse } from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import { makeEvent, parseBody, setTestEnv } from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

const ROUTE = 'GET /accounts/{accountId}/holdings/{symbol}/price-history';
const PATH = { accountId: 'ACT-1', symbol: 'VTI' };

function priceItem(date: string, pricePerShareMinor: number) {
  return {
    entityType: 'HOLDING_PRICE_SNAPSHOT',
    date,
    accountId: 'ACT-1',
    symbol: 'VTI',
    currency: 'USD',
    pricePerShareMinor,
  };
}

/** First Query (Limit 1) finds the earliest snapshot; second drains the range. */
function mockSnapshots(first: ReturnType<typeof priceItem> | undefined, range: unknown[]) {
  ddbMock.on(QueryCommand).callsFake((input: Record<string, unknown>) => {
    if (input['Limit'] === 1) {
      return { Items: first === undefined ? [] : [first] };
    }
    return { Items: range };
  });
}

describe('GET /accounts/{accountId}/holdings/{symbol}/price-history', () => {
  it('returns an empty series with a null firstSnapshotDate before the first snapshot', async () => {
    mockSnapshots(undefined, []);
    const res = await handler(makeEvent({ routeKey: ROUTE, pathParameters: PATH }));
    expect(res.statusCode).toBe(200);
    expect(parseBody<HoldingPriceHistoryResponse>(res)).toEqual({
      items: [],
      firstSnapshotDate: null,
    });
  });

  it('defaults from to the earliest snapshot and maps the price series (money pair)', async () => {
    const first = priceItem('2026-06-01', 10000); // $100.00
    mockSnapshots(first, [first, priceItem('2026-06-02', 11000)]);
    const res = await handler(makeEvent({ routeKey: ROUTE, pathParameters: PATH }));
    const body = parseBody<HoldingPriceHistoryResponse>(res);
    expect(body.firstSnapshotDate).toBe('2026-06-01');
    expect(body.items).toHaveLength(2);
    expect(body.items[1]).toEqual({
      date: '2026-06-02',
      pricePerShare: '110.00',
      pricePerShareMinor: 11000,
    });
    const rangeQuery = ddbMock.commandCalls(QueryCommand)[1]!.args[0].input;
    expect(rangeQuery.ExpressionAttributeValues?.[':start']).toBe('HOLDINGPRICE#ACT-1#VTI#2026-06-01');
  });

  it('respects an explicit from/to window (position-scoped SK bounds)', async () => {
    mockSnapshots(priceItem('2026-01-01', 9000), [priceItem('2026-06-02', 11000)]);
    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        pathParameters: PATH,
        query: { from: '2026-06-02', to: '2026-06-05' },
      }),
    );
    expect(res.statusCode).toBe(200);
    const rangeQuery = ddbMock.commandCalls(QueryCommand)[1]!.args[0].input;
    expect(rangeQuery.ExpressionAttributeValues?.[':start']).toBe('HOLDINGPRICE#ACT-1#VTI#2026-06-02');
    expect(rangeQuery.ExpressionAttributeValues?.[':end']).toBe('HOLDINGPRICE#ACT-1#VTI#2026-06-05~');
  });

  it('rejects a symbol containing "#" with 400 (before any query)', async () => {
    const res = await handler(
      makeEvent({ routeKey: ROUTE, pathParameters: { accountId: 'ACT-1', symbol: 'BA#D' } }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects from after to with 400', async () => {
    mockSnapshots(priceItem('2026-01-01', 9000), []);
    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        pathParameters: PATH,
        query: { from: '2026-06-05', to: '2026-06-02' },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('401s without the household claim', async () => {
    const res = await handler(
      makeEvent({ routeKey: ROUTE, pathParameters: PATH, claims: { sub: 's' } }),
    );
    expect(res.statusCode).toBe(401);
  });
});
