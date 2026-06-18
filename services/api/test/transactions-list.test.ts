import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { decodeCursor, encodeCursor } from '@goldfinch/shared/cursor';
import type {
  ErrorEnvelope,
  ListTransactionsResponse,
} from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import {
  HOUSEHOLD,
  PK,
  makeEvent,
  makeTxnItem,
  parseBody,
  setTestEnv,
} from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

const ROUTE = 'GET /transactions';

describe('GET /transactions (base table)', () => {
  it('queries SK BETWEEN TXN#<from> AND TXN#<to>~ so the last day is included', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(
      makeEvent({ routeKey: ROUTE, query: { from: '2026-05-01', to: '2026-05-31' } }),
    );
    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input.KeyConditionExpression).toBe('PK = :pk AND SK BETWEEN :start AND :end');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':pk': PK,
      ':start': 'TXN#2026-05-01',
      ':end': 'TXN#2026-05-31~',
    });
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(50);
  });

  it('maps items to TransactionDto with the decimal/minor money pair', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [makeTxnItem({ SK: 'TXN#2026-05-10#txn-1', amountMinor: -4215 })],
    });
    const res = await handler(
      makeEvent({ routeKey: ROUTE, query: { from: '2026-05-01', to: '2026-05-31' } }),
    );
    const body = parseBody<ListTransactionsResponse>(res);
    expect(body.items).toHaveLength(1);
    const item = body.items[0]!;
    expect(item.txnId).toBe('txn-1');
    expect(item.date).toBe('2026-05-10');
    expect(item.amount).toBe('-42.15');
    expect(item.amountMinor).toBe(-4215);
    expect(body.nextCursor).toBeUndefined();
  });

  it('returns an opaque nextCursor and accepts it back as ExclusiveStartKey', async () => {
    const lek = { PK, SK: 'TXN#2026-05-10#txn-1' };
    // Chain both pages up front: re-calling ddbMock.on(QueryCommand) between
    // handler invocations resets the behavior chain's call counter while the
    // underlying stub's call count keeps advancing, so the second send()
    // would resolve undefined and the handler would 500.
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [makeTxnItem({ SK: 'TXN#2026-05-10#txn-1' })],
        LastEvaluatedKey: lek,
      })
      .resolves({ Items: [] });
    const first = await handler(
      makeEvent({ routeKey: ROUTE, query: { from: '2026-05-01', to: '2026-05-31' } }),
    );
    const firstBody = parseBody<ListTransactionsResponse>(first);
    expect(firstBody.nextCursor).toBeDefined();
    expect(decodeCursor(firstBody.nextCursor!)).toEqual(lek);

    const second = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { from: '2026-05-01', to: '2026-05-31', cursor: firstBody.nextCursor! },
      }),
    );
    expect(second.statusCode).toBe(200);
    const input = ddbMock.commandCalls(QueryCommand).at(-1)!.args[0].input;
    expect(input.ExclusiveStartKey).toEqual(lek);
  });

  it('rejects a malformed cursor with 400 BAD_CURSOR', async () => {
    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { from: '2026-05-01', to: '2026-05-31', cursor: '!!!not-base64url!!!' },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('BAD_CURSOR');
  });

  it('rejects a cursor forged for another partition with 400 BAD_CURSOR', async () => {
    const forged = encodeCursor({ PK: 'USER#other', SK: 'TXN#2026-05-10#x' });
    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { from: '2026-05-01', to: '2026-05-31', cursor: forged },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('BAD_CURSOR');
  });

  it('rejects a well-formed cursor replayed against a different window with 400 BAD_CURSOR (no query)', async () => {
    // An April cursor against a May window: DynamoDB would reject this
    // ExclusiveStartKey with ValidationException -> 500 if it ever got there.
    const crossWindow = encodeCursor({ PK, SK: 'TXN#2026-04-15#t9' });
    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { from: '2026-05-01', to: '2026-05-31', cursor: crossWindow },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('BAD_CURSOR');
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('maps a DynamoDB starting-key ValidationException to 400 BAD_CURSOR (defense in depth)', async () => {
    const cursor = encodeCursor({ PK, SK: 'TXN#2026-05-10#t1' });
    ddbMock
      .on(QueryCommand)
      .rejects(
        Object.assign(new Error('The provided starting key is invalid'), {
          name: 'ValidationException',
        }),
      );
    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { from: '2026-05-01', to: '2026-05-31', cursor },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('BAD_CURSOR');
  });

  it('still maps unrelated ValidationExceptions to 500 INTERNAL_ERROR', async () => {
    ddbMock
      .on(QueryCommand)
      .rejects(
        Object.assign(new Error('Invalid FilterExpression: something else'), {
          name: 'ValidationException',
        }),
      );
    const res = await handler(
      makeEvent({ routeKey: ROUTE, query: { from: '2026-05-01', to: '2026-05-31' } }),
    );
    expect(res.statusCode).toBe(500);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('INTERNAL_ERROR');
  });

  it('rejects a range over 366 days with 400 RANGE_TOO_LARGE', async () => {
    const res = await handler(
      makeEvent({ routeKey: ROUTE, query: { from: '2024-01-01', to: '2026-01-01' } }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('RANGE_TOO_LARGE');
  });

  it('rejects from > to with 400 VALIDATION_ERROR', async () => {
    const res = await handler(
      makeEvent({ routeKey: ROUTE, query: { from: '2026-06-01', to: '2026-05-01' } }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('clamps limit to the 100 maximum', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { from: '2026-05-01', to: '2026-05-31', limit: '500' },
      }),
    );
    expect(ddbMock.commandCalls(QueryCommand)[0]!.args[0].input.Limit).toBe(100);
  });

  it('applies the q filter expression on payeeLower/noteLower', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { from: '2026-05-01', to: '2026-05-31', q: 'Whole Foods' },
      }),
    );
    const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input.FilterExpression).toContain('contains(#payeeLower, :q)');
    expect(input.ExpressionAttributeValues).toMatchObject({ ':q': 'whole foods' });
  });

  it('autofills near-empty filtered pages by re-querying until the limit is met', async () => {
    const page1 = [makeTxnItem({ SK: 'TXN#2026-05-20#t1' })];
    const page2 = [makeTxnItem({ SK: 'TXN#2026-05-10#t2' })];
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: page1, LastEvaluatedKey: { PK, SK: 'TXN#2026-05-20#t1' } })
      .resolvesOnce({ Items: page2 });
    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { from: '2026-05-01', to: '2026-05-31', pendingOnly: 'true', limit: '5' },
      }),
    );
    const body = parseBody<ListTransactionsResponse>(res);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(2);
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeUndefined();
  });

  it('synthesizes the cursor from the last returned item when the autofill overshoots', async () => {
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [makeTxnItem({ SK: 'TXN#2026-05-22#t1' })],
        LastEvaluatedKey: { PK, SK: 'TXN#2026-05-22#t1' },
      })
      .resolvesOnce({
        Items: [
          makeTxnItem({ SK: 'TXN#2026-05-21#t2' }),
          makeTxnItem({ SK: 'TXN#2026-05-20#t3' }),
        ],
        LastEvaluatedKey: { PK, SK: 'TXN#2026-05-20#t3' },
      });
    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { from: '2026-05-01', to: '2026-05-31', pendingOnly: 'true', limit: '2' },
      }),
    );
    const body = parseBody<ListTransactionsResponse>(res);
    expect(body.items).toHaveLength(2);
    expect(body.items.map((i) => i.txnId)).toEqual(['t1', 't2']);
    expect(decodeCursor(body.nextCursor!)).toEqual({ PK, SK: 'TXN#2026-05-21#t2' });
  });
});

describe('GET /transactions with accountId (GSI1) and the per-account route', () => {
  it('routes to GSI1 and hydrates full items via GetItem', async () => {
    const projected = {
      PK,
      SK: 'TXN#2026-05-10#t1',
      GSI1PK: `USER#${HOUSEHOLD}#ACCT#acct-1`,
      GSI1SK: '2026-05-10#t1',
      amountMinor: -4215,
      payee: 'Whole Foods Market',
      categoryId: null,
      pending: false,
      currency: 'USD',
    };
    ddbMock.on(QueryCommand).resolves({ Items: [projected] });
    ddbMock.on(GetCommand).resolves({
      Item: makeTxnItem({ SK: 'TXN#2026-05-10#t1', version: 7 }),
    });
    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { from: '2026-05-01', to: '2026-05-31', accountId: 'acct-1' },
      }),
    );
    const queryInput = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(queryInput.IndexName).toBe('GSI1');
    expect(queryInput.KeyConditionExpression).toBe(
      'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end',
    );
    expect(queryInput.ExpressionAttributeValues).toMatchObject({
      ':pk': `USER#${HOUSEHOLD}#ACCT#acct-1`,
      ':start': '2026-05-01',
      ':end': '2026-05-31~',
    });
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(1);
    const body = parseBody<ListTransactionsResponse>(res);
    expect(body.items[0]!.version).toBe(7);
  });

  it('rejects a cross-window cursor on the GSI1 path with 400 BAD_CURSOR (no query)', async () => {
    const crossWindow = encodeCursor({
      PK,
      SK: 'TXN#2026-04-15#t9',
      GSI1PK: `USER#${HOUSEHOLD}#ACCT#acct-1`,
      GSI1SK: '2026-04-15#t9',
    });
    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: {
          from: '2026-05-01',
          to: '2026-05-31',
          accountId: 'acct-1',
          cursor: crossWindow,
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('BAD_CURSOR');
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('serves GET /accounts/{accountId}/transactions from the path parameter', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(
      makeEvent({
        routeKey: 'GET /accounts/{accountId}/transactions',
        pathParameters: { accountId: 'acct-9' },
        query: { from: '2026-05-01', to: '2026-05-31' },
      }),
    );
    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input.IndexName).toBe('GSI1');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':pk': `USER#${HOUSEHOLD}#ACCT#acct-9`,
    });
  });

  it('applies the q filter in code after hydration (GSI1 projection lacks payeeLower)', async () => {
    const projectedRow = (txnId: string) => ({
      PK,
      SK: `TXN#2026-05-10#${txnId}`,
      GSI1PK: `USER#${HOUSEHOLD}#ACCT#acct-1`,
      GSI1SK: `2026-05-10#${txnId}`,
    });
    ddbMock.on(QueryCommand).resolves({ Items: [projectedRow('t1'), projectedRow('t2')] });
    ddbMock
      .on(GetCommand, { Key: { PK, SK: 'TXN#2026-05-10#t1' } })
      .resolves({
        Item: makeTxnItem({ SK: 'TXN#2026-05-10#t1', payeeLower: 'whole foods market' }),
      });
    ddbMock
      .on(GetCommand, { Key: { PK, SK: 'TXN#2026-05-10#t2' } })
      .resolves({
        Item: makeTxnItem({ SK: 'TXN#2026-05-10#t2', payeeLower: 'shell gas' }),
      });
    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { from: '2026-05-01', to: '2026-05-31', accountId: 'acct-1', q: 'whole' },
      }),
    );
    const body = parseBody<ListTransactionsResponse>(res);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.txnId).toBe('t1');
  });
});
