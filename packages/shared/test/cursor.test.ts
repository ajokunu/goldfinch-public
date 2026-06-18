/**
 * Opaque pagination cursor codec: base64url(JSON(LastEvaluatedKey)).
 * Malformed input must always be CursorError (mapped to 400 BAD_CURSOR by
 * route handlers) — never a raw SyntaxError/TypeError that would become a 500.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CursorError, decodeCursor, encodeCursor } from '../src/cursor.js';

const txnKey = {
  PK: 'USER#goldfinch-home',
  SK: 'TXN#2026-06-09#txn-1',
};

describe('encodeCursor', () => {
  it('produces the exact base64url encoding of the JSON key', () => {
    assert.equal(encodeCursor({ a: 1 }), 'eyJhIjoxfQ');
    assert.equal(
      encodeCursor(txnKey),
      'eyJQSyI6IlVTRVIjZ29sZGZpbmNoLWhvbWUiLCJTSyI6IlRYTiMyMDI2LTA2LTA5I3R4bi0xIn0',
    );
  });

  it('emits URL-safe output only (no +, /, or padding)', () => {
    // Values chosen so standard base64 WOULD contain '+' and '/' and '='.
    const cursor = encodeCursor({ k: '~~~???>>>' });
    assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  });

  it('rejects null, arrays, and non-objects', () => {
    assert.throws(() => encodeCursor(null as never), CursorError);
    assert.throws(() => encodeCursor([1, 2] as never), CursorError);
    assert.throws(() => encodeCursor('PK' as never), CursorError);
    assert.throws(() => encodeCursor(42 as never), CursorError);
  });
});

describe('decodeCursor', () => {
  it('is the exact inverse of encodeCursor (GSI keys round-trip too)', () => {
    assert.deepEqual(decodeCursor(encodeCursor(txnKey)), txnKey);
    const gsiKey = {
      PK: 'USER#goldfinch-home',
      SK: 'TXN#2026-06-09#txn-1',
      GSI1PK: 'USER#goldfinch-home#ACCT#acct-1',
      GSI1SK: '2026-06-09#txn-1',
    };
    assert.deepEqual(decodeCursor(encodeCursor(gsiKey)), gsiKey);
    const weird = { k: '~~~???>>>', n: 12.5, nested: { ok: true } };
    assert.deepEqual(decodeCursor(encodeCursor(weird)), weird);
    assert.deepEqual(decodeCursor(encodeCursor({})), {});
  });

  it('rejects empty and non-string cursors', () => {
    assert.throws(() => decodeCursor(''), CursorError);
    assert.throws(() => decodeCursor(undefined as never), CursorError);
    assert.throws(() => decodeCursor(42 as never), CursorError);
  });

  it('rejects oversized cursors (2048-char cap)', () => {
    const big = 'A'.repeat(2049);
    assert.throws(() => decodeCursor(big), /too long/);
    // 2048 exactly passes the length gate (it then fails later as non-JSON,
    // still a CursorError — the cap itself is what is under test).
    assert.throws(() => decodeCursor('A'.repeat(2048)), CursorError);
  });

  it('rejects non-base64url character sets', () => {
    assert.throws(() => decodeCursor('abc+def'), /base64url/);
    assert.throws(() => decodeCursor('abc/def'), /base64url/);
    assert.throws(() => decodeCursor('abcd=='), /base64url/);
    assert.throws(() => decodeCursor('abc def'), /base64url/);
    assert.throws(() => decodeCursor('abc\n'), /base64url/);
  });

  it('rejects valid base64url that is not JSON', () => {
    // 'bm90IGpzb24' decodes to the bytes of "not json".
    assert.throws(() => decodeCursor('bm90IGpzb24'), /JSON/);
  });

  it('rejects JSON that is not a plain key object', () => {
    assert.throws(() => decodeCursor('NDI'), CursorError); // 42
    assert.throws(() => decodeCursor('bnVsbA'), CursorError); // null
    assert.throws(() => decodeCursor('WzFd'), CursorError); // [1]
  });

  it('accepts an empty key object (server decides validity downstream)', () => {
    assert.deepEqual(decodeCursor('e30'), {});
  });

  it('accepts a maximum-length (exactly 2048 char) cursor — the cap is exclusive above', () => {
    // 1500 'x's makes the JSON exactly 1536 bytes => base64url exactly 2048 chars.
    const key = { PK: 'USER#goldfinch-home', SK: 'x'.repeat(1500) };
    const cursor = encodeCursor(key);
    assert.equal(cursor.length, 2048);
    assert.deepEqual(decodeCursor(cursor), key);
  });

  it('reports a precise reason for each rejection class', () => {
    assert.throws(() => encodeCursor(null as never), /cursor source must be a plain key object/);
    assert.throws(() => decodeCursor(''), /cursor must be a non-empty string/);
    assert.throws(() => decodeCursor('NDI'), /cursor does not decode to a key object/);
    assert.throws(() => decodeCursor('WzFd'), /cursor does not decode to a key object/);
  });

  it('always fails as CursorError with code BAD_CURSOR (never a raw 500)', () => {
    for (const bad of ['', '!', 'NDI', 'bm90IGpzb24', 'A'.repeat(2049)]) {
      try {
        decodeCursor(bad);
        assert.fail(`expected a throw for "${bad.slice(0, 16)}"`);
      } catch (error) {
        assert.ok(error instanceof CursorError, `CursorError for "${bad.slice(0, 16)}"`);
        assert.equal(error.code, 'BAD_CURSOR');
        assert.equal(error.name, 'CursorError');
      }
    }
  });
});
