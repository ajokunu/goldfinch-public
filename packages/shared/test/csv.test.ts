/** CSV import normalization + dedup hashing (P7-6). */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CsvError,
  ROW_HASH_VERSION,
  computeRowHashes,
  normalizeCsvAmount,
  normalizeCsvDate,
  normalizeCsvPayee,
  normalizeCsvRow,
  rowHash,
  sha256Hex,
} from '../src/csv.js';

describe('sha256Hex', () => {
  it('matches FIPS 180-4 test vectors', () => {
    assert.equal(
      sha256Hex(''),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    assert.equal(
      sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    assert.equal(
      sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('handles multi-block input (padding boundary at 56 bytes)', () => {
    // 64 'a' bytes forces a second block; verified against node:crypto offline.
    assert.equal(
      sha256Hex('a'.repeat(64)),
      'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    );
  });

  it('hashes UTF-8 bytes (non-ASCII differs from its ASCII lookalike)', () => {
    assert.match(sha256Hex('café'), /^[0-9a-f]{64}$/);
    assert.notEqual(sha256Hex('café'), sha256Hex('cafe'));
    assert.equal(sha256Hex('café'), sha256Hex('café'));
  });
});

describe('normalizeCsvDate', () => {
  it('accepts ISO, slash-ISO, and US month-first forms', () => {
    assert.equal(normalizeCsvDate('2026-06-09'), '2026-06-09');
    assert.equal(normalizeCsvDate('2026/6/9'), '2026-06-09');
    assert.equal(normalizeCsvDate('6/9/2026'), '2026-06-09');
    assert.equal(normalizeCsvDate('06/09/2026'), '2026-06-09');
    assert.equal(normalizeCsvDate(' 12/31/2025 '), '2025-12-31');
  });

  it('pivots two-digit years at 70', () => {
    assert.equal(normalizeCsvDate('06/09/26'), '2026-06-09');
    assert.equal(normalizeCsvDate('12/31/99'), '1999-12-31');
    assert.equal(normalizeCsvDate('01/01/70'), '1970-01-01');
    assert.equal(normalizeCsvDate('01/01/69'), '2069-01-01');
  });

  it('enforces calendar validity (no rollover)', () => {
    assert.equal(normalizeCsvDate('02/29/2024'), '2024-02-29');
    assert.throws(() => normalizeCsvDate('02/29/2026'), CsvError);
    assert.throws(() => normalizeCsvDate('2026-02-30'), CsvError);
    assert.throws(() => normalizeCsvDate('13/01/2026'), CsvError);
    assert.throws(() => normalizeCsvDate('00/10/2026'), CsvError);
    assert.throws(() => normalizeCsvDate('06/00/2026'), CsvError);
  });

  it('rejects empty and unrecognized formats', () => {
    assert.throws(() => normalizeCsvDate(''), CsvError);
    assert.throws(() => normalizeCsvDate('June 9, 2026'), CsvError);
    assert.throws(() => normalizeCsvDate('09.06.2026'), CsvError);
  });
});

describe('normalizeCsvAmount', () => {
  it('parses plain decimals at the currency scale', () => {
    assert.equal(normalizeCsvAmount('45.99', 'USD'), 4599);
    assert.equal(normalizeCsvAmount('-45.99', 'USD'), -4599);
    assert.equal(normalizeCsvAmount('+45.99', 'USD'), 4599);
    assert.equal(normalizeCsvAmount('1500', 'JPY'), 1500);
    assert.equal(normalizeCsvAmount('1.250', 'KWD'), 1250);
  });

  it('strips currency symbols, codes, and thousands separators', () => {
    assert.equal(normalizeCsvAmount('$1,234.56', 'USD'), 123456);
    assert.equal(normalizeCsvAmount('USD 45.99', 'USD'), 4599);
    assert.equal(normalizeCsvAmount('€ 1 234,56'.replace(',', '.'), 'EUR'), 123456);
    assert.equal(normalizeCsvAmount('£45.99', 'GBP'), 4599);
    assert.equal(normalizeCsvAmount('¥1,500', 'JPY'), 1500);
    assert.equal(normalizeCsvAmount('₹1,234.56', 'INR'), 123456);
    assert.equal(normalizeCsvAmount(' 45.99 ', 'USD'), 4599);
  });

  it('reads accounting parentheses and trailing minus as negative', () => {
    assert.equal(normalizeCsvAmount('(45.99)', 'USD'), -4599);
    assert.equal(normalizeCsvAmount('($45.99)', 'USD'), -4599);
    assert.equal(normalizeCsvAmount('45.99-', 'USD'), -4599);
  });

  it('double negation cancels and zero never becomes -0', () => {
    assert.equal(normalizeCsvAmount('(-45.99)', 'USD'), 4599);
    assert.equal(Object.is(normalizeCsvAmount('(0.00)', 'USD'), -0), false);
    assert.equal(normalizeCsvAmount('(0.00)', 'USD'), 0);
  });

  it('rejects excess precision, empties, and non-numbers — never a float fallback', () => {
    assert.throws(() => normalizeCsvAmount('45.999', 'USD'), CsvError);
    assert.throws(() => normalizeCsvAmount('', 'USD'), CsvError);
    assert.throws(() => normalizeCsvAmount('   ', 'USD'), CsvError);
    assert.throws(() => normalizeCsvAmount('N/A', 'USD'), CsvError);
    assert.throws(() => normalizeCsvAmount('12.34.56', 'USD'), CsvError);
  });
});

describe('normalizeCsvPayee / normalizeCsvRow', () => {
  it('collapses whitespace, preserves casing', () => {
    assert.equal(normalizeCsvPayee('  Blue   Bottle  '), 'Blue Bottle');
    assert.throws(() => normalizeCsvPayee('   '), CsvError);
  });

  it('builds the canonical normalized row', () => {
    const row = normalizeCsvRow(
      { date: '6/9/2026', amount: '($45.99)', payee: ' Blue  Bottle ', note: ' two  drinks ' },
      { currency: 'USD', categoryId: 'dining' },
    );
    assert.deepEqual(row, {
      date: '2026-06-09',
      amountMinor: -4599,
      amount: '-45.99',
      payee: 'Blue Bottle',
      categoryId: 'dining',
      note: 'two drinks',
    });
  });

  it('defaults categoryId to null and omits empty notes', () => {
    const row = normalizeCsvRow(
      { date: '2026-06-09', amount: '12.00', payee: 'Cafe', note: '   ' },
      { currency: 'USD' },
    );
    assert.equal(row.categoryId, null);
    assert.equal('note' in row, false);
  });

  it('renders zero-digit currencies losslessly', () => {
    const row = normalizeCsvRow(
      { date: '2026-06-09', amount: '1,500', payee: 'Ramen' },
      { currency: 'JPY' },
    );
    assert.equal(row.amountMinor, 1500);
    assert.equal(row.amount, '1500');
  });
});

describe('rowHash', () => {
  const base = { date: '2026-06-09', amountMinor: -4599, payee: 'Blue Bottle' };

  it('is deterministic 64-char lowercase hex (SK-safe: no # or :)', () => {
    const hash = rowHash(base);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, rowHash({ ...base }));
    assert.equal(ROW_HASH_VERSION, 'v1');
  });

  it('matches the locked v1 canonical form (golden vector)', () => {
    // sha256("v1|2026-06-09|-4599|blue bottle|0") — computed independently
    // with node:crypto. If this assertion ever fails, the canonical hash
    // input changed shape and ROW_HASH_VERSION must be bumped (P7-6: the
    // server-side TXNPTR#import pointers in prod were written with v1).
    assert.equal(
      rowHash(base),
      '4762805fc3bc1b3755e6136e56d67c64bf2997c1d8a676a7ea734f29ad267da9',
    );
  });

  it('is payee case- and whitespace-insensitive', () => {
    assert.equal(rowHash(base), rowHash({ ...base, payee: '  blue   BOTTLE ' }));
  });

  it('varies with date, amount, payee, and occurrence — not with category/note', () => {
    const hash = rowHash(base);
    assert.notEqual(rowHash({ ...base, date: '2026-06-10' }), hash);
    assert.notEqual(rowHash({ ...base, amountMinor: -4598 }), hash);
    assert.notEqual(rowHash({ ...base, amountMinor: 4599 }), hash);
    assert.notEqual(rowHash({ ...base, payee: 'Sightglass' }), hash);
    assert.notEqual(rowHash(base, 1), hash);
  });

  it('rejects invalid inputs loudly', () => {
    assert.throws(() => rowHash({ ...base, date: 'bad' }), /yyyy-mm-dd/);
    assert.throws(() => rowHash({ ...base, amountMinor: 0.5 }), CsvError);
    assert.throws(() => rowHash({ ...base, payee: '  ' }), CsvError);
    assert.throws(() => rowHash(base, -1), CsvError);
    assert.throws(() => rowHash(base, 1.5), CsvError);
  });
});

describe('computeRowHashes', () => {
  const coffee = { date: '2026-06-09', amountMinor: -550, payee: 'Cafe' };
  const lunch = { date: '2026-06-09', amountMinor: -1200, payee: 'Deli' };

  it('assigns occurrence indexes so identical rows get distinct hashes', () => {
    const hashes = computeRowHashes([coffee, lunch, { ...coffee }]);
    assert.equal(new Set(hashes).size, 3);
    assert.equal(hashes[0], rowHash(coffee, 0));
    assert.equal(hashes[1], rowHash(lunch, 0));
    assert.equal(hashes[2], rowHash(coffee, 1));
  });

  it('treats payee case/whitespace variants as the same identity', () => {
    const hashes = computeRowHashes([coffee, { ...coffee, payee: ' CAFE ' }]);
    assert.equal(hashes[1], rowHash(coffee, 1));
  });

  it('is stable for the same row order (the request-order contract)', () => {
    assert.deepEqual(computeRowHashes([coffee, lunch]), computeRowHashes([coffee, lunch]));
  });

  it('returns an empty array for an empty batch', () => {
    assert.deepEqual(computeRowHashes([]), []);
  });
});

describe('mutation hardening (P7-10)', () => {
  it('CsvError carries its name and a precise message', () => {
    try {
      normalizeCsvDate('   ');
      assert.fail('expected a throw');
    } catch (error) {
      assert.ok(error instanceof CsvError);
      assert.equal(error.name, 'CsvError');
      assert.match(error.message, /date cell is empty/);
    }
  });

  it('date regexes are fully anchored (no prefix/suffix partial matches)', () => {
    assert.throws(() => normalizeCsvDate('12026-01-15'), /unrecognized date format/);
    assert.throws(() => normalizeCsvDate('2026-01-150'), /unrecognized date format/);
    assert.throws(() => normalizeCsvDate('12026/01/15'), CsvError);
    assert.throws(() => normalizeCsvDate('2026/01/150'), CsvError);
    assert.throws(() => normalizeCsvDate('111/15/2026'), CsvError);
  });

  it('accepts mixed-width slash-ISO components (1-2 digit month and day)', () => {
    assert.equal(normalizeCsvDate('2026/1/15'), '2026-01-15');
    assert.equal(normalizeCsvDate('2026/11/5'), '2026-11-05');
  });

  it('treats literal year 100 as 0100 (the two-digit pivot is strictly below 100)', () => {
    assert.equal(normalizeCsvDate('0100-05-04'), '0100-05-04');
  });

  it('reports month/day validity with precise messages', () => {
    assert.throws(() => normalizeCsvDate('13/01/2026'), /invalid month in date "13\/01\/2026"/);
    assert.throws(() => normalizeCsvDate('02/30/2026'), /invalid day in date "02\/30\/2026"/);
    assert.throws(() => normalizeCsvDate('June 9, 2026'), /unrecognized date format: "June 9, 2026"/);
  });

  it('amount sign markers compose exactly (and unbalanced parens reject)', () => {
    assert.equal(normalizeCsvAmount('--45.99', 'USD'), 4599);
    assert.equal(normalizeCsvAmount('++45.99', 'USD'), 4599);
    assert.equal(normalizeCsvAmount('( 45.99- )', 'USD'), 4599);
    assert.equal(normalizeCsvAmount('(45.99) ', 'USD'), -4599);
    assert.throws(() => normalizeCsvAmount('45.99)', 'USD'), CsvError);
    assert.throws(() => normalizeCsvAmount('(45.99', 'USD'), CsvError);
  });

  it('reports precise amount/payee rejection reasons', () => {
    assert.throws(() => normalizeCsvAmount('   ', 'USD'), /amount cell is empty/);
    assert.throws(() => normalizeCsvAmount('abc', 'USD'), /amount cell has no digits: "abc"/);
    assert.throws(() => normalizeCsvAmount('1.2.3', 'USD'), /cannot parse amount "1\.2\.3"/);
    assert.throws(() => normalizeCsvPayee('   '), /payee cell is empty/);
  });

  it('reports precise rowHash rejection reasons', () => {
    const base = { date: '2026-06-09', amountMinor: -4599, payee: 'Blue Bottle' };
    assert.throws(() => rowHash({ ...base, amountMinor: 0.5 }), /amountMinor must be a safe integer, got 0\.5/);
    assert.throws(() => rowHash(base, -1), /occurrence must be a non-negative integer, got -1/);
    assert.throws(() => rowHash({ ...base, payee: '   ' }), /cannot hash a row with an empty payee/);
  });

  it('computeRowHashes identity normalization matches rowHash exactly', () => {
    const date = '2026-06-09';
    // Interior whitespace runs collapse to one space: same identity, occurrence 1.
    const ws = [
      { date, amountMinor: -550, payee: 'TRADER  JOES' },
      { date, amountMinor: -550, payee: 'TRADER JOES' },
    ];
    assert.deepEqual(computeRowHashes(ws), [rowHash(ws[0]!, 0), rowHash(ws[1]!, 1)]);
    // Distinct payees at the same date/amount are distinct identities.
    const distinct = [
      { date, amountMinor: -550, payee: 'AAA' },
      { date, amountMinor: -550, payee: 'BBB' },
    ];
    assert.deepEqual(computeRowHashes(distinct), [rowHash(distinct[0]!, 0), rowHash(distinct[1]!, 0)]);
    // Payees differing only in space POSITION stay distinct (collapse, not strip).
    const spaced = [
      { date, amountMinor: -550, payee: 'AB C' },
      { date, amountMinor: -550, payee: 'A BC' },
    ];
    assert.deepEqual(computeRowHashes(spaced), [rowHash(spaced[0]!, 0), rowHash(spaced[1]!, 0)]);
    // Lowercasing (not uppercasing) is the identity rule: eszett folding differs.
    const eszett = [
      { date, amountMinor: -550, payee: 'straße' },
      { date, amountMinor: -550, payee: 'STRASSE' },
    ];
    assert.deepEqual(computeRowHashes(eszett), [rowHash(eszett[0]!, 0), rowHash(eszett[1]!, 0)]);
  });
});
