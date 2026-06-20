import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type {
  ErrorEnvelope,
  ReportsFlowResponse,
  ReportsTrendsResponse,
} from '@goldfinch/shared/types';
import { currentMonthInTz } from '../src/dates.js';
import { handler } from '../src/handler.js';
import { makeCategoryItem, makeEvent, makeTxnItem, parseBody, setTestEnv } from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

const MONTH = currentMonthInTz('America/New_York');

/** Routes the categories prefix query vs the TXN BETWEEN range query. */
function mockData(txns: unknown[], categories: unknown[] = defaultCategories()): void {
  ddbMock.on(QueryCommand).callsFake((input: Record<string, unknown>) => {
    const values = input['ExpressionAttributeValues'] as Record<string, unknown>;
    if (values[':prefix'] === 'CATEGORY#') {
      return { Items: categories };
    }
    return { Items: txns };
  });
}

function defaultCategories() {
  return [
    makeCategoryItem('salary', 'INCOME', { name: 'Salary' }),
    makeCategoryItem('groceries', 'EXPENSE', { name: 'Groceries' }),
    makeCategoryItem('dining', 'EXPENSE', { name: 'Dining Out' }),
    makeCategoryItem('cc-payment', 'TRANSFER', { name: 'CC Payment' }),
  ];
}

describe('GET /reports/trends', () => {
  it('returns the default trailing window with per-currency month slices', async () => {
    mockData([
      makeTxnItem({
        SK: `TXN#${MONTH}-02#t-pay`,
        amountMinor: 500_000,
        categoryId: 'salary',
      }),
      makeTxnItem({ SK: `TXN#${MONTH}-03#t-food`, amountMinor: -4215, categoryId: 'groceries' }),
      makeTxnItem({
        SK: `TXN#${MONTH}-04#t-eur`,
        amountMinor: -2000,
        currency: 'EUR',
        categoryId: 'dining',
      }),
    ]);
    const res = await handler(makeEvent({ routeKey: 'GET /reports/trends' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody<ReportsTrendsResponse>(res);
    expect(body.months).toHaveLength(6);
    expect(body.months[5]!.month).toBe(MONTH);
    // Empty months carry an empty per-currency array, never zero-filled fakes.
    expect(body.months[0]!.perCurrency).toEqual([]);

    const current = body.months[5]!;
    expect(current.perCurrency.map((s) => s.currency)).toEqual(['EUR', 'USD']);
    const usd = current.perCurrency[1]!;
    expect(usd.incomeMinor).toBe(500_000);
    expect(usd.expenseMinor).toBe(4215);
    expect(usd.netMinor).toBe(495_785);
    expect(usd.net).toBe('4957.85');
    const eur = current.perCurrency[0]!;
    expect(eur.expenseMinor).toBe(2000);
    expect(eur.netMinor).toBe(-2000);
  });

  it('excludes pending rows, transfer rows, and TRANSFER-typed categories', async () => {
    mockData([
      makeTxnItem({ SK: `TXN#${MONTH}-02#t-pending`, pending: true, amountMinor: -100 }),
      makeTxnItem({ SK: `TXN#${MONTH}-03#t-transfer`, isTransfer: true, amountMinor: -200 }),
      makeTxnItem({
        SK: `TXN#${MONTH}-04#t-cc`,
        categoryId: 'cc-payment',
        amountMinor: -300,
      }),
    ]);
    const body = parseBody<ReportsTrendsResponse>(
      await handler(makeEvent({ routeKey: 'GET /reports/trends' })),
    );
    expect(body.months[5]!.perCurrency).toEqual([]);
  });

  it('honors ?months and caps it', async () => {
    mockData([]);
    const body = parseBody<ReportsTrendsResponse>(
      await handler(makeEvent({ routeKey: 'GET /reports/trends', query: { months: '2' } })),
    );
    expect(body.months).toHaveLength(2);
    expect(body.months[1]!.month).toBe(MONTH);

    const tooMany = await handler(
      makeEvent({ routeKey: 'GET /reports/trends', query: { months: '37' } }),
    );
    expect(tooMany.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(tooMany).error.code).toBe('RANGE_TOO_LARGE');
  });

  it.each(['0', '-3', 'six', '2.5'])('rejects months=%s with 400', async (months) => {
    mockData([]);
    const res = await handler(
      makeEvent({ routeKey: 'GET /reports/trends', query: { months } }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /reports/flow', () => {
  function flowEvent(month?: string) {
    return makeEvent({
      routeKey: 'GET /reports/flow',
      query: month === undefined ? undefined : { month },
    });
  }

  it('groups income -> category spend per currency, categories sorted by amount desc', async () => {
    mockData([
      makeTxnItem({ SK: 'TXN#2026-05-01#t-pay', amountMinor: 500_000, categoryId: 'salary' }),
      makeTxnItem({ SK: 'TXN#2026-05-02#t-g1', amountMinor: -30_000, categoryId: 'groceries' }),
      makeTxnItem({ SK: 'TXN#2026-05-03#t-g2', amountMinor: -10_000, categoryId: 'groceries' }),
      makeTxnItem({ SK: 'TXN#2026-05-04#t-d', amountMinor: -45_000, categoryId: 'dining' }),
      makeTxnItem({ SK: 'TXN#2026-05-05#t-unc', amountMinor: -5_000, categoryId: null }),
    ]);
    const res = await handler(flowEvent('2026-05'));
    expect(res.statusCode).toBe(200);
    const body = parseBody<ReportsFlowResponse>(res);
    expect(body.month).toBe('2026-05');
    expect(body.perCurrency).toHaveLength(1);
    const usd = body.perCurrency[0]!;
    expect(usd.currency).toBe('USD');
    expect(usd.incomeMinor).toBe(500_000);
    expect(usd.expenseMinor).toBe(90_000);
    expect(usd.netMinor).toBe(410_000);
    expect(usd.categories.map((c) => [c.categoryId, c.amountMinor])).toEqual([
      ['dining', 45_000],
      ['groceries', 40_000],
      [null, 5_000],
    ]);
    expect(usd.categories[0]!.categoryName).toBe('Dining Out');
    expect(usd.categories[2]!.categoryName).toBe('Uncategorized');
  });

  it('keeps currencies separate (no synthetic mixed totals, P7-7)', async () => {
    mockData([
      makeTxnItem({ SK: 'TXN#2026-05-01#t-usd', amountMinor: -1000, categoryId: 'groceries' }),
      makeTxnItem({
        SK: 'TXN#2026-05-02#t-eur',
        amountMinor: -2000,
        currency: 'EUR',
        categoryId: 'groceries',
      }),
    ]);
    const body = parseBody<ReportsFlowResponse>(await handler(flowEvent('2026-05')));
    expect(body.perCurrency.map((g) => [g.currency, g.expenseMinor])).toEqual([
      ['EUR', 2000],
      ['USD', 1000],
    ]);
  });

  it('falls back to the slug when a category definition is missing', async () => {
    mockData(
      [makeTxnItem({ SK: 'TXN#2026-05-01#t-1', amountMinor: -100, categoryId: 'mystery' })],
      [],
    );
    const body = parseBody<ReportsFlowResponse>(await handler(flowEvent('2026-05')));
    expect(body.perCurrency[0]!.categories[0]!.categoryName).toBe('mystery');
  });

  it('requires a well-formed ?month', async () => {
    expect((await handler(flowEvent())).statusCode).toBe(400);
    expect((await handler(flowEvent('2026-13'))).statusCode).toBe(400);
    expect((await handler(flowEvent('May'))).statusCode).toBe(400);
  });
});
