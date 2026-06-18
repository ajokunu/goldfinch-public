/**
 * List-building logic for the Activity screen: page flattening (dedup),
 * date-header interleaving, per-currency day totals, and the screens.md 2.4
 * completeness rule (a trailing, possibly-partial day never shows a total).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TransactionDto } from '@goldfinch/shared/types';

import {
  buildListItems,
  findTransaction,
  flattenPages,
  type SectionHeaderItem,
} from '../lib/sections.js';

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

describe('flattenPages', () => {
  it('returns empty for undefined pages', () => {
    assert.deepEqual(flattenPages(undefined), []);
  });

  it('concatenates pages preserving order', () => {
    const a = makeTxn();
    const b = makeTxn();
    const c = makeTxn();
    const out = flattenPages([page([a, b], 'cur'), page([c])]);
    assert.deepEqual(
      out.map((txn) => txn.txnId),
      [a.txnId, b.txnId, c.txnId],
    );
  });

  it('dedupes a txn that re-appears across a page boundary', () => {
    const a = makeTxn();
    const b = makeTxn();
    const out = flattenPages([page([a], 'cur'), page([a, b])]);
    assert.deepEqual(
      out.map((txn) => txn.txnId),
      [a.txnId, b.txnId],
    );
  });
});

describe('buildListItems', () => {
  it('returns empty for no transactions', () => {
    assert.deepEqual(buildListItems([], true), []);
  });

  it('interleaves one header per consecutive date run', () => {
    const items = buildListItems(
      [
        makeTxn({ date: '2026-06-10' }),
        makeTxn({ date: '2026-06-10' }),
        makeTxn({ date: '2026-06-09' }),
      ],
      true,
    );
    assert.deepEqual(
      items.map((item) => item.kind),
      ['header', 'txn', 'txn', 'header', 'txn'],
    );
    const headers = items.filter(
      (item): item is SectionHeaderItem => item.kind === 'header',
    );
    assert.deepEqual(
      headers.map((header) => header.date),
      ['2026-06-10', '2026-06-09'],
    );
    assert.deepEqual(
      headers.map((header) => header.key),
      ['header:2026-06-10', 'header:2026-06-09'],
    );
    // FlashList row keys are txn-id derived and must stay stable.
    assert.deepEqual(
      items
        .filter((item) => item.kind === 'txn')
        .map((item) => item.key),
      items
        .filter((item) => item.kind === 'txn')
        .map((item) => `txn:${item.txn.txnId}`),
    );
  });

  it('sums day totals as integer minor units per currency', () => {
    const items = buildListItems(
      [
        makeTxn({ date: '2026-06-10', amountMinor: -1250, currency: 'USD' }),
        makeTxn({ date: '2026-06-10', amountMinor: 5000, currency: 'USD' }),
        makeTxn({ date: '2026-06-10', amountMinor: -460, currency: 'JPY' }),
        makeTxn({ date: '2026-06-09', amountMinor: -300, currency: 'USD' }),
      ],
      true,
    );
    const headers = items.filter(
      (item): item is SectionHeaderItem => item.kind === 'header',
    );
    assert.deepEqual(headers[0]?.totals, [
      { currency: 'USD', totalMinor: 3750 },
      { currency: 'JPY', totalMinor: -460 },
    ]);
    assert.deepEqual(headers[1]?.totals, [
      { currency: 'USD', totalMinor: -300 },
    ]);
  });

  it('omits the trailing day total while more pages may exist', () => {
    const items = buildListItems(
      [
        makeTxn({ date: '2026-06-10', amountMinor: -100 }),
        makeTxn({ date: '2026-06-09', amountMinor: -200 }),
      ],
      false,
    );
    const headers = items.filter(
      (item): item is SectionHeaderItem => item.kind === 'header',
    );
    // A strictly older date follows the first day -> it is complete.
    assert.deepEqual(headers[0]?.totals, [
      { currency: 'USD', totalMinor: -100 },
    ]);
    // The last day may still be partially loaded -> no total.
    assert.equal(headers[1]?.totals, null);
  });

  it('shows the trailing day total once the list is complete', () => {
    const items = buildListItems(
      [makeTxn({ date: '2026-06-10', amountMinor: -100 })],
      true,
    );
    const headers = items.filter(
      (item): item is SectionHeaderItem => item.kind === 'header',
    );
    assert.deepEqual(headers[0]?.totals, [
      { currency: 'USD', totalMinor: -100 },
    ]);
  });

  it('defaults to treating the list as incomplete', () => {
    const items = buildListItems([makeTxn({ date: '2026-06-10' })]);
    const header = items[0];
    assert.equal(header?.kind, 'header');
    assert.equal((header as SectionHeaderItem).totals, null);
  });
});

describe('findTransaction', () => {
  it('finds by id and returns undefined for null/missing', () => {
    const a = makeTxn();
    const b = makeTxn();
    assert.equal(findTransaction([a, b], b.txnId), b);
    assert.equal(findTransaction([a, b], null), undefined);
    assert.equal(findTransaction([a, b], 'nope'), undefined);
  });
});
