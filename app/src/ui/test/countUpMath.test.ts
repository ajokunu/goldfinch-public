/**
 * countUpMath unit tests (PHASE9-DECISIONS P9-3: "count-up easing,
 * digit-roll slicing" are StrykerJS targets).
 *
 * Expected plans are written out as full LITERAL column arrays so a mutant
 * that flips a key, kind, fromDigit, or entering flag anywhere in the slicer
 * is killed; nothing is recomputed with the code under test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DIGIT_STRIP,
  digitValue,
  easeOutCubic,
  isAsciiDigit,
  planColumns,
  stripOffset,
  type CountUpColumn,
} from '../motion/countUpMath';

function col(
  key: string,
  kind: CountUpColumn['kind'],
  char: string,
  digit: number | null,
  fromDigit: number | null,
  entering: boolean,
): CountUpColumn {
  return { key, kind, char, digit, fromDigit, entering };
}

describe('isAsciiDigit / digitValue', () => {
  it('recognizes exactly 0-9', () => {
    assert.equal(isAsciiDigit('0'), true);
    assert.equal(isAsciiDigit('9'), true);
    assert.equal(isAsciiDigit('5'), true);
    assert.equal(isAsciiDigit('a'), false);
    assert.equal(isAsciiDigit('$'), false);
    assert.equal(isAsciiDigit(','), false);
    assert.equal(isAsciiDigit('.'), false);
    assert.equal(isAsciiDigit('-'), false);
    assert.equal(isAsciiDigit(''), false);
    assert.equal(isAsciiDigit('12'), false);
    // The chars flanking the ASCII digit block must not leak in.
    assert.equal(isAsciiDigit('/'), false);
    assert.equal(isAsciiDigit(':'), false);
  });

  it('maps characters to digit values', () => {
    assert.equal(digitValue('0'), 0);
    assert.equal(digitValue('7'), 7);
    assert.equal(digitValue('9'), 9);
    assert.equal(digitValue('x'), null);
    assert.equal(digitValue('.'), null);
  });
});

describe('DIGIT_STRIP', () => {
  it('is 0..9 top to bottom (the offset math depends on this order)', () => {
    assert.deepEqual(DIGIT_STRIP, [
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ]);
  });
});

describe('planColumns', () => {
  it('first mount without initialFromZero: everything enters in place', () => {
    assert.deepEqual(planColumns(null, '$42'), [
      col('c2', 'static', '$', null, null, true),
      col('c1', 'digit', '4', 4, null, true),
      col('c0', 'digit', '2', 2, null, true),
    ]);
  });

  it('first mount with initialFromZero: digits roll up from 0', () => {
    assert.deepEqual(planColumns(null, '$42', true), [
      col('c2', 'static', '$', null, null, true),
      col('c1', 'digit', '4', 4, 0, true),
      col('c0', 'digit', '2', 2, 0, true),
    ]);
  });

  it('same-shape value change rolls each digit from its predecessor', () => {
    assert.deepEqual(planColumns('$12.50', '$13.75'), [
      col('c5', 'static', '$', null, null, false),
      col('c4', 'digit', '1', 1, 1, false),
      col('c3', 'digit', '3', 3, 2, false),
      col('c2', 'static', '.', null, null, false),
      col('c1', 'digit', '7', 7, 5, false),
      col('c0', 'digit', '5', 5, 0, false),
    ]);
  });

  it('aligns from the RIGHT when the string grows ($999.99 -> $1,000.00)', () => {
    assert.deepEqual(planColumns('$999.99', '$1,000.00'), [
      // Two brand-new columns enter on the left...
      col('c8', 'static', '$', null, null, true),
      col('c7', 'digit', '1', 1, null, true),
      // ...the old '$' position now holds a separator (kind change),
      col('c6', 'static', ',', null, null, false),
      // ...and the digit/point columns keep their identities.
      col('c5', 'digit', '0', 0, 9, false),
      col('c4', 'digit', '0', 0, 9, false),
      col('c3', 'digit', '0', 0, 9, false),
      col('c2', 'static', '.', null, null, false),
      col('c1', 'digit', '0', 0, 9, false),
      col('c0', 'digit', '0', 0, 9, false),
    ]);
  });

  it('a digit replacing a static glyph never rolls (fromDigit null)', () => {
    // '-$5' -> '$15': position 2 goes '-' -> '$' (static), position 1 goes
    // '$' (static) -> '1' (digit): the new digit must enter in place.
    assert.deepEqual(planColumns('-$5', '$15'), [
      col('c2', 'static', '$', null, null, false),
      col('c1', 'digit', '1', 1, null, false),
      col('c0', 'digit', '5', 5, 5, false),
    ]);
  });

  it('shrinking values simply drop the leftover left columns', () => {
    assert.deepEqual(planColumns('$1,000.00', '$999.99'), [
      col('c6', 'static', '$', null, null, false),
      col('c5', 'digit', '9', 9, 0, false),
      col('c4', 'digit', '9', 9, 0, false),
      col('c3', 'digit', '9', 9, 0, false),
      col('c2', 'static', '.', null, null, false),
      col('c1', 'digit', '9', 9, 0, false),
      col('c0', 'digit', '9', 9, 0, false),
    ]);
  });

  it('zero-minor-digit currencies plan without a decimal column', () => {
    assert.deepEqual(planColumns('¥1,234', '¥1,235'), [
      col('c5', 'static', '¥', null, null, false),
      col('c4', 'digit', '1', 1, 1, false),
      col('c3', 'static', ',', null, null, false),
      col('c2', 'digit', '2', 2, 2, false),
      col('c1', 'digit', '3', 3, 3, false),
      col('c0', 'digit', '5', 5, 4, false),
    ]);
  });

  it('identical strings plan a full-roll-free update', () => {
    assert.deepEqual(planColumns('$7', '$7'), [
      col('c1', 'static', '$', null, null, false),
      col('c0', 'digit', '7', 7, 7, false),
    ]);
  });
});

describe('stripOffset', () => {
  it('translates the strip by -digit * rowHeight', () => {
    assert.equal(stripOffset(0, 24), -0);
    assert.equal(stripOffset(1, 24), -24);
    assert.equal(stripOffset(9, 24), -216);
    assert.equal(stripOffset(4, 30), -120);
  });

  it('clamps digits into [0, 9] and rounds fractions', () => {
    assert.equal(stripOffset(-3, 24), -0);
    assert.equal(stripOffset(12, 24), -216);
    assert.equal(stripOffset(4.4, 10), -40);
    assert.equal(stripOffset(4.5, 10), -50);
  });

  it('junk heights and digits read as 0', () => {
    assert.equal(stripOffset(5, Number.NaN), -0);
    assert.equal(stripOffset(5, -20), -0);
    assert.equal(stripOffset(Number.NaN, 24), -0);
  });
});

describe('easeOutCubic', () => {
  it('matches 1 - (1 - t)^3 at literal points', () => {
    assert.equal(easeOutCubic(0), 0);
    assert.equal(easeOutCubic(1), 1);
    assert.equal(easeOutCubic(0.5), 0.875);
    assert.equal(easeOutCubic(0.25), 0.578125);
    assert.equal(easeOutCubic(0.75), 0.984375);
  });

  it('clamps inputs to [0, 1] and treats junk as 0', () => {
    assert.equal(easeOutCubic(-1), 0);
    assert.equal(easeOutCubic(2), 1);
    assert.equal(easeOutCubic(Number.NaN), 0);
  });

  it('is monotonically non-decreasing across the unit interval', () => {
    let previous = 0;
    for (let step = 0; step <= 100; step += 1) {
      const value = easeOutCubic(step / 100);
      assert.ok(value >= previous, `decreased at t=${step / 100}`);
      previous = value;
    }
    assert.equal(previous, 1);
  });
});
