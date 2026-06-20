import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { CashflowResponse, ErrorEnvelope } from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import {
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

const CATEGORIES = [
  makeCategoryItem('paycheck', 'INCOME'),
  makeCategoryItem('groceries', 'EXPENSE'),
  makeCategoryItem('transfer', 'TRANSFER'),
];

const TXNS = [
  // May income.
  makeTxnItem({ SK: 'TXN#2026-05-01#t1', amountMinor: 500_000, categoryId: 'paycheck' }),
  // May expenses.
  makeTxnItem({ SK: 'TXN#2026-05-05#t2', amountMinor: -12_500, categoryId: 'groceries' }),
  makeTxnItem({ SK: 'TXN#2026-05-06#t3', amountMinor: -7_500, categoryId: 'groceries' }),
  // Refund inside an expense category reduces expense, not income.
  makeTxnItem({ SK: 'TXN#2026-05-07#t4', amountMinor: 2_000, categoryId: 'groceries' }),
  // Excluded: transfer category, isTransfer flag, pending.
  makeTxnItem({ SK: 'TXN#2026-05-08#t5', amountMinor: -90_000, categoryId: 'transfer' }),
  makeTxnItem({ SK: 'TXN#2026-05-09#t6', amountMinor: -90_000, isTransfer: true }),
  makeTxnItem({ SK: 'TXN#2026-05-10#t7', amountMinor: -5_000, pending: true }),
  // Uncategorized rows classify by sign.
  makeTxnItem({ SK: 'TXN#2026-06-01#t8', amountMinor: 10_000 }),
  makeTxnItem({ SK: 'TXN#2026-06-02#t9', amountMinor: -4_000 }),
];

function mockQueries(): void {
  ddbMock.on(QueryCommand).callsFake((input: Record<string, unknown>) => {
    const values = input['ExpressionAttributeValues'] as Record<string, unknown>;
    if (values[':prefix'] === 'CATEGORY#') return { Items: CATEGORIES };
    return { Items: TXNS };
  });
}

describe('GET /cashflow', () => {
  it('computes per-month income/expense/net, excluding transfers and pending', async () => {
    mockQueries();
    const res = await handler(
      makeEvent({ routeKey: 'GET /cashflow', query: { from: '2026-05', to: '2026-06' } }),
    );
    expect(res.statusCode).toBe(200);
    const body = parseBody<CashflowResponse>(res);

    expect(body.months).toHaveLength(2);
    const may = body.months[0]!;
    expect(may.month).toBe('2026-05');
    expect(may.incomeMinor).toBe(500_000);
    expect(may.income).toBe('5000.00');
    expect(may.expenseMinor).toBe(18_000); // 12500 + 7500 - 2000 refund
    expect(may.netMinor).toBe(482_000);

    const june = body.months[1]!;
    expect(june.incomeMinor).toBe(10_000);
    expect(june.expenseMinor).toBe(4_000);
    expect(june.netMinor).toBe(6_000);

    expect(body.totals.incomeMinor).toBe(510_000);
    expect(body.totals.expenseMinor).toBe(22_000);
    expect(body.totals.netMinor).toBe(488_000);
    expect(body.totals.net).toBe('4880.00');
  });

  it('accepts ?month= as a single-month shorthand and queries that month bounds', async () => {
    mockQueries();
    const res = await handler(
      makeEvent({ routeKey: 'GET /cashflow', query: { month: '2026-05' } }),
    );
    expect(res.statusCode).toBe(200);
    const body = parseBody<CashflowResponse>(res);
    expect(body.months).toHaveLength(1);
    expect(body.months[0]!.month).toBe('2026-05');

    const txnQuery = ddbMock
      .commandCalls(QueryCommand)
      .map((call) => call.args[0].input)
      .find((input) => input.KeyConditionExpression?.includes('BETWEEN'))!;
    expect(txnQuery.ExpressionAttributeValues).toMatchObject({
      ':start': 'TXN#2026-05-01',
      ':end': 'TXN#2026-05-31~',
    });
  });

  it('rejects a malformed month with 400', async () => {
    const res = await handler(
      makeEvent({ routeKey: 'GET /cashflow', query: { month: '2026-13' } }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects ranges beyond the month cap with RANGE_TOO_LARGE', async () => {
    const res = await handler(
      makeEvent({ routeKey: 'GET /cashflow', query: { from: '2020-01', to: '2026-01' } }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('RANGE_TOO_LARGE');
  });
});
