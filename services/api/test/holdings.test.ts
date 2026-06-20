import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ErrorEnvelope, ListHoldingsResponse } from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import {
  PK,
  makeAccountItem,
  makeEvent,
  makeHoldingItem,
  parseBody,
  setTestEnv,
} from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

const ROUTE = 'GET /accounts/{accountId}/holdings';

function listEvent(accountId = 'acct-1') {
  return makeEvent({ routeKey: ROUTE, pathParameters: { accountId } });
}

describe('GET /accounts/{accountId}/holdings', () => {
  it('returns holdings sorted by holdingId with the explicit support flag', async () => {
    ddbMock
      .on(GetCommand)
      .resolves({
        Item: makeAccountItem({
          SK: 'ACCT#acct-1',
          accountType: 'investment',
          holdingsSupported: true,
        }),
      });
    ddbMock.on(QueryCommand).resolves({
      Items: [
        makeHoldingItem('acct-1', 'h-2', { symbol: 'BND', costBasisMinor: 100_000 }),
        makeHoldingItem('acct-1', 'h-1'),
      ],
    });
    const res = await handler(listEvent());
    expect(res.statusCode).toBe(200);
    const body = parseBody<ListHoldingsResponse>(res);
    expect(body.holdingsSupported).toBe(true);
    expect(body.items.map((h) => h.holdingId)).toEqual(['h-1', 'h-2']);
    const h2 = body.items[1]!;
    expect(h2.marketValue).toBe('3500.00');
    expect(h2.shares).toBe('12.5');
    expect(h2.costBasis).toBe('1000.00');
  });

  it('reports holdingsSupported false (the no-silent-blank state) from the account flag', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: makeAccountItem({
        SK: 'ACCT#acct-1',
        accountType: 'investment',
        holdingsSupported: false,
      }),
    });
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    expect(body).toEqual({ items: [], holdingsSupported: false });
  });

  it('falls back to row presence when the pre-Phase-7 account has no flag', async () => {
    ddbMock
      .on(GetCommand)
      .resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    ddbMock.on(QueryCommand).resolves({ Items: [makeHoldingItem('acct-1', 'h-1')] });
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    expect(body.holdingsSupported).toBe(true);
    expect(body.items).toHaveLength(1);
  });

  it('404s for an unknown account', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(listEvent('nope'));
    expect(res.statusCode).toBe(404);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('NOT_FOUND');
  });

  it('queries the holding prefix for exactly this account', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await handler(listEvent());
    const query = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(query.ExpressionAttributeValues).toMatchObject({
      ':pk': PK,
      ':prefix': 'HOLDING#acct-1#',
    });
  });
});
