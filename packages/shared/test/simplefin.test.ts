/**
 * normalizeTransaction SK / GSI1SK date-bucketing (the skDate transacted_at fix
 * at simplefin.ts L428-433, and the postedDate pending ternary at L451).
 *
 * Budget/period windows key off the SK date, which must be WHEN THE TRANSACTION
 * HAPPENED, not when it cleared. SimpleFIN `posted` is the bank's clearing date
 * (a June-12 purchase commonly posts June 15), so the SK must prefer
 * transacted_at, fall back to `posted` for a cleared txn that lacks it, and to
 * the sync time for a pending one. Each case below kills a specific branch
 * mutant in that ternary. SK dates bucket in DEFAULT_TZ (America/New_York), so
 * all epochs are mid-day UTC (T12:00:00Z == 08:00 ET) to stay clear of the ET
 * midnight boundary, and the three dates are deliberately distinct days so a
 * branch swap (transacted_at <-> posted <-> now) flips the bucketed date.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeTransaction } from '../src/simplefin.js';
import type {
  NormalizeContext,
  SimpleFinAccount,
  SimpleFinTransaction,
} from '../src/simplefin.js';

/** Epoch seconds for an ISO instant (mirrors services/sync/test/fixtures.ts). */
function epoch(iso: string): number {
  return Math.trunc(new Date(iso).getTime() / 1000);
}

/** Fixed sync clock: 2026-06-09 (08:00 ET) -- distinct from the dates below. */
const NOW = new Date('2026-06-09T12:00:00.000Z');

const TRANSACTED_DATE = '2026-06-12'; // transacted_at, 08:00 ET
const POSTED_DATE = '2026-06-15'; // posted (later clearing date), 08:00 ET
const NOW_DATE = '2026-06-09'; // ctx.now, 08:00 ET

const ACCOUNT: SimpleFinAccount = {
  id: 'ACT-checking-1',
  name: 'Everyday Checking',
  currency: 'USD',
  balance: '1000.00',
  'balance-date': epoch('2026-06-15T09:00:00Z'),
  org: { name: 'Example Bank', 'sfin-url': 'https://bridge.example.com/simplefin' },
};

const CTX: NormalizeContext = { household: 'goldfinch-home', now: NOW };

function baseTxn(overrides: Partial<SimpleFinTransaction>): SimpleFinTransaction {
  return {
    id: 'TXN-1',
    posted: epoch(`${POSTED_DATE}T12:00:00Z`),
    amount: '-33.27',
    payee: 'Whole Foods',
    ...overrides,
  };
}

describe('normalizeTransaction SK date bucketing', () => {
  it('buckets SK/GSI1SK from transacted_at when present, independent of a later posted', () => {
    const { transaction } = normalizeTransaction(
      baseTxn({
        posted: epoch(`${POSTED_DATE}T12:00:00Z`),
        transacted_at: epoch(`${TRANSACTED_DATE}T12:00:00Z`),
      }),
      ACCOUNT,
      CTX,
    );
    // SK = TXN#<date>#<txnId>; GSI1SK = <date>#<txnId>. Both bucket from
    // transacted_at (06-12), NOT the later posted (06-15) -- kills the first
    // ternary branch and any posted/transacted_at swap.
    assert.equal(transaction.SK, `TXN#${TRANSACTED_DATE}#TXN-1`);
    assert.equal(transaction.GSI1SK, `${TRANSACTED_DATE}#TXN-1`);
    assert.ok(!transaction.SK.includes(POSTED_DATE));
  });

  it('buckets SK from posted and sets postedDate when cleared without transacted_at', () => {
    const { transaction } = normalizeTransaction(
      baseTxn({ posted: epoch(`${POSTED_DATE}T12:00:00Z`) }), // no transacted_at, posted > 0
      ACCOUNT,
      CTX,
    );
    // Cleared (posted > 0, pending absent) and no transacted_at: SK falls back
    // to posted's ET date, and postedDate is that same ET date. Kills the
    // else->posted branch (vs the now fallback) and the L451 pending?null:...
    // false branch.
    assert.equal(transaction.SK, `TXN#${POSTED_DATE}#TXN-1`);
    assert.equal(transaction.postedDate, POSTED_DATE);
    assert.equal(transaction.pending, false);
    assert.ok(!transaction.SK.includes(NOW_DATE));
  });

  it('buckets SK from ctx.now and leaves postedDate null when pending without transacted_at', () => {
    const { transaction } = normalizeTransaction(
      baseTxn({ posted: 0, pending: true }), // pending, no transacted_at
      ACCOUNT,
      CTX,
    );
    // Pending (posted === 0) and no transacted_at: SK falls back to ctx.now's
    // ET date (06-09, distinct from posted), and postedDate stays null. Kills
    // the pending fallback branch (L431-432) and the L451 true branch.
    assert.equal(transaction.SK, `TXN#${NOW_DATE}#TXN-1`);
    assert.equal(transaction.postedDate, null);
    assert.equal(transaction.pending, true);
    assert.ok(!transaction.SK.includes(POSTED_DATE));
  });
});
