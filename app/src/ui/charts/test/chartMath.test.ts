/**
 * Geometry unit tests (charts.md section 12): exact path strings, dash
 * arrays, and offsets at fixed inputs, including the degenerate cases
 * (empty data, single point, zero totals, negative values). These are the
 * StrykerJS kill set for chartMath.ts.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CURVE_LENGTH_FACTOR,
  createLinearScale,
  donutSegments,
  linePath,
  niceTicks,
  polylineLength,
  ringDashOffset,
  sampledLabelIndexes,
  smoothPath,
  type ChartPoint,
} from '../chartMath';

const approx = (actual: number, expected: number, eps = 1e-9): void => {
  assert.ok(
    Math.abs(actual - expected) < eps,
    `expected ${actual} to be within ${eps} of ${expected}`,
  );
};

/** `===` zero check: the accumulator's first offset is -0, which SVG treats
 *  as 0 but Object.is (assert/strict equal) does not. */
const isZero = (value: number | undefined): void => {
  assert.ok(value === 0, `expected ${value} to === 0`);
};

describe('smoothPath', () => {
  it('returns an empty string for fewer than 2 points', () => {
    assert.equal(smoothPath([]), '');
    assert.equal(smoothPath([{ x: 5, y: 5 }]), '');
  });

  it('clamps neighbor lookups at the ends (two points, default smooth)', () => {
    // p0 = p1 at the start, p3 = p2 at the end:
    // c1x = 0 + ((10 - 0) / 6) * 0.6 = 1; c2x = 10 - 1 = 9.
    assert.equal(
      smoothPath([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
      'M 0.00 0.00 C 1.00 0.00 9.00 0.00 10.00 0.00',
    );
  });

  it('uses prior/next neighbors for interior segments', () => {
    const pts: ChartPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    assert.equal(
      smoothPath(pts, 0.6),
      'M 0.00 0.00 C 1.00 1.00 8.00 10.00 10.00 10.00' +
        ' C 12.00 10.00 19.00 1.00 20.00 0.00',
    );
  });

  it('defaults smooth to 0.6', () => {
    const pts: ChartPoint[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ];
    assert.equal(smoothPath(pts), smoothPath(pts, 0.6));
    assert.notEqual(smoothPath(pts), smoothPath(pts, 0.3));
  });

  it('smooth 0 degenerates control points onto the endpoints', () => {
    assert.equal(
      smoothPath(
        [
          { x: 0, y: 0 },
          { x: 10, y: 4 },
        ],
        0,
      ),
      'M 0.00 0.00 C 0.00 0.00 10.00 4.00 10.00 4.00',
    );
  });

  it('emits coordinates with two decimals', () => {
    assert.equal(
      smoothPath(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        1,
      ),
      'M 0.00 0.00 C 0.17 0.17 0.83 0.83 1.00 1.00',
    );
  });

  it('keeps the full c1 = p1 + (p2 - p0) form away from the origin', () => {
    // Non-zero p0 distinguishes (p2 - p0) from (p2 + p0) in every segment.
    assert.equal(
      smoothPath(
        [
          { x: 2, y: 3 },
          { x: 10, y: 7 },
          { x: 20, y: 11 },
        ],
        0.6,
      ),
      'M 2.00 3.00 C 2.80 3.40 8.20 6.20 10.00 7.00' +
        ' C 11.80 7.80 19.00 10.60 20.00 11.00',
    );
  });
});

describe('linePath', () => {
  it('returns an empty string for fewer than 2 points', () => {
    assert.equal(linePath([]), '');
    assert.equal(linePath([{ x: 1, y: 2 }]), '');
  });

  it('draws exactly two points (the boundary case)', () => {
    assert.equal(
      linePath([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ]),
      'M 1.00 2.00 L 3.00 4.00',
    );
  });

  it('emits M then L commands with two decimals', () => {
    assert.equal(
      linePath([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: 20, y: 2.5 },
      ]),
      'M 0.00 0.00 L 10.00 5.00 L 20.00 2.50',
    );
  });
});

describe('polylineLength', () => {
  it('is 0 for fewer than 2 points', () => {
    assert.equal(polylineLength([]), 0);
    assert.equal(polylineLength([{ x: 3, y: 4 }]), 0);
  });

  it('sums consecutive Euclidean distances', () => {
    assert.equal(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ]),
      5,
    );
    assert.equal(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 3, y: 12 },
      ]),
      13,
    );
  });

  it('exposes the documented curve-length safety factor', () => {
    assert.equal(CURVE_LENGTH_FACTOR, 1.08);
  });
});

describe('donutSegments', () => {
  it('maps fractions to dash lengths and accumulated offsets (no gap)', () => {
    const segs = donutSegments([50, 30, 20], 100, 0);
    assert.equal(segs.length, 3);
    assert.deepEqual(segs[0]?.dash, [50, 100]);
    assert.deepEqual(segs[1]?.dash, [30, 100]);
    assert.deepEqual(segs[2]?.dash, [20, 100]);
    // First offset is -0 by construction; === comparison is intentional.
    isZero(segs[0]?.offset);
    assert.strictEqual(segs[1]?.offset, -50);
    assert.strictEqual(segs[2]?.offset, -80);
  });

  it('subtracts the gap from visible lengths but not from offsets', () => {
    const segs = donutSegments([50, 30, 20], 100, 36); // gap = 10
    assert.deepEqual(segs[0]?.dash, [40, 100]);
    assert.deepEqual(segs[1]?.dash, [20, 100]);
    assert.deepEqual(segs[2]?.dash, [10, 100]);
    isZero(segs[0]?.offset);
    assert.strictEqual(segs[1]?.offset, -50);
    assert.strictEqual(segs[2]?.offset, -80);
  });

  it('keeps a 0.5 minimum visible sliver', () => {
    const segs = donutSegments([1, 99], 100, 36);
    assert.deepEqual(segs[0]?.dash, [0.5, 100]);
    assert.deepEqual(segs[1]?.dash, [89, 100]);
  });

  it('never divides by zero on an all-zero total', () => {
    const segs = donutSegments([0, 0], 100, 0);
    assert.equal(segs.length, 2);
    assert.deepEqual(segs[0]?.dash, [0.5, 100]);
    assert.deepEqual(segs[1]?.dash, [0.5, 100]);
    isZero(segs[0]?.offset);
    isZero(segs[1]?.offset);
  });

  it('treats negative amounts as zero-fraction segments', () => {
    const segs = donutSegments([-5, 10], 100, 0);
    assert.deepEqual(segs[0]?.dash, [0.5, 100]);
    assert.deepEqual(segs[1]?.dash, [100, 100]);
    isZero(segs[1]?.offset);
  });

  it('accumulates fractions of the circumference, not raw amounts', () => {
    const segs = donutSegments([25, 75], 200, 0);
    assert.deepEqual(segs[0]?.dash, [50, 200]);
    assert.deepEqual(segs[1]?.dash, [150, 200]);
    assert.strictEqual(segs[1]?.offset, -50);
  });
});

describe('ringDashOffset', () => {
  it('maps the fraction onto the remaining circumference', () => {
    assert.equal(ringDashOffset(0, 100), 100);
    assert.equal(ringDashOffset(0.25, 100), 75);
    assert.equal(ringDashOffset(1, 100), 0);
    assert.equal(ringDashOffset(0.5, 80), 40);
  });

  it('clamps fractions to [0, 1]', () => {
    assert.equal(ringDashOffset(-0.5, 100), 100);
    assert.equal(ringDashOffset(2, 100), 0);
  });
});

describe('createLinearScale (existing helper)', () => {
  it('maps the domain linearly onto the range', () => {
    const scale = createLinearScale(0, 10, 100, 0);
    assert.equal(scale(0), 100);
    assert.equal(scale(5), 50);
    assert.equal(scale(10), 0);
  });

  it('returns the range midpoint for a degenerate domain', () => {
    const scale = createLinearScale(5, 5, 0, 100);
    assert.equal(scale(5), 50);
    assert.equal(scale(999), 50);
  });

  it('offsets by the domain minimum', () => {
    const scale = createLinearScale(10, 20, 0, 100);
    assert.equal(scale(10), 0);
    assert.equal(scale(15), 50);
    assert.equal(scale(20), 100);
  });
});

describe('niceTicks (existing helper)', () => {
  it('produces rounded ticks spanning the domain', () => {
    assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  });

  it('includes a clean zero across sign changes', () => {
    assert.deepEqual(niceTicks(-50, 120, 4), [-50, 0, 50, 100, 150]);
  });

  it('widens a flat series so an axis still exists', () => {
    const ticks = niceTicks(5, 5);
    assert.equal(ticks.length, 7);
    approx(ticks[0] ?? NaN, 4.4);
    approx(ticks[6] ?? NaN, 5.6);
  });

  it('returns [] for non-finite bounds', () => {
    assert.deepEqual(niceTicks(Number.NaN, 5), []);
    assert.deepEqual(niceTicks(0, Number.POSITIVE_INFINITY), []);
  });

  it('pads a flat-at-zero series by 1 (not by |0| * 0.1)', () => {
    assert.deepEqual(niceTicks(0, 0), [-1, -0.5, 0, 0.5, 1]);
  });

  it('uses the non-rounding nice number for the range (Heckbert)', () => {
    // range 1.2 -> 2 with floor semantics; the rounding variant would give 1.
    assert.deepEqual(niceTicks(0, 1.2, 5), [0, 0.5, 1, 1.5]);
  });

  it('divides the range by maxTicks - 1 slots', () => {
    assert.deepEqual(niceTicks(0, 100, 3), [0, 50, 100]);
  });

  it('hits each nice-fraction boundary deterministically', () => {
    // niceNum(18, false): frac 1.8 -> 2; step niceNum(5, true): frac 5 -> 5.
    assert.deepEqual(niceTicks(0, 18, 5), [0, 5, 10, 15, 20]);
    // niceNum(20, false): frac exactly 2 stays 2 (boundary of <= 2).
    assert.deepEqual(niceTicks(0, 20, 5), [0, 5, 10, 15, 20]);
    // niceNum(55, false): frac 5.5 -> 10 (the > 5 branch).
    assert.deepEqual(niceTicks(0, 55, 5), [0, 20, 40, 60]);
    // niceNum(450, false): frac 4.5 -> 5 (the <= 5 branch).
    assert.deepEqual(niceTicks(0, 450, 5), [0, 100, 200, 300, 400, 500]);
    // step niceNum(8.33, true): frac >= 7 -> 10.
    assert.deepEqual(
      niceTicks(0, 100, 13),
      [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    );
  });
});

describe('sampledLabelIndexes (existing helper)', () => {
  it('labels everything when under the cap', () => {
    assert.deepEqual([...sampledLabelIndexes(4, 6)].sort((a, b) => a - b), [
      0, 1, 2, 3,
    ]);
  });

  it('samples large counts but always includes first and last', () => {
    const indexes = sampledLabelIndexes(13, 6);
    assert.ok(indexes.has(0));
    assert.ok(indexes.has(12));
    assert.deepEqual(
      [...indexes].sort((a, b) => a - b),
      [0, 3, 6, 9, 12],
    );
  });

  it('is empty for zero items', () => {
    assert.equal(sampledLabelIndexes(0).size, 0);
  });

  it('labels the single index of a one-item axis', () => {
    assert.deepEqual([...sampledLabelIndexes(1, 6)], [0]);
  });

  it('uses count - 1 in the step so the tail is not over-sampled', () => {
    assert.deepEqual(
      [...sampledLabelIndexes(11, 6)].sort((a, b) => a - b),
      [0, 2, 4, 6, 8, 10],
    );
  });

  it('never emits an out-of-range index when the step lands on count', () => {
    assert.deepEqual(
      [...sampledLabelIndexes(12, 6)].sort((a, b) => a - b),
      [0, 3, 6, 9, 11],
    );
  });
});
