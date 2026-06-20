/**
 * Display-name validation tests (mutation-grade): every boundary of the
 * 1..40 inclusive length rule, trimming, astral-codepoint counting, and the
 * discriminated validate result. Targets src/profile.ts in the Stryker
 * mutate list so an off-by-one or flipped comparator is caught.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_DISPLAY_NAME_MIN_LENGTH,
} from '../src/constants.js';
import {
  displayNameLength,
  isValidDisplayName,
  normalizeDisplayName,
  validateDisplayName,
} from '../src/profile.js';

const MIN = PROFILE_DISPLAY_NAME_MIN_LENGTH; // 1
const MAX = PROFILE_DISPLAY_NAME_MAX_LENGTH; // 40

describe('normalizeDisplayName', () => {
  it('trims both ends and inner is preserved', () => {
    assert.equal(normalizeDisplayName('  Taylor  '), 'Taylor');
    assert.equal(normalizeDisplayName('Da mi'), 'Da mi');
    assert.equal(normalizeDisplayName('\t\nTaylor\n'), 'Taylor');
  });
});

describe('displayNameLength', () => {
  it('counts codepoints after trimming, astral-safe', () => {
    assert.equal(displayNameLength('  ab  '), 2);
    assert.equal(displayNameLength('a\u{1F600}b'), 3); // emoji = 1 codepoint
    assert.equal(displayNameLength('   '), 0);
  });
});

describe('isValidDisplayName boundaries', () => {
  it('rejects empty / whitespace-only (below MIN)', () => {
    assert.equal(isValidDisplayName(''), false);
    assert.equal(isValidDisplayName('   '), false);
  });
  it('accepts exactly MIN', () => {
    assert.equal(isValidDisplayName('a'.repeat(MIN)), true);
  });
  it('accepts exactly MAX', () => {
    assert.equal(isValidDisplayName('a'.repeat(MAX)), true);
  });
  it('rejects MAX + 1', () => {
    assert.equal(isValidDisplayName('a'.repeat(MAX + 1)), false);
  });
  it('accepts MAX after trimming surrounding space', () => {
    assert.equal(isValidDisplayName(`  ${'a'.repeat(MAX)}  `), true);
  });
});

describe('validateDisplayName', () => {
  it('returns the trimmed value when valid', () => {
    assert.deepEqual(validateDisplayName('  Taylor  '), {
      ok: true,
      value: 'Taylor',
    });
  });
  it('reports too-short for empty', () => {
    assert.deepEqual(validateDisplayName('   '), {
      ok: false,
      reason: 'too-short',
    });
  });
  it('reports too-long past MAX', () => {
    assert.deepEqual(validateDisplayName('a'.repeat(MAX + 1)), {
      ok: false,
      reason: 'too-long',
    });
  });
  it('MIN and MAX exact lengths are ok', () => {
    assert.equal(validateDisplayName('a'.repeat(MIN)).ok, true);
    assert.equal(validateDisplayName('a'.repeat(MAX)).ok, true);
  });
});
