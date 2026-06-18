/**
 * Pure budget money-helper tests (lib/amounts.ts). The preset computation is
 * a spec-named StrykerJS target (design-spec components.md "preset chips ...
 * computed in MINOR UNITS by a pure helper (mutation-tested)").
 *
 * Every expected value is a hand-computed LITERAL, never recomputed with the
 * helpers under test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  averageMinor,
  minorToDecimalString,
  parseAmountInput,
  percentUsed,
  presetLimitsMinor,
  progressFraction,
  scaleFraction,
} from '../lib/amounts';

describe('minorToDecimalString', () => {
  it('converts integer minor units to a two-decimal string', () => {
    assert.equal(minorToDecimalString(12345), '123.45');
    assert.equal(minorToDecimalString(100), '1.00');
  });

  it('zero-pads small magnitudes', () => {
    assert.equal(minorToDecimalString(0), '0.00');
    assert.equal(minorToDecimalString(5), '0.05');
    assert.equal(minorToDecimalString(50), '0.50');
  });

  it('carries the sign for negative amounts', () => {
    assert.equal(minorToDecimalString(-1), '-0.01');
    assert.equal(minorToDecimalString(-12345), '-123.45');
  });

  it('supports zero-digit currencies (no decimal point)', () => {
    assert.equal(minorToDecimalString(123, 0), '123');
    assert.equal(minorToDecimalString(-7, 0), '-7');
  });

  it('supports three-digit currencies', () => {
    assert.equal(minorToDecimalString(1, 3), '0.001');
    assert.equal(minorToDecimalString(123456, 3), '123.456');
  });

  it('throws on non-safe-integer input', () => {
    assert.throws(() => minorToDecimalString(1.5), /not a safe integer/);
    assert.throws(
      () => minorToDecimalString(Number.NaN),
      /not a safe integer/,
    );
    assert.throws(
      () => minorToDecimalString(2 ** 53),
      /not a safe integer/,
    );
  });
});

describe('parseAmountInput', () => {
  it('normalizes plain amounts to two decimals', () => {
    assert.equal(parseAmountInput('1250'), '1250.00');
    assert.equal(parseAmountInput('12.34'), '12.34');
    assert.equal(parseAmountInput('12.5'), '12.50');
    assert.equal(parseAmountInput('0'), '0.00');
    assert.equal(parseAmountInput('0.50'), '0.50');
  });

  it('strips currency symbols, commas, and whitespace', () => {
    assert.equal(parseAmountInput(' $1,250.5 '), '1250.50');
    assert.equal(parseAmountInput('1 250'), '1250.00');
  });

  it('drops leading zeros but keeps a lone zero', () => {
    assert.equal(parseAmountInput('007'), '7.00');
    assert.equal(parseAmountInput('00.10'), '0.10');
  });

  it('rejects negatives, three decimals, and junk', () => {
    assert.equal(parseAmountInput('-5'), null);
    assert.equal(parseAmountInput('12.345'), null);
    assert.equal(parseAmountInput('12.'), null);
    assert.equal(parseAmountInput('.5'), null);
    assert.equal(parseAmountInput(''), null);
    assert.equal(parseAmountInput('abc'), null);
    assert.equal(parseAmountInput('1e3'), null);
  });

  it('rejects more than 13 whole digits', () => {
    assert.equal(parseAmountInput('1234567890123'), '1234567890123.00');
    assert.equal(parseAmountInput('12345678901234'), null);
  });
});

describe('percentUsed', () => {
  it('returns the rounded integer percentage', () => {
    assert.equal(percentUsed(8700, 10000), 87);
    assert.equal(percentUsed(8749, 10000), 87);
    assert.equal(percentUsed(8750, 10000), 88);
  });

  it('exceeds 100 when over budget', () => {
    assert.equal(percentUsed(15000, 10000), 150);
  });

  it('clamps negative spending to 0', () => {
    assert.equal(percentUsed(-500, 10000), 0);
  });

  it('returns null for a non-positive limit', () => {
    assert.equal(percentUsed(100, 0), null);
    assert.equal(percentUsed(100, -100), null);
  });
});

describe('progressFraction', () => {
  it('returns the spent/limit ratio', () => {
    assert.equal(progressFraction(5000, 10000), 0.5);
    assert.equal(progressFraction(0, 10000), 0);
  });

  it('clamps to [0, 1]', () => {
    assert.equal(progressFraction(20000, 10000), 1);
    assert.equal(progressFraction(-100, 10000), 0);
  });

  it('treats a non-positive limit as full when anything was spent', () => {
    assert.equal(progressFraction(1, 0), 1);
    assert.equal(progressFraction(500, -5), 1);
    assert.equal(progressFraction(0, 0), 0);
    assert.equal(progressFraction(-10, 0), 0);
  });
});

describe('scaleFraction', () => {
  it('returns the value/max ratio clamped to [0, 1]', () => {
    assert.equal(scaleFraction(5000, 10000), 0.5);
    assert.equal(scaleFraction(20000, 10000), 1);
    assert.equal(scaleFraction(-1, 10000), 0);
  });

  it('returns 0 for a non-positive max', () => {
    assert.equal(scaleFraction(100, 0), 0);
    assert.equal(scaleFraction(100, -10), 0);
  });
});

describe('averageMinor', () => {
  it('returns the rounded integer average', () => {
    assert.equal(averageMinor(1000, 4), 250);
    assert.equal(averageMinor(1001, 2), 501);
    assert.equal(averageMinor(999, 4), 250);
  });

  it('returns 0 for a non-positive or non-finite count', () => {
    assert.equal(averageMinor(1000, 0), 0);
    assert.equal(averageMinor(1000, -2), 0);
    assert.equal(averageMinor(1000, Number.POSITIVE_INFINITY), 0);
    assert.equal(averageMinor(1000, Number.NaN), 0);
  });

  it('handles negative totals (net outflow windows)', () => {
    assert.equal(averageMinor(-1000, 4), -250);
  });
});

describe('presetLimitsMinor (screens.md 3.6 preset chips)', () => {
  it('offers current, +50, +100, and spent rounded up to a whole unit', () => {
    assert.deepEqual(
      presetLimitsMinor({
        currentLimitMinor: 10000,
        spentMinor: 8755,
        digits: 2,
      }),
      [8800, 10000, 15000, 20000],
    );
  });

  it('omits the current chip when there is no current limit', () => {
    assert.deepEqual(presetLimitsMinor({ digits: 2 }), [5000, 10000]);
    assert.deepEqual(
      presetLimitsMinor({ currentLimitMinor: 0, digits: 2 }),
      [5000, 10000],
    );
  });

  it('dedupes a spent amount that rounds to an existing chip', () => {
    assert.deepEqual(
      presetLimitsMinor({
        currentLimitMinor: 5000,
        spentMinor: 5000,
        digits: 2,
      }),
      [5000, 10000, 15000],
    );
  });

  it('omits a zero or negative spent amount', () => {
    assert.deepEqual(
      presetLimitsMinor({ currentLimitMinor: 5000, spentMinor: 0, digits: 2 }),
      [5000, 10000, 15000],
    );
    assert.deepEqual(
      presetLimitsMinor({
        currentLimitMinor: 5000,
        spentMinor: -100,
        digits: 2,
      }),
      [5000, 10000, 15000],
    );
  });

  it('uses whole-unit steps for zero-digit currencies', () => {
    assert.deepEqual(
      presetLimitsMinor({ currentLimitMinor: 500, spentMinor: 123, digits: 0 }),
      [123, 500, 550, 600],
    );
  });

  it('drops non-positive chips entirely (negative current limit)', () => {
    assert.deepEqual(
      presetLimitsMinor({ currentLimitMinor: -100, digits: 2 }),
      [4900, 9900],
    );
  });

  it('truncates fractional digit counts and clamps negatives', () => {
    assert.deepEqual(
      presetLimitsMinor({ currentLimitMinor: 10000, digits: 2.9 }),
      [10000, 15000, 20000],
    );
    assert.deepEqual(
      presetLimitsMinor({ currentLimitMinor: 5, digits: -2 }),
      [5, 55, 105],
    );
  });

  it('returns ascending order regardless of insertion order', () => {
    assert.deepEqual(
      presetLimitsMinor({
        currentLimitMinor: 30000,
        spentMinor: 100,
        digits: 2,
      }),
      [100, 30000, 35000, 40000],
    );
  });
});
