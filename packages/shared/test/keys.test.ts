/** computeGsi2Keys: the single source of truth for the sparse GSI2 rule. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { KeyError, computeGsi2Keys } from '../src/keys.js';

const base = {
  household: 'goldfinch-home',
  categoryId: 'groceries',
  date: '2026-05-10',
  txnId: 'txn-1',
} as const;

describe('computeGsi2Keys', () => {
  it('returns the key pair for a categorized, non-transfer EXPENSE transaction', () => {
    assert.deepEqual(
      computeGsi2Keys({ ...base, categoryType: 'EXPENSE', isTransfer: false }),
      {
        GSI2PK: 'USER#goldfinch-home#CAT#groceries',
        GSI2SK: '2026-05-10#txn-1',
      },
    );
  });

  it('returns null for a transfer even when the category is EXPENSE', () => {
    // The budget-inflation case: a credit-card payment PATCHed into an EXPENSE
    // category must never enter the spend index.
    assert.equal(
      computeGsi2Keys({ ...base, categoryType: 'EXPENSE', isTransfer: true }),
      null,
    );
  });

  it('returns null for INCOME and TRANSFER categories', () => {
    assert.equal(
      computeGsi2Keys({ ...base, categoryType: 'INCOME', isTransfer: false }),
      null,
    );
    assert.equal(
      computeGsi2Keys({ ...base, categoryType: 'TRANSFER', isTransfer: false }),
      null,
    );
  });

  it('a transfer carries no keys regardless of pending state (budget spend = 0)', () => {
    // GSI2's INCLUDE projection lacks `pending`, but a transfer (either signal)
    // never gets GSI2 keys, so a pending transfer-marked row can never appear in
    // a budget-spend sum — this pins risk #6 (pending-row regression).
    assert.equal(
      computeGsi2Keys({ ...base, categoryType: 'EXPENSE', isTransfer: true }),
      null,
    );
    assert.equal(
      computeGsi2Keys({ ...base, categoryType: 'TRANSFER', isTransfer: false }),
      null,
    );
    // The markTransfer rule writes isTransfer=true; that alone evicts the row
    // from the index even if it was filed under an EXPENSE category.
    assert.equal(
      computeGsi2Keys({ ...base, categoryType: 'EXPENSE', isTransfer: true }),
      null,
    );
  });

  it('propagates key-builder validation (no "#" injection, valid date)', () => {
    assert.throws(
      () =>
        computeGsi2Keys({
          ...base,
          categoryId: 'bad#id',
          categoryType: 'EXPENSE',
          isTransfer: false,
        }),
      KeyError,
    );
    assert.throws(
      () =>
        computeGsi2Keys({
          ...base,
          date: 'not-a-date',
          categoryType: 'EXPENSE',
          isTransfer: false,
        }),
      KeyError,
    );
  });
});
