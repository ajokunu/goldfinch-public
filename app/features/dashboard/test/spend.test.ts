/**
 * Window spend-aggregation tests (lib/spend.ts; P11-5 This Week figure).
 * Expected totals are hand-computed integer-minor literals (R16 posture),
 * never recomputed with the helper under test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TransactionDto } from '@goldfinch/shared/types';

import { windowExpenseByCurrency } from '../lib/spend.js';

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

describe('windowExpenseByCurrency', () => {
  it('sums expense magnitudes, excluding income and transfers', () => {
    const result = windowExpenseByCurrency([
      txn({ amountMinor: -4_215 }), // expense
      txn({ amountMinor: -1_200 }), // expense
      txn({ amountMinor: 250_000 }), // income -> excluded
      txn({ amountMinor: 0 }), // zero -> excluded
      txn({ amountMinor: -50_000, isTransfer: true }), // transfer -> excluded
    ]);
    assert.deepEqual(result, [{ currency: 'USD', expenseMinor: 5_415 }]);
  });

  it('groups per currency in first-seen order', () => {
    const result = windowExpenseByCurrency([
      txn({ amountMinor: -1_000, currency: 'USD' }),
      txn({ amountMinor: -2_000, currency: 'EUR' }),
      txn({ amountMinor: -500, currency: 'USD' }),
    ]);
    assert.deepEqual(result, [
      { currency: 'USD', expenseMinor: 1_500 },
      { currency: 'EUR', expenseMinor: 2_000 },
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

  it('excludes a pending expense leg (parity with server flow/cashflow)', () => {
    const groups = windowFlowByCurrency(
      [
        txn({ categoryId: 'groceries', amountMinor: -1_000 }), // posted -> counts
        txn({ categoryId: 'dining', amountMinor: -9_999, pending: true }), // pending -> excluded
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
      windowExpenseByCurrency([
        txn({ amountMinor: 9_999 }), // income only
        txn({ amountMinor: -1, isTransfer: true }), // transfer only
      ]),
      [],
    );
  });

  it('returns an empty list for no transactions', () => {
    assert.deepEqual(windowExpenseByCurrency([]), []);
  });
});
