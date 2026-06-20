/**
 * Optimistic cache-patch logic for the category/note reassignment mutation
 * (hooks/useCategorizeTransaction.ts onMutate). Pins the note-only branch that
 * must NOT flip userCategorized/categorizedBy, the category-assignment branch
 * that must, the note absent/empty/non-empty cases, the unconditional version
 * bump, and the referential-identity guards that keep untouched pages/items
 * by reference (cheap React re-render avoidance).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TransactionDto } from '@goldfinch/shared/types';

import {
  patchCachedTransaction,
  type TransactionListData,
} from '../lib/cachePatch.js';

let seq = 0;

function makeTxn(overrides: Partial<TransactionDto> = {}): TransactionDto {
  seq += 1;
  return {
    txnId: `txn-${seq}`,
    date: '2026-06-10',
    amount: '-12.50',
    amountMinor: -1250,
    currency: 'USD',
    payee: 'Blue Bottle',
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

function page(items: TransactionDto[], nextCursor?: string) {
  return nextCursor === undefined ? { items } : { items, nextCursor };
}

function listData(
  pages: ReturnType<typeof page>[],
  pageParams: (string | undefined)[],
): TransactionListData {
  return { pages, pageParams };
}

/** Locate the (single) patched txn by id across all pages. */
function findInData(
  data: TransactionListData,
  txnId: string,
): TransactionDto | undefined {
  for (const p of data.pages) {
    for (const txn of p.items) {
      if (txn.txnId === txnId) return txn;
    }
  }
  return undefined;
}

describe('patchCachedTransaction', () => {
  it('note-only edit does NOT flip category fields and bumps version', () => {
    const target = makeTxn({
      categoryId: null,
      userCategorized: false,
      categorizedBy: null,
      version: 1,
    });
    const input = listData([page([target])], [undefined]);

    const result = patchCachedTransaction(input, {
      txnId: target.txnId,
      note: 'lunch with Sam',
    });

    const patched = findInData(result, target.txnId);
    assert.ok(patched);
    // Category fields untouched -- kills the always-apply ConditionalExpression mutant.
    assert.equal(patched.categoryId, null);
    assert.equal(patched.userCategorized, false);
    assert.equal(patched.categorizedBy, null);
    // Note applied, version bumped exactly by 1 (kills + -> - and the literal mutant).
    assert.equal(patched.note, 'lunch with Sam');
    assert.equal(patched.version, 2);
  });

  it('category (re)assignment sets category fields and bumps version', () => {
    const target = makeTxn({
      categoryId: 'food',
      userCategorized: false,
      categorizedBy: null,
      version: 3,
    });
    const input = listData([page([target])], [undefined]);

    const result = patchCachedTransaction(input, {
      txnId: target.txnId,
      categoryId: 'dining',
    });

    const patched = findInData(result, target.txnId);
    assert.ok(patched);
    // Kills the always-{} ConditionalExpression mutant: these MUST move.
    assert.equal(patched.categoryId, 'dining');
    assert.equal(patched.userCategorized, true);
    assert.equal(patched.categorizedBy, 'user');
    assert.equal(patched.version, 4);
  });

  it('note undefined leaves note unchanged', () => {
    const target = makeTxn({ note: 'old note' });
    const input = listData([page([target])], [undefined]);

    const result = patchCachedTransaction(input, {
      txnId: target.txnId,
      categoryId: 'dining',
    });

    const patched = findInData(result, target.txnId);
    assert.ok(patched);
    assert.equal(patched.note, 'old note');
  });

  it('empty-string note clears it', () => {
    const target = makeTxn({ note: 'old note' });
    const input = listData([page([target])], [undefined]);

    const result = patchCachedTransaction(input, {
      txnId: target.txnId,
      note: '',
    });

    const patched = findInData(result, target.txnId);
    assert.ok(patched);
    // '' is a real value, not "absent" -- kills the mutant that collapses
    // `vars.note !== undefined` to a truthiness check.
    assert.equal(patched.note, '');
  });

  it('non-empty note sets it', () => {
    const target = makeTxn({ note: 'old' });
    const input = listData([page([target])], [undefined]);

    const result = patchCachedTransaction(input, {
      txnId: target.txnId,
      note: 'new',
    });

    const patched = findInData(result, target.txnId);
    assert.ok(patched);
    assert.equal(patched.note, 'new');
  });

  it('page lacking the txn is returned by reference', () => {
    const other = makeTxn();
    const target = makeTxn({ version: 5 });
    const input = listData(
      [page([other], 'cur'), page([target])],
      [undefined, 'cur'],
    );

    const result = patchCachedTransaction(input, {
      txnId: target.txnId,
      categoryId: 'dining',
    });

    // Page 0 has no target -> identical reference (kills the line-66 .some/`!` mutants).
    assert.equal(result.pages[0], input.pages[0]);
    // Page 1's target IS patched.
    const patched = findInData(result, target.txnId);
    assert.ok(patched);
    assert.equal(patched.version, 6);
    assert.equal(patched.categoryId, 'dining');
  });

  it('sibling txn in the target page is returned by reference', () => {
    const sibling = makeTxn();
    const target = makeTxn({ version: 7 });
    const input = listData([page([sibling, target])], [undefined]);

    const result = patchCachedTransaction(input, {
      txnId: target.txnId,
      categoryId: 'dining',
    });

    const resultPage = result.pages[0];
    const inputPage = input.pages[0];
    assert.ok(resultPage);
    assert.ok(inputPage);
    // Sibling: same reference (kills the line-70 id-guard mutants).
    assert.equal(resultPage.items[0], inputPage.items[0]);
    // Target: a NEW object with the version bumped.
    assert.notEqual(resultPage.items[1], inputPage.items[1]);
    assert.equal(resultPage.items[1]?.version, 8);
  });

  it('top-level and patched page objects are new (not mutated in place)', () => {
    const target = makeTxn();
    const input = listData([page([target])], [undefined]);

    const result = patchCachedTransaction(input, {
      txnId: target.txnId,
      note: 'x',
    });

    // A fresh top-level object and a fresh page object for the patched page.
    assert.notEqual(result, input);
    assert.notEqual(result.pages[0], input.pages[0]);
  });
});
