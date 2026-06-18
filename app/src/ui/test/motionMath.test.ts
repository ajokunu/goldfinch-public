/**
 * motionMath unit tests (PHASE9-DECISIONS P9-3: stagger math and the
 * kill-switch duration rules are StrykerJS targets).
 *
 * Every expected value is a hand-computed LITERAL (never recomputed with the
 * helpers under test) so arithmetic mutants cannot survive by symmetry.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampMultiplier,
  fadeDuration,
  moveDuration,
  resolveMotionSettings,
  resolveReduceMotion,
  staggerChildDelayMs,
  type MotionSettings,
} from '../motion/motionMath';
import { MOTION_MULTIPLIER, REDUCED_FADE_MS } from '../motion/tokens';

const FULL: MotionSettings = { reduceMotion: false, multiplier: 1 };
const REDUCED: MotionSettings = { reduceMotion: true, multiplier: 0 };
const KILLED: MotionSettings = { reduceMotion: false, multiplier: 0 };
const DOUBLED: MotionSettings = { reduceMotion: false, multiplier: 2 };

describe('resolveReduceMotion', () => {
  it('mirrors the OS flag when the override is null', () => {
    assert.equal(resolveReduceMotion(true, null), true);
    assert.equal(resolveReduceMotion(false, null), false);
  });

  it('store override wins over the OS flag in both directions', () => {
    assert.equal(resolveReduceMotion(true, false), false);
    assert.equal(resolveReduceMotion(false, true), true);
    assert.equal(resolveReduceMotion(true, true), true);
    assert.equal(resolveReduceMotion(false, false), false);
  });
});

describe('clampMultiplier', () => {
  it('passes the working band through unchanged', () => {
    assert.equal(clampMultiplier(1), 1);
    assert.equal(clampMultiplier(0.5), 0.5);
    assert.equal(clampMultiplier(4), 4);
  });

  it('caps at 4', () => {
    assert.equal(clampMultiplier(4.01), 4);
    assert.equal(clampMultiplier(100), 4);
  });

  it('reads zero, negatives, and junk as 0', () => {
    assert.equal(clampMultiplier(0), 0);
    assert.equal(clampMultiplier(-1), 0);
    assert.equal(clampMultiplier(Number.NaN), 0);
    assert.equal(clampMultiplier(Number.POSITIVE_INFINITY), 0);
  });
});

describe('resolveMotionSettings', () => {
  it('full motion: not reduced, global multiplier (token default 1)', () => {
    assert.deepEqual(resolveMotionSettings(false, null), {
      reduceMotion: false,
      multiplier: MOTION_MULTIPLIER,
    });
    // The token itself is the designed-motion identity.
    assert.equal(MOTION_MULTIPLIER, 1);
  });

  it('reduced motion (either source) forces the multiplier to 0', () => {
    assert.deepEqual(resolveMotionSettings(true, null), {
      reduceMotion: true,
      multiplier: 0,
    });
    assert.deepEqual(resolveMotionSettings(false, true), {
      reduceMotion: true,
      multiplier: 0,
    });
  });

  it('store override false restores full motion despite the OS flag', () => {
    assert.deepEqual(resolveMotionSettings(true, false), {
      reduceMotion: false,
      multiplier: 1,
    });
  });

  it('clamps an injected base multiplier', () => {
    assert.deepEqual(resolveMotionSettings(false, null, 8), {
      reduceMotion: false,
      multiplier: 4,
    });
    assert.deepEqual(resolveMotionSettings(false, null, 0), {
      reduceMotion: false,
      multiplier: 0,
    });
  });
});

describe('fadeDuration', () => {
  it('scales by the multiplier at full motion', () => {
    assert.equal(fadeDuration(320, FULL), 320);
    assert.equal(fadeDuration(320, DOUBLED), 640);
    assert.equal(fadeDuration(125, { reduceMotion: false, multiplier: 0.5 }), 63);
  });

  it('collapses to the reduced fade, never longer than REDUCED_FADE_MS', () => {
    assert.equal(REDUCED_FADE_MS, 80);
    assert.equal(fadeDuration(320, REDUCED), 80);
    assert.equal(fadeDuration(80, REDUCED), 80);
  });

  it('keeps fades already shorter than the reduced fade', () => {
    assert.equal(fadeDuration(40, REDUCED), 40);
  });

  it('multiplier 0 (kill switch) zeroes fades when not reduced', () => {
    assert.equal(fadeDuration(320, KILLED), 0);
  });

  it('junk and negative durations read as 0 (and as 0 when reduced)', () => {
    assert.equal(fadeDuration(-100, FULL), 0);
    assert.equal(fadeDuration(Number.NaN, FULL), 0);
    assert.equal(fadeDuration(-100, REDUCED), 0);
  });
});

describe('moveDuration', () => {
  it('scales by the multiplier at full motion', () => {
    assert.equal(moveDuration(650, FULL), 650);
    assert.equal(moveDuration(650, DOUBLED), 1300);
    assert.equal(moveDuration(45, { reduceMotion: false, multiplier: 0.5 }), 23);
  });

  it('reduced motion eliminates movement entirely', () => {
    assert.equal(moveDuration(650, REDUCED), 0);
  });

  it('multiplier 0 (kill switch) zeroes movement', () => {
    assert.equal(moveDuration(650, KILLED), 0);
  });

  it('reduceMotion dominates even an inconsistent positive multiplier', () => {
    // resolveMotionSettings never produces this shape, but a hand-built
    // settings object must still respect the accessibility flag first.
    const inconsistent: MotionSettings = { reduceMotion: true, multiplier: 1 };
    assert.equal(moveDuration(650, inconsistent), 0);
    assert.equal(fadeDuration(320, inconsistent), 80);
  });

  it('junk and negative durations read as 0', () => {
    assert.equal(moveDuration(-5, FULL), 0);
    assert.equal(moveDuration(Number.NaN, FULL), 0);
  });
});

describe('staggerChildDelayMs', () => {
  it('grows linearly with the index (45ms cascade)', () => {
    assert.equal(staggerChildDelayMs(0, 45), 0);
    assert.equal(staggerChildDelayMs(1, 45), 45);
    assert.equal(staggerChildDelayMs(2, 45), 90);
    assert.equal(staggerChildDelayMs(7, 45), 315);
  });

  it('adds the initial delay', () => {
    assert.equal(staggerChildDelayMs(0, 45, 120), 120);
    assert.equal(staggerChildDelayMs(3, 60, 100), 280);
  });

  it('floors fractional indexes and clamps junk to 0', () => {
    assert.equal(staggerChildDelayMs(2.9, 45), 90);
    assert.equal(staggerChildDelayMs(-3, 45), 0);
    assert.equal(staggerChildDelayMs(Number.NaN, 45), 0);
  });

  it('clamps junk intervals and initial delays to 0', () => {
    assert.equal(staggerChildDelayMs(4, -45), 0);
    assert.equal(staggerChildDelayMs(4, Number.NaN), 0);
    assert.equal(staggerChildDelayMs(2, 45, -10), 90);
    assert.equal(staggerChildDelayMs(2, 45, Number.NaN), 90);
  });

  it('rounds to whole milliseconds', () => {
    assert.equal(staggerChildDelayMs(3, 45.4), 136);
  });
});
