/** Goal form-input parsing: currency-scaled amounts, signs, dates, fractions. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GoalInputError,
  isZeroDecimal,
  parseAmountInput,
  parseCurrencyCodeInput,
  progressFraction,
  signedContributionAmount,
} from '../lib/inputs.js';

describe('parseAmountInput', () => {
  it('normalizes plain amounts to two decimals by default', () => {
    assert.equal(parseAmountInput('250'), '250.00');
    assert.equal(parseAmountInput('250.5'), '250.50');
    assert.equal(parseAmountInput('0'), '0.00');
    assert.equal(parseAmountInput('00.5'), '0.50');
  });

  it('strips currency symbols, commas, and whitespace', () => {
    assert.equal(parseAmountInput(' $3,000 '), '3000.00');
    assert.equal(parseAmountInput('1,250.5'), '1250.50');
  });

  it('rejects non-amounts', () => {
    assert.equal(parseAmountInput(''), null);
    assert.equal(parseAmountInput('abc'), null);
    assert.equal(parseAmountInput('-5'), null); // sign comes from the direction toggle
    assert.equal(parseAmountInput('1.234'), null); // too many decimals for 2-digit
    assert.equal(parseAmountInput('1.2.3'), null);
    assert.equal(parseAmountInput('1e3'), null);
  });

  it('parses at the currency minor-unit scale (P7-7)', () => {
    // 0-digit (JPY): integers only, no decimal point in the canonical form.
    assert.equal(parseAmountInput('5000', 0), '5000');
    assert.equal(parseAmountInput('5000.00', 0), null);
    // 3-digit (KWD): up to three decimals, padded to exactly three.
    assert.equal(parseAmountInput('1.5', 3), '1.500');
    assert.equal(parseAmountInput('1.234', 3), '1.234');
    assert.equal(parseAmountInput('1.2345', 3), null);
  });

  it('throws GoalInputError on a nonsense digits argument', () => {
    assert.throws(() => parseAmountInput('1', -1), GoalInputError);
    assert.throws(() => parseAmountInput('1', 1.5), GoalInputError);
    assert.throws(() => parseAmountInput('1', 7), GoalInputError);
  });
});

describe('isZeroDecimal', () => {
  it('recognizes canonical zeros at any scale', () => {
    assert.equal(isZeroDecimal('0'), true);
    assert.equal(isZeroDecimal('0.00'), true);
    assert.equal(isZeroDecimal('0.000'), true);
  });

  it('rejects non-zero values', () => {
    assert.equal(isZeroDecimal('12.00'), false);
    assert.equal(isZeroDecimal('0.01'), false);
    assert.equal(isZeroDecimal('0.10'), false);
  });
});

describe('signedContributionAmount', () => {
  it('passes additions through and negates withdrawals', () => {
    assert.equal(signedContributionAmount('25.00', 'add'), '25.00');
    assert.equal(signedContributionAmount('25.00', 'withdraw'), '-25.00');
  });
});

describe('parseCurrencyCodeInput', () => {
  it('normalizes three-letter codes to uppercase', () => {
    assert.equal(parseCurrencyCodeInput('usd'), 'USD');
    assert.equal(parseCurrencyCodeInput(' Jpy '), 'JPY');
    assert.equal(parseCurrencyCodeInput('KWD'), 'KWD');
  });

  it('rejects malformed codes', () => {
    assert.equal(parseCurrencyCodeInput('us'), null);
    assert.equal(parseCurrencyCodeInput('usdd'), null);
    assert.equal(parseCurrencyCodeInput('U$D'), null);
    assert.equal(parseCurrencyCodeInput(''), null);
  });
});

describe('progressFraction', () => {
  it('clamps to [0, 1]', () => {
    assert.equal(progressFraction(0, 10_000), 0);
    assert.equal(progressFraction(-500, 10_000), 0);
    assert.equal(progressFraction(5_000, 10_000), 0.5);
    assert.equal(progressFraction(10_000, 10_000), 1);
    assert.equal(progressFraction(25_000, 10_000), 1);
  });

  it('degrades for a non-positive target (corrupt data) without crashing', () => {
    assert.equal(progressFraction(0, 0), 0);
    assert.equal(progressFraction(100, 0), 1);
  });
});
