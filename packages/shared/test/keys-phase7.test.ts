/** Phase-7 key builders: shapes, validation, and range bounds. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  KEY_PREFIX,
  KeyError,
  attachPrefix,
  attachSk,
  contribPrefix,
  contribSk,
  goalSk,
  holdingBasisPrefix,
  holdingBasisSk,
  holdingPrefix,
  holdingSk,
  importTxnPointerPrefix,
  importTxnPointerSk,
  netWorthDateRangeBounds,
  netWorthSk,
  pushTokenSk,
  recurringSk,
  ruleSk,
} from '../src/keys.js';

describe('phase-7 sort-key builders', () => {
  it('build the documented SK shapes', () => {
    assert.equal(recurringSk('series-1'), 'RECURRING#series-1');
    assert.equal(goalSk('goal-1'), 'GOAL#goal-1');
    assert.equal(
      contribSk('goal-1', '2026-06-09T12:00:00Z'),
      'CONTRIB#goal-1#2026-06-09T12:00:00Z',
    );
    assert.equal(holdingSk('acct-1', 'hold-1'), 'HOLDING#acct-1#hold-1');
    assert.equal(holdingBasisSk('acct-1', 'VTSAX'), 'HOLDINGBASIS#acct-1#VTSAX');
    assert.equal(netWorthSk('2026-06-09'), 'NETWORTH#2026-06-09');
    assert.equal(ruleSk('rule-1'), 'RULE#rule-1');
    assert.equal(attachSk('txn-1', 'att-1'), 'ATTACH#txn-1#att-1');
    assert.equal(pushTokenSk('device-1'), 'PUSHTOKEN#device-1');
    assert.equal(
      importTxnPointerSk('imp-1', 'abc123'),
      'TXNPTR#import:imp-1:abc123',
    );
  });

  it('expose begins_with prefixes that match the builders', () => {
    assert.equal(contribPrefix('goal-1'), 'CONTRIB#goal-1#');
    assert.equal(holdingPrefix('acct-1'), 'HOLDING#acct-1#');
    assert.equal(holdingBasisPrefix('acct-1'), 'HOLDINGBASIS#acct-1#');
    assert.equal(attachPrefix('txn-1'), 'ATTACH#txn-1#');
    assert.equal(importTxnPointerPrefix('imp-1'), 'TXNPTR#import:imp-1:');
    assert.ok(contribSk('goal-1', 'ts').startsWith(contribPrefix('goal-1')));
    assert.ok(recurringSk('x').startsWith(KEY_PREFIX.recurring));
    assert.ok(goalSk('x').startsWith(KEY_PREFIX.goal));
    assert.ok(netWorthSk('2026-06-09').startsWith(KEY_PREFIX.netWorth));
    assert.ok(ruleSk('x').startsWith(KEY_PREFIX.rule));
    assert.ok(pushTokenSk('x').startsWith(KEY_PREFIX.pushToken));
    assert.ok(importTxnPointerSk('a', 'b').startsWith(KEY_PREFIX.importTxnPointer));
    // Import pointers deliberately live inside the TXNPTR# namespace.
    assert.ok(KEY_PREFIX.importTxnPointer.startsWith(KEY_PREFIX.txnPointer));
    assert.ok(holdingBasisSk('acct-1', 'VTSAX').startsWith(holdingBasisPrefix('acct-1')));
    assert.ok(holdingBasisSk('acct-1', 'VTSAX').startsWith(KEY_PREFIX.holdingBasis));
  });

  it('holding-basis symbol allows "." and "-" (valid ticker chars) but rejects "#"', () => {
    // '.' and '-' are valid ticker characters; only '#' corrupts the composite key.
    assert.equal(holdingBasisSk('acct-1', 'BRK.B'), 'HOLDINGBASIS#acct-1#BRK.B');
    assert.equal(holdingBasisSk('acct-1', 'ABC-D'), 'HOLDINGBASIS#acct-1#ABC-D');
    assert.throws(() => holdingBasisSk('acct-1', 'BAD#SYM'), KeyError);
    assert.throws(() => holdingBasisSk('acct#1', 'VTSAX'), KeyError);
  });

  it('reject empty components and "#" injection', () => {
    assert.throws(() => recurringSk(''), KeyError);
    assert.throws(() => goalSk('a#b'), KeyError);
    assert.throws(() => contribSk('goal-1', 'bad#ts'), KeyError);
    assert.throws(() => holdingSk('acct#1', 'h'), KeyError);
    assert.throws(() => holdingSk('acct-1', ''), KeyError);
    assert.throws(() => holdingBasisSk('acct-1', 'sym#bol'), KeyError);
    assert.throws(() => holdingBasisSk('acct-1', ''), KeyError);
    assert.throws(() => holdingBasisPrefix(''), KeyError);
    assert.throws(() => ruleSk('rule#1'), KeyError);
    assert.throws(() => attachSk('txn-1', 'att#1'), KeyError);
    assert.throws(() => pushTokenSk('dev#1'), KeyError);
  });

  it('import pointer components additionally reject ":" (the separator)', () => {
    assert.throws(() => importTxnPointerSk('imp:1', 'hash'), KeyError);
    assert.throws(() => importTxnPointerSk('imp-1', 'ha:sh'), KeyError);
    assert.throws(() => importTxnPointerSk('imp#1', 'hash'), KeyError);
    assert.throws(() => importTxnPointerPrefix('imp:1'), KeyError);
  });

  it('netWorthSk validates the calendar date', () => {
    assert.throws(() => netWorthSk('not-a-date'), KeyError);
    assert.throws(() => netWorthSk('2026-6-9'), KeyError);
  });

  it('netWorthDateRangeBounds covers the full inclusive range', () => {
    assert.deepEqual(netWorthDateRangeBounds('2026-01-01', '2026-06-09'), {
      start: 'NETWORTH#2026-01-01',
      end: 'NETWORTH#2026-06-09~',
    });
    // The sentinel sorts after the bare snapshot SK, so the last day is included.
    const bounds = netWorthDateRangeBounds('2026-06-09', '2026-06-09');
    assert.ok(netWorthSk('2026-06-09') >= bounds.start);
    assert.ok(netWorthSk('2026-06-09') <= bounds.end);
    assert.throws(() => netWorthDateRangeBounds('2026-06-10', '2026-06-09'), KeyError);
    assert.throws(() => netWorthDateRangeBounds('bad', '2026-06-09'), KeyError);
  });
});

describe('mutation hardening (P7-10)', () => {
  it('every phase-7 builder names its component in the empty-string message', () => {
    const cases: Array<[() => unknown, string]> = [
      [() => recurringSk(''), 'seriesId'],
      [() => goalSk(''), 'goalId'],
      [() => contribSk('', '2026-06-09T12:00:00Z'), 'goalId'],
      [() => contribSk('goal-1', ''), 'contributedAt'],
      [() => contribPrefix(''), 'goalId'],
      [() => holdingSk('', 'h-1'), 'accountId'],
      [() => holdingSk('acct-1', ''), 'holdingId'],
      [() => holdingPrefix(''), 'accountId'],
      [() => holdingBasisSk('', 'VTSAX'), 'accountId'],
      [() => holdingBasisSk('acct-1', ''), 'symbol'],
      [() => holdingBasisPrefix(''), 'accountId'],
      [() => ruleSk(''), 'ruleId'],
      [() => importTxnPointerSk('', 'hash'), 'importId'],
      [() => importTxnPointerSk('imp-1', ''), 'rowHash'],
      [() => importTxnPointerPrefix(''), 'importId'],
      [() => attachSk('', 'att-1'), 'txnId'],
      [() => attachSk('txn-1', ''), 'attachId'],
      [() => attachPrefix(''), 'txnId'],
      [() => pushTokenSk(''), 'deviceId'],
    ];
    for (const [fn, label] of cases) {
      assert.throws(fn, new RegExp(`${label} must be a non-empty string`), label);
    }
  });

  it('the ":" rejection names the offending component and value', () => {
    assert.throws(() => importTxnPointerSk('imp:1', 'hash'), /importId must not contain ":" \(got "imp:1"\)/);
    assert.throws(() => importTxnPointerSk('imp-1', 'ha:sh'), /rowHash must not contain ":" \(got "ha:sh"\)/);
  });

  it('netWorthDateRangeBounds reports both dates in the inverted-range message', () => {
    assert.throws(
      () => netWorthDateRangeBounds('2026-06-10', '2026-06-09'),
      /from \(2026-06-10\) must not be after to \(2026-06-09\)/,
    );
  });
});
