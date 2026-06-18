/** Pure display helpers for the Activity restyle (lib/display.ts). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dayHeadingKind, initialOf, isPositiveDecimal } from '../lib/display.js';

describe('dayHeadingKind', () => {
  const today = '2026-06-10';
  const yesterday = '2026-06-09';

  it('classifies today / yesterday / other', () => {
    assert.equal(dayHeadingKind('2026-06-10', today, yesterday), 'today');
    assert.equal(dayHeadingKind('2026-06-09', today, yesterday), 'yesterday');
    assert.equal(dayHeadingKind('2026-06-08', today, yesterday), 'other');
    assert.equal(dayHeadingKind('2025-06-10', today, yesterday), 'other');
  });
});

describe('isPositiveDecimal', () => {
  it('is true only for strictly positive decimal strings', () => {
    assert.equal(isPositiveDecimal('12.50'), true);
    assert.equal(isPositiveDecimal('0.01'), true);
    assert.equal(isPositiveDecimal(' 3 '), true);
    assert.equal(isPositiveDecimal('0'), false);
    assert.equal(isPositiveDecimal('0.00'), false);
    assert.equal(isPositiveDecimal('-12.50'), false);
    // Leading whitespace before the sign must not defeat the '-' check.
    assert.equal(isPositiveDecimal(' -5.00 '), false);
    assert.equal(isPositiveDecimal('\t-0.01'), false);
    assert.equal(isPositiveDecimal('-0.00'), false);
    assert.equal(isPositiveDecimal(''), false);
  });
});

describe('initialOf', () => {
  it('uppercases the first non-space character', () => {
    assert.equal(initialOf('blue Bottle'), 'B');
    assert.equal(initialOf('  cafe'), 'C');
    assert.equal(initialOf('7-Eleven'), '7');
  });

  it("falls back to '?' for empty input", () => {
    assert.equal(initialOf(''), '?');
    assert.equal(initialOf('   '), '?');
  });
});
