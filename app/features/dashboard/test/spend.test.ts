/**
 * Window flow-aggregation tests (lib/spend.ts; P11-5 This Week donut).
 * windowFlowByCurrency reshapes the periodWindow('weekly') transactions slice
 * into the exact /reports/flow per-currency / per-category structure the
 * dashboard donut consumes. Expected totals are hand-computed integer-minor
 * literals (R16 posture), never recomputed with the helper under test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CategoryType, TransactionDto } from '@goldfinch/shared/types';

import { windowFlowByCurrency } from '../lib/spend.js';

let seq = 0;

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

/** Resolver mirroring the real id -> name lookup over a few categories. */
const NAMES: Readonly<Record<string, string>> = {
  groceries: 'Groceries',
  dining: 'Dining out',
  rent: 'Rent',
  transfers: 'Transfers',
};
const nameFor = (categoryId: string): string | undefined => NAMES[categoryId];

/**
 * Type resolver mirroring the SpendingCard useCategoriesQuery lookup. Only the
 * 'transfers' slug is TRANSFER; everything else is EXPENSE/INCOME or unknown
 * (undefined for an archived/missing id, treated as "not a transfer").
 */
const TYPES: Readonly<Record<string, CategoryType>> = {
  groceries: 'EXPENSE',
  dining: 'EXPENSE',
  rent: 'EXPENSE',
  transfers: 'TRANSFER',
};
const typeFor = (categoryId: string): CategoryType | undefined => TYPES[categoryId];

describe('windowFlowByCurrency', () => {
  it('buckets expense magnitudes per category, names resolved, sorted desc', () => {
    const groups = windowFlowByCurrency(
      [
        txn({ categoryId: 'dining', amountMinor: -1_200 }),
        txn({ categoryId: 'groceries', amountMinor: -4_215 }),
        txn({ categoryId: 'dining', amountMinor: -800 }),
        txn({ categoryId: 'groceries', amountMinor: -1_000 }),
      ],
      nameFor,
      typeFor,
    );
    assert.equal(groups.length, 1);
    const group = groups[0]!;
    assert.equal(group.currency, 'USD');
    // expenseMinor = 4215 + 1000 + 1200 + 800 = 7215.
    assert.equal(group.expenseMinor, 7_215);
    assert.deepEqual(group.categories, [
      { categoryId: 'groceries', categoryName: 'Groceries', amount: '', amountMinor: 5_215 },
      { categoryId: 'dining', categoryName: 'Dining out', amount: '', amountMinor: 2_000 },
    ]);
  });

  it('puts the null category in an "Uncategorized" bucket', () => {
    const groups = windowFlowByCurrency(
      [
        txn({ categoryId: null, amountMinor: -500 }),
        txn({ categoryId: 'rent', amountMinor: -300 }),
      ],
      nameFor,
      typeFor,
    );
    const group = groups[0]!;
    assert.deepEqual(group.categories, [
      { categoryId: null, categoryName: 'Uncategorized', amount: '', amountMinor: 500 },
      { categoryId: 'rent', categoryName: 'Rent', amount: '', amountMinor: 300 },
    ]);
  });

  it('falls back to the categoryId when its name cannot be resolved', () => {
    const groups = windowFlowByCurrency(
      [txn({ categoryId: 'archived-cat', amountMinor: -700 })],
      nameFor,
      typeFor,
    );
    assert.deepEqual(groups[0]!.categories, [
      { categoryId: 'archived-cat', categoryName: 'archived-cat', amount: '', amountMinor: 700 },
    ]);
  });

  it('excludes income, zero, and transfer legs', () => {
    const groups = windowFlowByCurrency(
      [
        txn({ categoryId: 'groceries', amountMinor: -1_000 }), // expense
        txn({ categoryId: 'rent', amountMinor: 250_000 }), // income -> excluded
        txn({ categoryId: 'dining', amountMinor: 0 }), // zero -> excluded
        txn({ categoryId: 'rent', amountMinor: -50_000, isTransfer: true }), // transfer -> excluded
      ],
      nameFor,
      typeFor,
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.expenseMinor, 1_000);
    assert.deepEqual(groups[0]!.categories, [
      { categoryId: 'groceries', categoryName: 'Groceries', amount: '', amountMinor: 1_000 },
    ]);
  });

  it('groups per currency in first-seen order, each with its own expense total', () => {
    const groups = windowFlowByCurrency(
      [
        txn({ currency: 'USD', categoryId: 'groceries', amountMinor: -1_000 }),
        txn({ currency: 'EUR', categoryId: 'dining', amountMinor: -2_000 }),
        txn({ currency: 'USD', categoryId: 'groceries', amountMinor: -500 }),
      ],
      nameFor,
      typeFor,
    );
    assert.equal(groups.length, 2);
    assert.equal(groups[0]!.currency, 'USD');
    assert.equal(groups[0]!.expenseMinor, 1_500);
    assert.equal(groups[1]!.currency, 'EUR');
    assert.equal(groups[1]!.expenseMinor, 2_000);
  });

  it('zeroes the flow income/net fields (expense-only weekly donut)', () => {
    const group = windowFlowByCurrency(
      [txn({ categoryId: 'rent', amountMinor: -300 })],
      nameFor,
      typeFor,
    )[0]!;
    assert.equal(group.incomeMinor, 0);
    assert.equal(group.netMinor, 0);
    assert.equal(group.income, '');
    assert.equal(group.net, '');
    assert.equal(group.expense, '');
  });

  it('returns an empty list when no expenses are present', () => {
    assert.deepEqual(
      windowFlowByCurrency(
        [
          txn({ amountMinor: 9_999 }), // income only
          txn({ amountMinor: -1, isTransfer: true }), // transfer only
        ],
        nameFor,
        typeFor,
      ),
      [],
    );
  });

  it('returns an empty list for no transactions', () => {
    assert.deepEqual(windowFlowByCurrency([], nameFor, typeFor), []);
  });

  it('excludes a TRANSFER-categorized expense even when isTransfer is false', () => {
    // The credit-card-payoff parity case: a negative row filed under a TRANSFER
    // category but with the per-row flag still unset. The server flow/cashflow
    // drop it; the weekly donut must too.
    const groups = windowFlowByCurrency(
      [
        txn({ categoryId: 'groceries', amountMinor: -1_000 }), // real expense
        txn({ categoryId: 'transfers', amountMinor: -120_000, isTransfer: false }), // cc payment
      ],
      nameFor,
      typeFor,
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.expenseMinor, 1_000);
    assert.deepEqual(groups[0]!.categories, [
      { categoryId: 'groceries', categoryName: 'Groceries', amount: '', amountMinor: 1_000 },
    ]);
  });

  it('still excludes an isTransfer=true row whose category is not TRANSFER', () => {
    // Belt-and-suspenders: the per-row flag alone excludes, independent of type.
    const groups = windowFlowByCurrency(
      [
        txn({ categoryId: 'groceries', amountMinor: -1_000 }),
        txn({ categoryId: 'groceries', amountMinor: -50_000, isTransfer: true }),
      ],
      nameFor,
      typeFor,
    );
    assert.equal(groups[0]!.expenseMinor, 1_000);
  });

  it('treats an unknown/archived category type as not-a-transfer (counts normally)', () => {
    // typeFor returns undefined for 'archived-cat'; the negative non-transfer
    // row counts as spend, matching the server's sign fallback.
    const groups = windowFlowByCurrency(
      [txn({ categoryId: 'archived-cat', amountMinor: -700 })],
      nameFor,
      typeFor,
    );
    assert.equal(groups[0]!.expenseMinor, 700);
  });

  it('does not exclude a positive TRANSFER row as spend (income is already dropped)', () => {
    // A funding deposit (positive) is dropped by the income guard; the TRANSFER
    // guard never even runs on it. No spend is produced.
    const groups = windowFlowByCurrency(
      [txn({ categoryId: 'transfers', amountMinor: 120_000, isTransfer: false })],
      nameFor,
      typeFor,
    );
    assert.deepEqual(groups, []);
  });
});
