/**
 * Base (pre-Phase-7) key builders. These shapes index 517 live production
 * items — every literal is pinned exactly, because a mutated prefix would
 * silently read/write a different (empty) keyspace.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GSI1_NAME,
  GSI2_NAME,
  KEY_PREFIX,
  KeyError,
  SK_UPPER_BOUND,
  acctSk,
  assertIsoDate,
  budgetSk,
  categorySk,
  gsi1Pk,
  gsi1Sk,
  gsi2Pk,
  gsi2Sk,
  gsiDateRangeBounds,
  parseTxnSk,
  profileSk,
  syncStateSk,
  txnDateRangeBounds,
  txnPointerSk,
  txnSk,
  userPk,
} from '../src/keys.js';

describe('constants', () => {
  it('pins index names and the sort sentinel', () => {
    assert.equal(GSI1_NAME, 'GSI1');
    assert.equal(GSI2_NAME, 'GSI2');
    assert.equal(SK_UPPER_BOUND, '~');
    // The sentinel must sort after '#' and after every id/date character.
    assert.ok(SK_UPPER_BOUND > '#');
    assert.ok(SK_UPPER_BOUND > 'z');
    assert.ok(SK_UPPER_BOUND > '9');
  });

  it('pins every begins_with prefix literal', () => {
    assert.deepEqual(KEY_PREFIX, {
      profile: 'PROFILE#',
      account: 'ACCT#',
      transaction: 'TXN#',
      txnPointer: 'TXNPTR#',
      budget: 'BUDGET#',
      category: 'CATEGORY#',
      recurring: 'RECURRING#',
      goal: 'GOAL#',
      contribution: 'CONTRIB#',
      holding: 'HOLDING#',
      netWorth: 'NETWORTH#',
      rule: 'RULE#',
      importTxnPointer: 'TXNPTR#import:',
      attachment: 'ATTACH#',
      pushToken: 'PUSHTOKEN#',
    });
  });
});

describe('assertIsoDate', () => {
  it('accepts yyyy-mm-dd only', () => {
    assert.doesNotThrow(() => assertIsoDate('2026-06-09'));
    assert.doesNotThrow(() => assertIsoDate('1970-01-01'));
  });

  it('rejects every other shape (anchored, digit-strict)', () => {
    for (const bad of [
      '2026-6-9',
      '20260609',
      '2026/06/09',
      'abcd-ef-gh',
      ' 2026-06-09',
      '2026-06-09 ',
      'x2026-06-09',
      '2026-06-091',
      '',
    ]) {
      assert.throws(() => assertIsoDate(bad), /yyyy-mm-dd/, `should reject "${bad}"`);
    }
  });
});

describe('base sort-key builders', () => {
  it('build the documented shapes exactly', () => {
    assert.equal(userPk('goldfinch-home'), 'USER#goldfinch-home');
    assert.equal(profileSk('sub-123'), 'PROFILE#sub-123');
    assert.equal(acctSk('acct-1'), 'ACCT#acct-1');
    assert.equal(txnSk('2026-06-09', 'txn-1'), 'TXN#2026-06-09#txn-1');
    assert.equal(txnPointerSk('txn-1'), 'TXNPTR#txn-1');
    assert.equal(budgetSk('groceries'), 'BUDGET#groceries');
    assert.equal(categorySk('groceries'), 'CATEGORY#groceries');
    assert.equal(syncStateSk(), 'SYNC#STATE');
  });

  it('rejects empty components, "#" injection, and non-strings', () => {
    assert.throws(() => userPk(''), /household must be a non-empty string/);
    assert.throws(() => userPk('a#b'), /must not contain "#"/);
    assert.throws(() => userPk(42 as never), KeyError);
    assert.throws(() => profileSk(''), KeyError);
    assert.throws(() => acctSk('a#b'), KeyError);
    assert.throws(() => txnSk('not-a-date', 'txn-1'), KeyError);
    assert.throws(() => txnSk('2026-06-09', ''), KeyError);
    assert.throws(() => txnSk('2026-06-09', 't#1'), KeyError);
    assert.throws(() => txnPointerSk(''), KeyError);
    assert.throws(() => budgetSk('a#b'), KeyError);
    assert.throws(() => categorySk(''), KeyError);
  });
});

describe('GSI key builders', () => {
  it('build the documented shapes exactly', () => {
    assert.equal(gsi1Pk('goldfinch-home', 'acct-1'), 'USER#goldfinch-home#ACCT#acct-1');
    assert.equal(gsi2Pk('goldfinch-home', 'groceries'), 'USER#goldfinch-home#CAT#groceries');
    assert.equal(gsi1Sk('2026-06-09', 'txn-1'), '2026-06-09#txn-1');
    assert.equal(gsi2Sk('2026-06-09', 'txn-1'), '2026-06-09#txn-1');
  });

  it('validate every component', () => {
    assert.throws(() => gsi1Pk('', 'acct-1'), KeyError);
    assert.throws(() => gsi1Pk('h', 'a#1'), KeyError);
    assert.throws(() => gsi2Pk('h#h', 'cat'), KeyError);
    assert.throws(() => gsi2Pk('h', ''), KeyError);
    assert.throws(() => gsi1Sk('bad-date', 'txn-1'), KeyError);
    assert.throws(() => gsi1Sk('2026-06-09', ''), KeyError);
    assert.throws(() => gsi2Sk('2026-6-9', 'txn-1'), KeyError);
    assert.throws(() => gsi2Sk('2026-06-09', 't#1'), KeyError);
  });
});

describe('date range bounds', () => {
  it('txnDateRangeBounds covers the inclusive [from, to] window', () => {
    assert.deepEqual(txnDateRangeBounds('2026-01-01', '2026-06-09'), {
      start: 'TXN#2026-01-01',
      end: 'TXN#2026-06-09~',
    });
    // A same-day transaction SK sits inside the bounds (the sentinel's job).
    const bounds = txnDateRangeBounds('2026-06-09', '2026-06-09');
    const sk = txnSk('2026-06-09', 'txn-1');
    assert.ok(sk >= bounds.start && sk <= bounds.end);
  });

  it('gsiDateRangeBounds covers the inclusive [from, to] window', () => {
    assert.deepEqual(gsiDateRangeBounds('2026-01-01', '2026-06-09'), {
      start: '2026-01-01',
      end: '2026-06-09~',
    });
    const bounds = gsiDateRangeBounds('2026-06-09', '2026-06-09');
    const sk = gsi1Sk('2026-06-09', 'txn-1');
    assert.ok(sk >= bounds.start && sk <= bounds.end);
  });

  it('rejects inverted ranges and malformed dates', () => {
    assert.throws(() => txnDateRangeBounds('2026-06-10', '2026-06-09'), /must not be after/);
    assert.doesNotThrow(() => txnDateRangeBounds('2026-06-09', '2026-06-09'));
    assert.throws(() => txnDateRangeBounds('bad', '2026-06-09'), KeyError);
    assert.throws(() => txnDateRangeBounds('2026-06-09', 'bad'), KeyError);
    assert.throws(() => gsiDateRangeBounds('2026-06-10', '2026-06-09'), /must not be after/);
    assert.doesNotThrow(() => gsiDateRangeBounds('2026-06-09', '2026-06-09'));
    assert.throws(() => gsiDateRangeBounds('bad', '2026-06-09'), KeyError);
  });
});

describe('parseTxnSk', () => {
  it('is the exact inverse of txnSk', () => {
    assert.deepEqual(parseTxnSk(txnSk('2026-06-09', 'txn-1')), {
      date: '2026-06-09',
      txnId: 'txn-1',
    });
    assert.deepEqual(parseTxnSk('TXN#1999-12-31#abc'), { date: '1999-12-31', txnId: 'abc' });
  });

  it('rejects everything that is not a transaction SK', () => {
    for (const bad of [
      'TXN#2026-06-09', // missing txnId segment
      'TXN#2026-06-09#', // empty txnId
      'TXN#2026-06-09#a#b', // too many segments
      'ACCT#2026-06-09#txn-1', // wrong prefix
      'txn#2026-06-09#txn-1', // case matters
      'TXN#not-a-date#txn-1',
      'TXN#2026-6-9#txn-1',
      '',
    ]) {
      assert.throws(() => parseTxnSk(bad), KeyError, `should reject "${bad}"`);
    }
  });
});

describe('mutation hardening (P7-10)', () => {
  it('KeyError carries its name for structured logging', () => {
    try {
      userPk('');
      assert.fail('expected a throw');
    } catch (error) {
      assert.ok(error instanceof KeyError);
      assert.equal(error.name, 'KeyError');
    }
  });

  it('every base builder names its component in the empty-string message', () => {
    const cases: Array<[() => unknown, string]> = [
      [() => profileSk(''), 'cognitoSub'],
      [() => acctSk(''), 'accountId'],
      [() => txnSk('2026-06-09', ''), 'txnId'],
      [() => txnPointerSk(''), 'txnId'],
      [() => budgetSk(''), 'categoryId'],
      [() => categorySk(''), 'categoryId'],
      [() => gsi1Pk('', 'acct-1'), 'household'],
      [() => gsi1Pk('h', ''), 'accountId'],
      [() => gsi1Sk('2026-06-09', ''), 'txnId'],
      [() => gsi2Pk('', 'cat-1'), 'household'],
      [() => gsi2Pk('h', ''), 'categoryId'],
      [() => gsi2Sk('2026-06-09', ''), 'txnId'],
    ];
    for (const [fn, label] of cases) {
      assert.throws(fn, new RegExp(`${label} must be a non-empty string`), label);
    }
  });

  it('parseTxnSk reports the offending SK in each rejection', () => {
    assert.throws(() => parseTxnSk('ACCT#a'), /not a transaction SK: "ACCT#a"/);
    assert.throws(() => parseTxnSk('TXN#2026-06-09#'), /transaction SK has empty txnId: "TXN#2026-06-09#"/);
  });
});
