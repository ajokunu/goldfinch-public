/**
 * GET /transactions categoryId filter (P8-3, ops/PHASE8-DECISIONS.md).
 *
 * Expense categories are served from the sparse GSI2 spend index (hydrated
 * like GSI1 — INCLUDE projection); income/transfer categories never carry
 * GSI2 keys, so they fall back to the base table (or GSI1 when combined with
 * accountId) with a categoryId filter. Pagination must work on every path.
 */

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
  makeCategoryItem,
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
const GSI2_PK = `USER#${HOUSEHOLD}#CAT#groceries`;
const MAY = { from: '2026-05-01', to: '2026-05-31' };

/** Wires the category-definition read for the filter validation. */
function mockCategory(categoryId: string, type: 'INCOME' | 'EXPENSE' | 'TRANSFER'): void {
  ddbMock
    .on(GetCommand, { Key: { PK, SK: `CATEGORY#${categoryId}` } })
    .resolves({ Item: makeCategoryItem(categoryId, type) });
}

/** A GSI2-projected row (INCLUDE projection: amountMinor/payee/accountId only). */
function gsi2Row(txnId: string, date = '2026-05-10', accountId = 'acct-1') {
  return {
    PK,
    SK: `TXN#${date}#${txnId}`,
    GSI2PK: GSI2_PK,
    GSI2SK: `${date}#${txnId}`,
    amountMinor: -4215,
    payee: 'Whole Foods Market',
    accountId,
  };
}

/** The hydrated base-table item behind a GSI2 row. */
function mockHydration(txnId: string, date = '2026-05-10', accountId = 'acct-1'): void {
  ddbMock.on(GetCommand, { Key: { PK, SK: `TXN#${date}#${txnId}` } }).resolves({
    Item: makeTxnItem({
      SK: `TXN#${date}#${txnId}`,
      accountId,
      categoryId: 'groceries',
      GSI2PK: GSI2_PK,
      GSI2SK: `${date}#${txnId}`,
    }),
  });
}

describe('GET /transactions?categoryId (expense -> GSI2)', () => {
  it('rejects an unknown categoryId with 400 VALIDATION_ERROR before any query', async () => {
    ddbMock.on(GetCommand).resolves({});
    const res = await handler(
      makeEvent({ routeKey: ROUTE, query: { ...MAY, categoryId: 'ghost' } }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('queries GSI2 with the category partition and hydrates full items', async () => {
    mockCategory('groceries', 'EXPENSE');
    mockHydration('t1');
    ddbMock.on(QueryCommand).resolves({ Items: [gsi2Row('t1')] });

    const res = await handler(
      makeEvent({ routeKey: ROUTE, query: { ...MAY, categoryId: 'groceries' } }),
    );
    expect(res.statusCode).toBe(200);

    const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input.IndexName).toBe('GSI2');
    expect(input.KeyConditionExpression).toBe(
      'GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end',
    );
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':pk': GSI2_PK,
      ':start': '2026-05-01',
      ':end': '2026-05-31~',
    });
    expect(input.ScanIndexForward).toBe(false);

    const body = parseBody<ListTransactionsResponse>(res);
    expect(body.items).toHaveLength(1);
    const item = body.items[0]!;
    expect(item.txnId).toBe('t1');
    expect(item.categoryId).toBe('groceries');
    // Hydrated from the base table: carries fields GSI2 does not project.
    expect(item.version).toBe(1);
  });

  it('paginates: returns an opaque nextCursor and accepts it back as ExclusiveStartKey', async () => {
    mockCategory('groceries', 'EXPENSE');
    mockHydration('t1');
    const lek = {
      PK,
      SK: 'TXN#2026-05-10#t1',
      GSI2PK: GSI2_PK,
      GSI2SK: '2026-05-10#t1',
    };
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [gsi2Row('t1')], LastEvaluatedKey: lek })
      .resolves({ Items: [] });

    const first = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { ...MAY, categoryId: 'groceries', limit: '1' },
      }),
    );
    const firstBody = parseBody<ListTransactionsResponse>(first);
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.nextCursor).toBeDefined();
    expect(decodeCursor(firstBody.nextCursor!)).toEqual(lek);

    const second = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: {
          ...MAY,
          categoryId: 'groceries',
          limit: '1',
          cursor: firstBody.nextCursor!,
        },
      }),
    );
    expect(second.statusCode).toBe(200);
    const input = ddbMock.commandCalls(QueryCommand).at(-1)!.args[0].input;
    expect(input.ExclusiveStartKey).toEqual(lek);
  });

  it('synthesizes a GSI2 cursor from the last returned item when the page overshoots', async () => {
    mockCategory('groceries', 'EXPENSE');
    mockHydration('t1', '2026-05-22');
    mockHydration('t2', '2026-05-20');
    ddbMock.on(QueryCommand).resolves({
      Items: [gsi2Row('t1', '2026-05-22'), gsi2Row('t2', '2026-05-20')],
      LastEvaluatedKey: {
        PK,
        SK: 'TXN#2026-05-20#t2',
        GSI2PK: GSI2_PK,
        GSI2SK: '2026-05-20#t2',
      },
    });

    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { ...MAY, categoryId: 'groceries', limit: '1' },
      }),
    );
    const body = parseBody<ListTransactionsResponse>(res);
    expect(body.items.map((i) => i.txnId)).toEqual(['t1']);
    expect(decodeCursor(body.nextCursor!)).toEqual({
      PK,
      SK: 'TXN#2026-05-22#t1',
      GSI2PK: GSI2_PK,
      GSI2SK: '2026-05-22#t1',
    });
  });

  it('rejects a cross-window GSI2 cursor with 400 BAD_CURSOR (no query)', async () => {
    mockCategory('groceries', 'EXPENSE');
    const crossWindow = encodeCursor({
      PK,
      SK: 'TXN#2026-04-15#t9',
      GSI2PK: GSI2_PK,
      GSI2SK: '2026-04-15#t9',
    });
    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { ...MAY, categoryId: 'groceries', cursor: crossWindow },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('BAD_CURSOR');
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('rejects a cursor forged for another category with 400 BAD_CURSOR', async () => {
    mockCategory('groceries', 'EXPENSE');
    const forged = encodeCursor({
      PK,
      SK: 'TXN#2026-05-10#t1',
      GSI2PK: `USER#${HOUSEHOLD}#CAT#dining`,
      GSI2SK: '2026-05-10#t1',
    });
    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { ...MAY, categoryId: 'groceries', cursor: forged },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('BAD_CURSOR');
  });

  it('combines with accountId in-code on the GSI2 path (the key carries only the category)', async () => {
    mockCategory('groceries', 'EXPENSE');
    mockHydration('t1', '2026-05-10', 'acct-1');
    mockHydration('t2', '2026-05-09', 'acct-2');
    ddbMock.on(QueryCommand).resolves({
      Items: [gsi2Row('t1', '2026-05-10', 'acct-1'), gsi2Row('t2', '2026-05-09', 'acct-2')],
    });

    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { ...MAY, categoryId: 'groceries', accountId: 'acct-2' },
      }),
    );
    const body = parseBody<ListTransactionsResponse>(res);
    // Still the category index (more selective than GSI1 for the drill-down).
    expect(ddbMock.commandCalls(QueryCommand)[0]!.args[0].input.IndexName).toBe('GSI2');
    expect(body.items.map((i) => i.txnId)).toEqual(['t2']);
  });
});

describe('GET /transactions?categoryId (income/transfer -> filtered base/GSI1)', () => {
  it('serves an income category from the base table with a categoryId filter expression', async () => {
    mockCategory('paycheck', 'INCOME');
    ddbMock.on(QueryCommand).resolves({
      Items: [
        makeTxnItem({
          SK: 'TXN#2026-05-15#t5',
          amountMinor: 250_000,
          categoryId: 'paycheck',
        }),
      ],
    });

    const res = await handler(
      makeEvent({ routeKey: ROUTE, query: { ...MAY, categoryId: 'paycheck' } }),
    );
    expect(res.statusCode).toBe(200);

    const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input.IndexName).toBeUndefined();
    expect(input.FilterExpression).toContain('#categoryId = :categoryId');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':categoryId': 'paycheck',
    });

    const body = parseBody<ListTransactionsResponse>(res);
    expect(body.items.map((i) => i.txnId)).toEqual(['t5']);
  });

  it('combines an income category with accountId via GSI1 and filters categoryId in-code', async () => {
    mockCategory('paycheck', 'INCOME');
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { PK, SK: 'TXN#2026-05-15#t5' },
        { PK, SK: 'TXN#2026-05-14#t6' },
      ],
    });
    ddbMock.on(GetCommand, { Key: { PK, SK: 'TXN#2026-05-15#t5' } }).resolves({
      Item: makeTxnItem({ SK: 'TXN#2026-05-15#t5', categoryId: 'paycheck' }),
    });
    ddbMock.on(GetCommand, { Key: { PK, SK: 'TXN#2026-05-14#t6' } }).resolves({
      Item: makeTxnItem({ SK: 'TXN#2026-05-14#t6', categoryId: 'interest' }),
    });

    const res = await handler(
      makeEvent({
        routeKey: ROUTE,
        query: { ...MAY, categoryId: 'paycheck', accountId: 'acct-1' },
      }),
    );
    const input = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input.IndexName).toBe('GSI1');
    const body = parseBody<ListTransactionsResponse>(res);
    expect(body.items.map((i) => i.txnId)).toEqual(['t5']);
  });
});
