import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUDGET_ALERT_THRESHOLDS_PERCENT } from '@goldfinch/shared/budgetMath';
import {
  buildSentNotifItem,
  evaluateBudgetThresholds,
  sentNotifTtl,
  spendByCategory,
  type SpendTxnRow,
} from './budget.js';

const budgets = [
  { categoryId: 'dining', limitMinor: 10000 },
  { categoryId: 'groceries', limitMinor: 50000 },
  { categoryId: 'broken', limitMinor: 0 },
];
const categories = [
  { categoryId: 'dining', name: 'Dining' },
  { categoryId: 'groceries', name: 'Groceries' },
];

test('thresholds come from the SHARED budgetMath constant (80 and 100)', () => {
  assert.deepEqual([...BUDGET_ALERT_THRESHOLDS_PERCENT], [80, 100]);
});

test('spend below the lowest threshold produces no crossing', () => {
  const crossings = evaluateBudgetThresholds({
    spend: [{ categoryId: 'dining', spentMinor: 7999 }],
    budgets,
    categories,
  });
  assert.deepEqual(crossings, []);
});

test('crossing 80% reports the 80 threshold with shared integer percent math', () => {
  const crossings = evaluateBudgetThresholds({
    spend: [{ categoryId: 'dining', spentMinor: 8000 }],
    budgets,
    categories,
  });
  assert.equal(crossings.length, 1);
  const crossing = crossings[0]!;
  assert.equal(crossing.threshold, 80);
  assert.deepEqual(crossing.crossedThresholds, [80]);
  assert.equal(crossing.pctUsed, 80);
  assert.equal(crossing.categoryName, 'Dining');
});

test('jumping past 100% reports only the highest threshold but lists 80 as crossed too', () => {
  const crossings = evaluateBudgetThresholds({
    spend: [{ categoryId: 'dining', spentMinor: 10500 }],
    budgets,
    categories,
  });
  const crossing = crossings[0]!;
  assert.equal(crossing.threshold, 100);
  assert.deepEqual(crossing.crossedThresholds, [80, 100]);
  assert.equal(crossing.pctUsed, 105);
});

test('percent is floored, never rounded up across a threshold (shared semantics)', () => {
  // 39999/50000 = 79.998% -> floor 79 -> no crossing.
  const crossings = evaluateBudgetThresholds({
    spend: [{ categoryId: 'groceries', spentMinor: 39999 }],
    budgets,
    categories,
  });
  assert.deepEqual(crossings, []);
});

test('categories without a budget, with a zero limit, or with non-positive spend are skipped', () => {
  const crossings = evaluateBudgetThresholds({
    spend: [
      { categoryId: 'unbudgeted', spentMinor: 999999 },
      { categoryId: 'broken', spentMinor: 999999 },
      { categoryId: 'dining', spentMinor: 0 },
      { categoryId: 'dining', spentMinor: -500 },
    ],
    budgets,
    categories,
  });
  assert.deepEqual(crossings, []);
});

test('category name falls back to the slug when no CATEGORY# row matches', () => {
  const crossings = evaluateBudgetThresholds({
    spend: [{ categoryId: 'dining', spentMinor: 9000 }],
    budgets,
    categories: [],
  });
  assert.equal(crossings[0]!.categoryName, 'dining');
});

// ---------------------------------------------------------------------------
// spendByCategory (month-to-date aggregation over TRANSACTION rows)
// ---------------------------------------------------------------------------

function row(overrides: Partial<SpendTxnRow>): SpendTxnRow {
  return {
    categoryId: 'dining',
    amountMinor: -1000,
    GSI2PK: 'USER#goldfinch-home#CAT#dining' as SpendTxnRow['GSI2PK'],
    ...overrides,
  };
}

test('spendByCategory sums negative GSI2-indexed amounts per category as positive spend', () => {
  const spend = spendByCategory([
    row({ amountMinor: -2500 }),
    row({ amountMinor: -1500 }),
    row({ categoryId: 'groceries', amountMinor: -4200 }),
  ]);
  assert.deepEqual(
    spend.sort((a, b) => a.categoryId.localeCompare(b.categoryId)),
    [
      { categoryId: 'dining', spentMinor: 4000 },
      { categoryId: 'groceries', spentMinor: 4200 },
    ],
  );
});

test('spendByCategory skips rows outside the spend index, uncategorized rows, and income', () => {
  const spend = spendByCategory([
    row({ GSI2PK: undefined }), // not in the GSI2 spend index (transfer / income)
    row({ categoryId: null }), // uncategorized
    row({ amountMinor: 5000 }), // income / refund (positive)
    row({ amountMinor: 0 }),
  ]);
  assert.deepEqual(spend, []);
});

// ---------------------------------------------------------------------------
// markers
// ---------------------------------------------------------------------------

test('sentNotifTtl lands at the start of period + 2 months (UTC)', () => {
  assert.equal(sentNotifTtl('2026-06'), Date.UTC(2026, 7, 1) / 1000);
  // December rolls over the year boundary.
  assert.equal(sentNotifTtl('2026-12'), Date.UTC(2027, 1, 1) / 1000);
  assert.throws(() => sentNotifTtl('2026-6'), RangeError);
});

test('buildSentNotifItem produces the dedup marker keyed once per period/category/threshold', () => {
  const now = new Date('2026-06-09T16:47:00Z');
  const item = buildSentNotifItem('2026-06', 'dining', 80, now, 'goldfinch-home');
  assert.equal(item.PK, 'USER#goldfinch-home');
  assert.equal(item.SK, 'SENTNOTIF#2026-06#dining#80');
  assert.equal(item.entityType, 'SENT_NOTIF');
  assert.equal(item.threshold, 80);
  assert.equal(item.period, '2026-06');
  assert.equal(item.sentAt, '2026-06-09T16:47:00.000Z');
  assert.equal(item.ttl, sentNotifTtl('2026-06'));
});
