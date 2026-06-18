/** Rollup math, month helpers, and digest idempotency for the monthly summary. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TransactionItem } from '@goldfinch/shared/types';

import type { CategoryDescriptor } from '../src/bedrock.js';
import {
  addMonths,
  averageRollups,
  buildInsightSummaryItem,
  buildSummaryUserPrompt,
  computeInputDigest,
  computeMonthRollups,
  insightSummarySk,
  monthOf,
  monthRange,
  previousMonth,
  stableStringify,
  SummaryError,
} from '../src/summary.js';

const CATEGORIES = new Map<string, CategoryDescriptor>([
  ['groceries', { categoryId: 'groceries', name: 'Groceries', type: 'EXPENSE' }],
  ['salary', { categoryId: 'salary', name: 'Salary', type: 'INCOME' }],
  ['cc-payment', { categoryId: 'cc-payment', name: 'CC Payment', type: 'TRANSFER' }],
]);

interface FakeTxnInput {
  amountMinor: number;
  categoryId?: string | null;
  pending?: boolean;
  isTransfer?: boolean;
}

// Only the fields computeMonthRollups touches; cast keeps the fake minimal.
function fakeTxn(input: FakeTxnInput): TransactionItem {
  return {
    amountMinor: input.amountMinor,
    categoryId: input.categoryId ?? null,
    pending: input.pending ?? false,
    isTransfer: input.isTransfer ?? false,
  } as unknown as TransactionItem;
}

describe('month helpers', () => {
  it('monthOf / previousMonth / addMonths', () => {
    assert.equal(monthOf('2026-06-09'), '2026-06');
    assert.equal(previousMonth('2026-01'), '2025-12');
    assert.equal(addMonths('2026-06', -3), '2026-03');
    assert.equal(addMonths('2025-11', 2), '2026-01');
  });

  it('monthRange handles month lengths and leap years', () => {
    assert.deepEqual(monthRange('2026-06'), { from: '2026-06-01', to: '2026-06-30' });
    assert.deepEqual(monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
    assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  });

  it('rejects malformed months', () => {
    assert.throws(() => monthRange('2026-6' as never), SummaryError);
    assert.throws(() => insightSummarySk('garbage' as never), SummaryError);
  });
});

describe('computeMonthRollups', () => {
  it('aggregates income and categorized spend in integer minor units', () => {
    const rollups = computeMonthRollups(
      '2026-05',
      [
        fakeTxn({ amountMinor: -4550, categoryId: 'groceries' }),
        fakeTxn({ amountMinor: -1050, categoryId: 'groceries' }),
        fakeTxn({ amountMinor: 500_000, categoryId: 'salary' }),
        fakeTxn({ amountMinor: -999 }), // uncategorized spend
      ],
      CATEGORIES,
    );
    assert.equal(rollups.incomeMinor, 500_000);
    assert.equal(rollups.expenseMinor, 4550 + 1050 + 999);
    assert.equal(rollups.byCategoryMinor['groceries'], 5600);
    assert.equal(rollups.uncategorizedExpenseMinor, 999);
    assert.equal(rollups.txnCount, 4);
  });

  it('excludes pending, transfer-flagged, and TRANSFER-category transactions', () => {
    const rollups = computeMonthRollups(
      '2026-05',
      [
        fakeTxn({ amountMinor: -10_000, pending: true }),
        fakeTxn({ amountMinor: -20_000, isTransfer: true }),
        fakeTxn({ amountMinor: -30_000, categoryId: 'cc-payment' }),
        fakeTxn({ amountMinor: -100, categoryId: 'groceries' }),
      ],
      CATEGORIES,
    );
    assert.equal(rollups.expenseMinor, 100);
    assert.equal(rollups.txnCount, 1);
  });

  it('a refund inside an expense category reduces nothing but counts as income', () => {
    const rollups = computeMonthRollups(
      '2026-05',
      [fakeTxn({ amountMinor: 1500, categoryId: 'groceries' })],
      CATEGORIES,
    );
    assert.equal(rollups.incomeMinor, 1500);
    assert.equal(rollups.expenseMinor, 0);
  });
});

describe('averageRollups', () => {
  const may = computeMonthRollups(
    '2026-05',
    [fakeTxn({ amountMinor: -1000, categoryId: 'groceries' })],
    CATEGORIES,
  );
  const april = computeMonthRollups(
    '2026-04',
    [fakeTxn({ amountMinor: -3000, categoryId: 'groceries' })],
    CATEGORIES,
  );
  const empty = computeMonthRollups('2026-03', [], CATEGORIES);

  it('averages only months with data', () => {
    const trailing = averageRollups([may, april, empty]);
    assert.equal(trailing.monthsUsed, 2);
    assert.equal(trailing.avgExpenseMinor, 2000);
    assert.equal(trailing.avgByCategoryMinor['groceries'], 2000);
  });

  it('is all zeros when no month has data', () => {
    const trailing = averageRollups([empty]);
    assert.equal(trailing.monthsUsed, 0);
    assert.equal(trailing.avgExpenseMinor, 0);
  });
});

describe('digest idempotency', () => {
  it('stableStringify sorts keys recursively', () => {
    assert.equal(
      stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }),
      '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
    );
  });

  it('digest is invariant to key order and changes with values', () => {
    const a = computeInputDigest({ month: '2026-05', x: 1, y: 2 });
    const b = computeInputDigest({ y: 2, x: 1, month: '2026-05' });
    const c = computeInputDigest({ month: '2026-05', x: 1, y: 3 });
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});

describe('prompt and item building', () => {
  const current = computeMonthRollups(
    '2026-05',
    [
      fakeTxn({ amountMinor: -123_45, categoryId: 'groceries' }),
      fakeTxn({ amountMinor: 500_000, categoryId: 'salary' }),
    ],
    CATEGORIES,
  );
  const trailing = averageRollups([current]);

  it('renders exact decimal strings and category display names', () => {
    const prompt = buildSummaryUserPrompt(current, trailing, CATEGORIES, 'USD');
    const parsed = JSON.parse(prompt) as Record<string, unknown>;
    assert.equal(parsed['totalSpending'], '123.45');
    assert.equal(parsed['income'], '5000.00');
    assert.deepEqual(parsed['spendingByCategory'], { Groceries: '123.45' });
  });

  it('builds the INSIGHT#SUMMARY item with key and digest', () => {
    const item = buildInsightSummaryItem(
      'goldfinch-home',
      '2026-05',
      'Spending was steady.',
      'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      'abc123',
      '2026-06-01T00:00:00Z',
    );
    assert.equal(item.PK, 'USER#goldfinch-home');
    assert.equal(item.SK, 'INSIGHT#SUMMARY#2026-05');
    assert.equal(item.entityType, 'INSIGHT_SUMMARY');
    assert.equal(item.inputDigest, 'abc123');
  });
});
