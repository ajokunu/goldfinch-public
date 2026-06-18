/**
 * Money helpers: integer minor units + exact decimal strings (Resolved
 * Decisions Log: money = integer minor units, decimal strings at boundaries,
 * never floats). Mutation-hardened (P7-10): every currency table entry, every
 * parser rejection path, and every rounding/sign edge is pinned, because a
 * surviving mutant here is a money bug.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MoneyError,
  addMinor,
  assertMinorUnits,
  formatMinor,
  isNegativeAmount,
  minorUnitDigits,
  negateMinor,
  parseCurrencyAmount,
  parseDecimalString,
  toCurrencyDecimalString,
  toDecimalString,
} from '../src/money.js';

/** Intl may emit U+00A0/U+202F between code and amount; normalize for asserts. */
function plainSpaces(value: string): string {
  return value.replace(/[\u00A0\u202F]/g, ' ');
}

describe('minorUnitDigits', () => {
  it('returns 0 for every locked zero-digit ISO currency', () => {
    const zeroDigit = [
      'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
      'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
    ];
    for (const code of zeroDigit) {
      assert.equal(minorUnitDigits(code), 0, code);
    }
  });

  it('returns 3 for every locked three-digit ISO currency', () => {
    const threeDigit = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];
    for (const code of threeDigit) {
      assert.equal(minorUnitDigits(code), 3, code);
    }
  });

  it('defaults to 2 (USD cents and unknown codes alike)', () => {
    assert.equal(minorUnitDigits('USD'), 2);
    assert.equal(minorUnitDigits('EUR'), 2);
    assert.equal(minorUnitDigits('GBP'), 2);
    assert.equal(minorUnitDigits('XYZ'), 2);
    // SimpleFIN may send a URL for non-fiat; documented fallback is 2.
    assert.equal(minorUnitDigits('https://example.com/custom-asset'), 2);
  });

  it('is case-insensitive (codes are uppercased before lookup)', () => {
    assert.equal(minorUnitDigits('jpy'), 0);
    assert.equal(minorUnitDigits('kwd'), 3);
    assert.equal(minorUnitDigits('usd'), 2);
  });
});

describe('assertMinorUnits', () => {
  it('accepts safe integers across the full range', () => {
    assert.doesNotThrow(() => assertMinorUnits(0));
    assert.doesNotThrow(() => assertMinorUnits(-1));
    assert.doesNotThrow(() => assertMinorUnits(Number.MAX_SAFE_INTEGER));
    assert.doesNotThrow(() => assertMinorUnits(Number.MIN_SAFE_INTEGER));
  });

  it('rejects floats, NaN, infinities, unsafe magnitudes, and non-numbers', () => {
    assert.throws(() => assertMinorUnits(0.5), MoneyError);
    assert.throws(() => assertMinorUnits(Number.NaN), MoneyError);
    assert.throws(() => assertMinorUnits(Number.POSITIVE_INFINITY), MoneyError);
    assert.throws(() => assertMinorUnits(Number.MAX_SAFE_INTEGER + 1), MoneyError);
    assert.throws(() => assertMinorUnits('5' as never), MoneyError);
  });

  it('names the offending field via the label (default "amount")', () => {
    assert.throws(() => assertMinorUnits(0.5), /amount must be a safe integer/);
    assert.throws(() => assertMinorUnits(0.5, 'spentMinor'), /spentMinor must be a safe integer/);
  });
});

describe('parseDecimalString', () => {
  it('parses signed decimals at the default 2-digit scale', () => {
    assert.equal(parseDecimalString('45.99'), 4599);
    assert.equal(parseDecimalString('-45.99'), -4599);
    assert.equal(parseDecimalString('+45.99'), 4599);
    assert.equal(parseDecimalString('0'), 0);
    assert.equal(parseDecimalString('0.00'), 0);
    assert.equal(parseDecimalString('1234.56'), 123456);
  });

  it('trims surrounding whitespace', () => {
    assert.equal(parseDecimalString('  45.99  '), 4599);
  });

  it('pads short fractions to the scale ("45.9" is 45.90)', () => {
    assert.equal(parseDecimalString('45.9'), 4590);
    assert.equal(parseDecimalString('45'), 4500);
    assert.equal(parseDecimalString('45.99', 3), 45990);
  });

  it('accepts trailing zeros beyond the scale, rejects significant digits', () => {
    assert.equal(parseDecimalString('45.990'), 4599);
    assert.equal(parseDecimalString('45.9900000'), 4599);
    assert.throws(() => parseDecimalString('45.999'), MoneyError);
    assert.throws(() => parseDecimalString('45.991'), MoneyError);
  });

  it('handles 0-digit and 8-digit scales exactly', () => {
    assert.equal(parseDecimalString('1500', 0), 1500);
    assert.equal(parseDecimalString('1500.00', 0), 1500);
    assert.throws(() => parseDecimalString('1500.01', 0), MoneyError);
    assert.equal(parseDecimalString('1', 8), 100_000_000);
    assert.equal(parseDecimalString('0.12345678', 8), 12_345_678);
  });

  it('rejects floats-in-disguise and non-numeric strings', () => {
    for (const bad of ['', '   ', 'abc', '1e5', 'NaN', 'Infinity', '.5', '5.', '--5', '+-5', '4 5', '12.34.56']) {
      assert.throws(() => parseDecimalString(bad), MoneyError, `should reject "${bad}"`);
    }
  });

  it('rejects non-string input with a typed error', () => {
    assert.throws(() => parseDecimalString(45.99 as never), /expected a decimal string/);
  });

  it('rejects out-of-range scales (digits must be an integer in [0, 8])', () => {
    assert.throws(() => parseDecimalString('1', -1), MoneyError);
    assert.throws(() => parseDecimalString('1', 9), MoneyError);
    assert.throws(() => parseDecimalString('1', 2.5), MoneyError);
  });

  it('covers the full safe-integer range and rejects just beyond it', () => {
    assert.equal(parseDecimalString('90071992547409.91'), 9007199254740991);
    assert.equal(parseDecimalString('-90071992547409.91'), -9007199254740991);
    assert.throws(() => parseDecimalString('90071992547409.92'), /safe integer/);
  });

  it('normalizes "-0.00" to plain 0 (never -0)', () => {
    const parsed = parseDecimalString('-0.00');
    assert.equal(parsed, 0);
    assert.equal(Object.is(parsed, -0), false);
  });
});

describe('parseCurrencyAmount / toCurrencyDecimalString', () => {
  it('applies the currency scale on parse', () => {
    assert.equal(parseCurrencyAmount('45.99', 'USD'), 4599);
    assert.equal(parseCurrencyAmount('1500', 'JPY'), 1500);
    assert.equal(parseCurrencyAmount('1.250', 'KWD'), 1250);
    assert.throws(() => parseCurrencyAmount('1500.5', 'JPY'), MoneyError);
    assert.throws(() => parseCurrencyAmount('45.999', 'USD'), MoneyError);
  });

  it('applies the currency scale on render', () => {
    assert.equal(toCurrencyDecimalString(-4599, 'USD'), '-45.99');
    assert.equal(toCurrencyDecimalString(1500, 'JPY'), '1500');
    assert.equal(toCurrencyDecimalString(1250, 'KWD'), '1.250');
  });
});

describe('toDecimalString', () => {
  it('renders exact decimal strings with zero-padding', () => {
    assert.equal(toDecimalString(4599), '45.99');
    assert.equal(toDecimalString(-4599), '-45.99');
    assert.equal(toDecimalString(0), '0.00');
    assert.equal(toDecimalString(5), '0.05');
    assert.equal(toDecimalString(-5), '-0.05');
    assert.equal(toDecimalString(100), '1.00');
    assert.equal(toDecimalString(123456), '1234.56');
  });

  it('renders 0-digit and 3-digit scales', () => {
    assert.equal(toDecimalString(1500, 0), '1500');
    assert.equal(toDecimalString(-7, 0), '-7');
    assert.equal(toDecimalString(0, 0), '0');
    assert.equal(toDecimalString(1250, 3), '1.250');
    assert.equal(toDecimalString(1, 3), '0.001');
  });

  it('treats -0 as 0 (no "-0.00")', () => {
    assert.equal(toDecimalString(-0), '0.00');
  });

  it('rejects non-integer minor units and out-of-range scales', () => {
    assert.throws(() => toDecimalString(0.5), MoneyError);
    assert.throws(() => toDecimalString(Number.NaN), MoneyError);
    assert.throws(() => toDecimalString(100, 9), MoneyError);
    assert.throws(() => toDecimalString(100, -1), MoneyError);
  });

  it('round-trips losslessly with parseDecimalString at every scale', () => {
    const values = [
      0, 1, -1, 5, -5, 99, -99, 100, -100, 4599, -4599, 123456, -123456,
      Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER,
    ];
    for (const digits of [0, 2, 3, 8]) {
      for (const value of values) {
        assert.equal(
          parseDecimalString(toDecimalString(value, digits), digits),
          value,
          `digits=${digits} value=${value}`,
        );
      }
    }
  });
});

describe('addMinor', () => {
  it('sums integers exactly (empty sum is 0)', () => {
    assert.equal(addMinor(), 0);
    assert.equal(addMinor(5), 5);
    assert.equal(addMinor(1, 2, 3), 6);
    assert.equal(addMinor(-5, 5), 0);
    assert.equal(addMinor(-1599, -1599, 3000), -198);
  });

  it('is overflow-checked at the safe-integer boundary', () => {
    assert.equal(addMinor(Number.MAX_SAFE_INTEGER, -1), Number.MAX_SAFE_INTEGER - 1);
    assert.equal(addMinor(Number.MAX_SAFE_INTEGER, 0), Number.MAX_SAFE_INTEGER);
    assert.throws(() => addMinor(Number.MAX_SAFE_INTEGER, 1), /safe integer/);
    assert.throws(() => addMinor(Number.MIN_SAFE_INTEGER, -1), MoneyError);
    // Intermediate overflow that returns to range must still be exact (BigInt).
    assert.equal(addMinor(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  });

  it('rejects non-integer addends', () => {
    assert.throws(() => addMinor(1, 0.5), MoneyError);
    assert.throws(() => addMinor(Number.NaN), MoneyError);
  });
});

describe('negateMinor', () => {
  it('negates both signs and fixes -0', () => {
    assert.equal(negateMinor(5), -5);
    assert.equal(negateMinor(-5), 5);
    assert.equal(negateMinor(0), 0);
    assert.equal(Object.is(negateMinor(0), -0), false);
    assert.equal(negateMinor(Number.MAX_SAFE_INTEGER), Number.MIN_SAFE_INTEGER);
  });

  it('rejects non-integer input', () => {
    assert.throws(() => negateMinor(0.5), MoneyError);
  });
});

describe('isNegativeAmount', () => {
  it('handles minor-unit numbers', () => {
    assert.equal(isNegativeAmount(-1), true);
    assert.equal(isNegativeAmount(0), false);
    assert.equal(isNegativeAmount(1), false);
    assert.throws(() => isNegativeAmount(0.5), MoneyError);
  });

  it('handles decimal strings without parsing to float', () => {
    assert.equal(isNegativeAmount('-45.99'), true);
    assert.equal(isNegativeAmount('45.99'), false);
    assert.equal(isNegativeAmount('+45.99'), false);
    assert.equal(isNegativeAmount('0.00'), false);
    assert.equal(isNegativeAmount('  -1  '), true);
    assert.equal(isNegativeAmount('  1  '), false);
  });

  it('accepts up to 8 fractional digits and rejects more', () => {
    assert.equal(isNegativeAmount('0.12345678'), false);
    assert.throws(() => isNegativeAmount('0.123456789'), MoneyError);
  });

  it('rejects malformed strings loudly', () => {
    assert.throws(() => isNegativeAmount('abc'), MoneyError);
    assert.throws(() => isNegativeAmount('1e5'), MoneyError);
    assert.throws(() => isNegativeAmount(''), MoneyError);
  });
});

describe('formatMinor', () => {
  it('formats USD with the en-US default locale', () => {
    assert.equal(formatMinor(-4599, 'USD'), '-$45.99');
    assert.equal(formatMinor(4599, 'USD'), '$45.99');
    assert.equal(formatMinor(5, 'USD'), '$0.05');
    assert.equal(formatMinor(0, 'USD'), '$0.00');
  });

  it('respects per-currency minor-unit digits (0-digit JPY, 3-digit KWD)', () => {
    assert.equal(formatMinor(1500, 'JPY'), '¥1,500');
    assert.equal(plainSpaces(formatMinor(1250, 'KWD')), 'KWD 1.250');
    assert.equal(plainSpaces(formatMinor(-1250, 'KWD')), '-KWD 1.250');
  });

  it('honors an explicit locale', () => {
    // de-DE uses comma decimals; pin just the digit shape to stay ICU-stable.
    assert.match(formatMinor(-4599, 'USD', 'de-DE'), /45,99/);
  });

  it('propagates minor-unit validation', () => {
    assert.throws(() => formatMinor(0.5, 'USD'), MoneyError);
  });

  it('MoneyError carries its name for structured logging', () => {
    try {
      formatMinor(0.5, 'USD');
      assert.fail('expected a throw');
    } catch (error) {
      assert.ok(error instanceof MoneyError);
      assert.equal(error.name, 'MoneyError');
    }
  });
});

describe('mutation hardening (P7-10)', () => {
  it('reports precise parser rejection reasons', () => {
    assert.throws(() => parseDecimalString('abc'), /not a decimal string: "abc"/);
    assert.throws(() => parseDecimalString('1.999'), /"1\.999" has more than 2 significant fractional digits/);
    assert.throws(() => parseDecimalString('1.0001', 3), /more than 3 significant fractional digits/);
    assert.throws(() => toDecimalString(100, -1), /minor-unit digits must be an integer in \[0, 8\], got -1/);
    assert.throws(() => parseDecimalString('1', 9), /minor-unit digits must be an integer in \[0, 8\], got 9/);
  });
});
