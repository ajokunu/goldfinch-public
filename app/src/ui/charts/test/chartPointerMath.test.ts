/**
 * Pointer-interaction math unit tests (PHASE9-DECISIONS P9-2 items 4/5,
 * P9-3 "every primitive unit-tested where pure"): the crosshair scrubber's
 * nearest-index snapping and the donut swell's ring hit test / value-flag
 * anchor angle, at fixed inputs including the degenerate cases (empty data,
 * non-finite pointers, zero totals, off-band distances).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DONUT_HIT_SLOP,
  donutHitSegment,
  donutSegmentMidAngle,
  nearestIndexForX,
} from '../chartMath';

const approx = (actual: number | null, expected: number, eps = 1e-9): void => {
  assert.ok(actual !== null, 'expected a number, got null');
  assert.ok(
    Math.abs(actual - expected) < eps,
    `expected ${actual} to be within ${eps} of ${expected}`,
  );
};

describe('nearestIndexForX', () => {
  it('returns null for empty centers or a non-finite pointer', () => {
    assert.equal(nearestIndexForX(10, []), null);
    assert.equal(nearestIndexForX(Number.NaN, [0, 10]), null);
    assert.equal(nearestIndexForX(Number.POSITIVE_INFINITY, [0, 10]), null);
  });

  it('snaps to the nearest center', () => {
    const xs = [0, 10, 20, 30];
    assert.equal(nearestIndexForX(-100, xs), 0);
    assert.equal(nearestIndexForX(4.9, xs), 0);
    assert.equal(nearestIndexForX(5.1, xs), 1);
    assert.equal(nearestIndexForX(22, xs), 2);
    assert.equal(nearestIndexForX(1000, xs), 3);
  });

  it('breaks exact midpoint ties toward the earlier index (strict <)', () => {
    assert.equal(nearestIndexForX(5, [0, 10]), 0);
  });
});

describe('donutHitSegment', () => {
  // radius 50, stroke 10: the band is [50 - 11, 50 + 11] with the 6dp slop.
  const radius = 50;
  const stroke = 10;
  const amounts = [25, 25, 50] as const;

  it('returns null for non-finite pointers and zero/negative totals', () => {
    assert.equal(donutHitSegment(Number.NaN, 0, radius, stroke, amounts), null);
    assert.equal(donutHitSegment(0, Number.NaN, radius, stroke, amounts), null);
    assert.equal(donutHitSegment(0, -radius, radius, stroke, [0, 0]), null);
    assert.equal(donutHitSegment(0, -radius, radius, stroke, [-5, -1]), null);
  });

  it('returns null off the ring band (inside the hole, outside the rim)', () => {
    const band = stroke / 2 + DONUT_HIT_SLOP;
    assert.equal(donutHitSegment(0, 0, radius, stroke, amounts), null);
    assert.equal(
      donutHitSegment(0, -(radius - band - 1), radius, stroke, amounts),
      null,
    );
    assert.equal(
      donutHitSegment(0, -(radius + band + 1), radius, stroke, amounts),
      null,
    );
    // Just inside both edges of the band still hits.
    assert.equal(
      donutHitSegment(0, -(radius - band + 1), radius, stroke, amounts),
      0,
    );
    assert.equal(
      donutHitSegment(0, -(radius + band - 1), radius, stroke, amounts),
      0,
    );
  });

  it('attributes clockwise-from-12 turns to the owning fraction', () => {
    // 25/25/50: segment 0 owns [0, 90)deg, 1 owns [90, 180), 2 owns the rest.
    assert.equal(donutHitSegment(0, -radius, radius, stroke, amounts), 0);
    assert.equal(donutHitSegment(radius, 0, radius, stroke, amounts), 1);
    assert.equal(donutHitSegment(0, radius, radius, stroke, amounts), 2);
    assert.equal(donutHitSegment(-radius, 0, radius, stroke, amounts), 2);
  });

  it('clamps negative slices to zero and skips their span', () => {
    // [-10, 100]: segment 0 owns nothing, the full turn belongs to 1.
    assert.equal(donutHitSegment(0, -radius, radius, stroke, [-10, 100]), 1);
  });
});

describe('donutSegmentMidAngle', () => {
  const amounts = [25, 25, 50] as const;

  it('returns null for bad indexes and zero totals', () => {
    assert.equal(donutSegmentMidAngle(amounts, -1), null);
    assert.equal(donutSegmentMidAngle(amounts, 3), null);
    assert.equal(donutSegmentMidAngle(amounts, 0.5), null);
    assert.equal(donutSegmentMidAngle([0, 0], 0), null);
  });

  it('returns null for a zero-fraction segment (no anchor)', () => {
    assert.equal(donutSegmentMidAngle([0, 100], 0), null);
  });

  it('anchors at the clockwise mid-angle of the owned span', () => {
    // 25/25/50: spans are [0, .25), [.25, .5), [.5, 1) of a full turn.
    approx(donutSegmentMidAngle(amounts, 0), 0.125 * 2 * Math.PI);
    approx(donutSegmentMidAngle(amounts, 1), 0.375 * 2 * Math.PI);
    approx(donutSegmentMidAngle(amounts, 2), 0.75 * 2 * Math.PI);
  });
});
