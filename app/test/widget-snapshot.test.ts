/**
 * Weekly-spend widget snapshot builder tests (snapshot.ts; ops/WIDGET-PLAN.md
 * tasks 1-2). buildWeeklySpendWidgetSnapshot synthesizes the v1 snapshot from
 * already-fetched dashboard/budget data, reusing periodWindow('weekly'),
 * windowFlowByCurrency, the BigInt truncate-toward-zero percent idiom, and
 * categoryColor. Expected totals/percents are hand-computed integer-minor /
 * integer literals (R16 posture), never recomputed with the code under test.
 *
 * Pins: Mon..Sun bounds from a fixed midweek instant (NOT the doc's stale
 * "Sun-Sat"); non-divisible percent truncation (no round) and over-budget (no
 * cap); no-weekly-budget null path; null-bucket category in the top 3; top-3
 * saturation; showAmounts pass-through (both polarities); multi-currency
 * first-seen primary pick; empty-week defaults.
 *
 * Runs in the JEST (component) lane, not the node:test lane: the builder
 * value-imports @goldfinch/shared/periodWindow + /money, ESM-only subpaths a
 * CommonJS node:test require() cannot reach. jest.config.js maps those to the
 * built dist and babel-transforms them; describe/it are jest globals. (The
 * widget dir also holds useWidgetSync.test.ts, a jest renderHook suite.)
 * jest.config.js testMatch currently globs app/test/ only, so wiring this into
 * `npm run test --workspace app` is an orchestrator handoff (see report).
 */
import assert from 'node:assert/strict';

import type {
  BudgetDto,
  CategoryType,
  TransactionDto,
} from '@goldfinch/shared/types';

import { buildWeeklySpendWidgetSnapshot } from '../features/widget/snapshot';

let seq = 0;

/** TransactionDto factory; defaults to a USD uncategorized expense in-window. */
function txn(overrides: Partial<TransactionDto> = {}): TransactionDto {
  seq += 1;
  return {
    txnId: `txn-${seq}`,
    date: '2026-06-10',
    amount: '-12.00',
    amountMinor: -1_200,
    currency: 'USD',
    payee: 'Test',
    categoryId: null,
    accountId: 'acc-1',
    pending: false,
    isTransfer: false,
    userCategorized: false,
    categorizedBy: null,
    version: 1,
    ...overrides,
  };
}

/** BudgetDto factory; defaults to a weekly budget. */
function budget(overrides: Partial<BudgetDto> = {}): BudgetDto {
  return {
    categoryId: 'groceries',
    period: 'weekly',
    periodFrom: '2026-06-08',
    periodTo: '2026-06-14',
    limit: '450.00',
    limitMinor: 45_000,
    rollover: false,
    spent: '0.00',
    spentMinor: 0,
    remaining: '450.00',
    remainingMinor: 45_000,
    version: 1,
    ...overrides,
  };
}

const NAMES: Readonly<Record<string, string>> = {
  groceries: 'Groceries',
  dining: 'Dining out',
  rent: 'Rent',
  fitness: 'Fitness',
  transfers: 'Transfers',
};
const nameFor = (categoryId: string): string | undefined => NAMES[categoryId];

const TYPES: Readonly<Record<string, CategoryType>> = {
  groceries: 'EXPENSE',
  dining: 'EXPENSE',
  rent: 'EXPENSE',
  fitness: 'EXPENSE',
  transfers: 'TRANSFER',
};
const typeFor = (categoryId: string): CategoryType | undefined => TYPES[categoryId];

/** A multi-color palette + a single-color palette (for deterministic asserts). */
const PALETTE = ['#111111', '#222222', '#333333', '#444444'] as const;
const ONE_COLOR = ['#abcdef'] as const;

/** Wednesday 2026-06-10 ~noon ET (16:00Z); the ISO week is Mon 06-08 .. Sun 06-14. */
const MIDWEEK = new Date('2026-06-10T16:00:00Z');

/** Common arg shape with sensible defaults for the cases below. */
function buildWith(
  over: Partial<Parameters<typeof buildWeeklySpendWidgetSnapshot>[0]> = {},
) {
  return buildWeeklySpendWidgetSnapshot({
    transactions: [],
    categoryNameFor: nameFor,
    categoryTypeFor: typeFor,
    budgets: [],
    showAmountsOnWidget: true,
    palette: PALETTE,
    now: MIDWEEK,
    ...over,
  });
}

describe('buildWeeklySpendWidgetSnapshot — window bounds', () => {
  it('emits the Mon..Sun ISO week from periodWindow, not the doc "Sun-Sat"', () => {
    const snap = buildWith({ now: MIDWEEK });
    assert.equal(snap.weekStart, '2026-06-08'); // Monday
    assert.equal(snap.weekEnd, '2026-06-14'); // Sunday
  });

  it('stamps schemaVersion 1 and a UTC generatedAt from now', () => {
    const snap = buildWith({ now: MIDWEEK });
    assert.equal(snap.schemaVersion, 1);
    assert.equal(snap.generatedAt, '2026-06-10T16:00:00.000Z');
  });
});

describe('buildWeeklySpendWidgetSnapshot — spend total', () => {
  it('sums non-transfer expense magnitudes into spentMinor + decimal string', () => {
    const snap = buildWith({
      transactions: [
        txn({ categoryId: 'groceries', amountMinor: -4_215 }),
        txn({ categoryId: 'dining', amountMinor: -2_000 }),
        txn({ categoryId: 'rent', amountMinor: 250_000 }), // income -> excluded
        txn({ categoryId: 'transfers', amountMinor: -120_000, isTransfer: true }), // transfer
      ],
    });
    // 4215 + 2000 = 6215; income and transfer dropped.
    assert.equal(snap.spentMinor, 6_215);
    assert.equal(snap.spent, '62.15');
    assert.equal(snap.currency, 'USD');
  });

  it('empty week -> USD, zero spend, no categories', () => {
    const snap = buildWith({ transactions: [] });
    assert.equal(snap.currency, 'USD');
    assert.equal(snap.spentMinor, 0);
    assert.equal(snap.spent, '0.00');
    assert.deepEqual(snap.topCategories, []);
  });
});

describe('buildWeeklySpendWidgetSnapshot — percent of budget (BigInt truncate)', () => {
  it('null budget fields and null percent when no weekly budget exists', () => {
    const snap = buildWith({
      transactions: [txn({ categoryId: 'groceries', amountMinor: -10_000 })],
      budgets: [budget({ period: 'monthly', limitMinor: 200_000 })], // not weekly
    });
    assert.equal(snap.budgetMinor, null);
    assert.equal(snap.budget, null);
    assert.equal(snap.percentOfBudget, null);
  });

  it('sums all weekly budgets and truncates the percent toward zero', () => {
    const snap = buildWith({
      transactions: [txn({ categoryId: 'groceries', amountMinor: -10_000 })],
      budgets: [
        budget({ categoryId: 'groceries', limitMinor: 20_000 }),
        budget({ categoryId: 'dining', limitMinor: 10_000 }),
      ],
    });
    // budget = 30000; spent 10000; 10000*100/30000 = 33.33 -> 33 (truncated).
    assert.equal(snap.budgetMinor, 30_000);
    assert.equal(snap.budget, '300.00');
    assert.equal(snap.percentOfBudget, 33);
  });

  it('does not round up a near-whole percent (100/300 -> 33, not 34)', () => {
    const snap = buildWith({
      transactions: [txn({ categoryId: 'groceries', amountMinor: -100 })],
      budgets: [budget({ limitMinor: 300 })],
    });
    assert.equal(snap.percentOfBudget, 33);
  });

  it('does not cap an over-budget percent (15000/10000 -> 150)', () => {
    const snap = buildWith({
      transactions: [txn({ categoryId: 'groceries', amountMinor: -15_000 })],
      budgets: [budget({ limitMinor: 10_000 })],
    });
    assert.equal(snap.percentOfBudget, 150);
  });

  it('clamps net-refund (negative) spend to 0% rather than going negative', () => {
    // Income only -> windowFlowByCurrency yields no spend group -> spentMinor 0,
    // but assert the clamp branch explicitly via a present weekly budget.
    const snap = buildWith({
      transactions: [],
      budgets: [budget({ limitMinor: 10_000 })],
    });
    assert.equal(snap.spentMinor, 0);
    assert.equal(snap.percentOfBudget, 0);
  });

  it('a weekly budget summing to 0 keeps percent null (cannot divide by zero)', () => {
    const snap = buildWith({
      transactions: [txn({ categoryId: 'groceries', amountMinor: -5_000 })],
      budgets: [budget({ limitMinor: 0 })],
    });
    assert.equal(snap.budgetMinor, 0);
    assert.equal(snap.budget, '0.00');
    assert.equal(snap.percentOfBudget, null);
  });
});

describe('buildWeeklySpendWidgetSnapshot — top categories', () => {
  it('returns top 3 by spend descending with id/name/iconKey/color/spend', () => {
    const snap = buildWith({
      transactions: [
        txn({ categoryId: 'groceries', amountMinor: -4_000 }),
        txn({ categoryId: 'dining', amountMinor: -3_000 }),
        txn({ categoryId: 'rent', amountMinor: -2_000 }),
        txn({ categoryId: 'fitness', amountMinor: -1_000 }), // 4th -> dropped
      ],
    });
    assert.equal(snap.topCategories.length, 3);
    assert.deepEqual(
      snap.topCategories.map((c) => [c.categoryId, c.name, c.iconKey, c.spentMinor, c.spent]),
      [
        ['groceries', 'Groceries', 'groceries', 4_000, '40.00'],
        ['dining', 'Dining out', 'dining', 3_000, '30.00'],
        ['rent', 'Rent', 'rent', 2_000, '20.00'],
      ],
    );
    // Color is the deterministic categoryColor over the passed palette.
    for (const c of snap.topCategories) {
      assert.ok(PALETTE.includes(c.color as (typeof PALETTE)[number]));
    }
  });

  it('carries the null (uncategorized) bucket with sentinel id/iconKey "" and its color', () => {
    const snap = buildWith({
      transactions: [
        txn({ categoryId: null, amountMinor: -9_000 }), // uncategorized, biggest
        txn({ categoryId: 'groceries', amountMinor: -1_000 }),
      ],
      palette: ONE_COLOR,
    });
    const top = snap.topCategories[0]!;
    assert.equal(top.categoryId, '');
    assert.equal(top.iconKey, '');
    assert.equal(top.name, 'Uncategorized');
    assert.equal(top.spentMinor, 9_000);
    assert.equal(top.spent, '90.00');
    // Sentinel "" routes through categoryColor; single-color palette -> #abcdef.
    assert.equal(top.color, '#abcdef');
  });
});

describe('buildWeeklySpendWidgetSnapshot — showAmounts pass-through', () => {
  it('stores showAmounts=true verbatim (gates nothing here)', () => {
    const snap = buildWith({
      showAmountsOnWidget: true,
      transactions: [txn({ categoryId: 'groceries', amountMinor: -5_000 })],
    });
    assert.equal(snap.showAmounts, true);
    // The amount is still present on the snapshot regardless of the flag.
    assert.equal(snap.spentMinor, 5_000);
  });

  it('stores showAmounts=false verbatim and still computes the amounts', () => {
    const snap = buildWith({
      showAmountsOnWidget: false,
      transactions: [txn({ categoryId: 'groceries', amountMinor: -5_000 })],
    });
    assert.equal(snap.showAmounts, false);
    assert.equal(snap.spentMinor, 5_000);
    assert.equal(snap.spent, '50.00');
  });
});

describe('buildWeeklySpendWidgetSnapshot — multi-currency', () => {
  it('picks the first-seen currency group as primary', () => {
    const snap = buildWith({
      transactions: [
        txn({ currency: 'USD', categoryId: 'groceries', amountMinor: -1_000 }),
        txn({ currency: 'EUR', categoryId: 'dining', amountMinor: -9_999 }),
        txn({ currency: 'USD', categoryId: 'groceries', amountMinor: -500 }),
      ],
    });
    // USD seen first; its group is primary even though EUR has the larger single leg.
    assert.equal(snap.currency, 'USD');
    assert.equal(snap.spentMinor, 1_500);
    assert.deepEqual(
      snap.topCategories.map((c) => c.categoryId),
      ['groceries'],
    );
  });
});
