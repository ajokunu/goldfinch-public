/**
 * delightMath unit tests (PHASE9-DECISIONS P9-3: pure delight kinematics --
 * burst particles, pulse envelope, checkmark geometry).
 *
 * Expected values are hand-computed LITERALS (never recomputed with the
 * helpers under test), matching the motionMath/countUpMath suites.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  burstAlpha,
  burstEase,
  burstOffsetX,
  burstOffsetY,
  burstParticles,
  burstScale,
  BURST_GRAVITY,
  checkmarkGeometry,
  mulberry32,
  PULSE_PEAK_OPACITY,
  pulseInMs,
  pulseOutMs,
  seedFromKey,
  type BurstParticle,
} from '../motion/delightMath';

function assertClose(actual: number, expected: number, eps = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${actual} to be within ${eps} of ${expected}`,
  );
}

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    assert.equal(a(), b());
    assert.equal(a(), b());
    assert.equal(a(), b());
  });

  it('yields values in [0, 1) and differs across seeds', () => {
    const random = mulberry32(7);
    for (let i = 0; i < 100; i += 1) {
      const value = random();
      assert.ok(value >= 0 && value < 1);
    }
    assert.notEqual(mulberry32(1)(), mulberry32(2)());
  });
});

describe('seedFromKey', () => {
  it('passes finite numbers through as unsigned integers', () => {
    assert.equal(seedFromKey(1718000000000), 1718000000000 >>> 0);
    assert.equal(seedFromKey(-12), 12);
    assert.equal(seedFromKey(3.9), 3);
  });

  it('hashes strings deterministically and distinctly', () => {
    assert.equal(seedFromKey('goal-1'), seedFromKey('goal-1'));
    assert.notEqual(seedFromKey('goal-1'), seedFromKey('goal-2'));
    assert.ok(seedFromKey('goal-1') >= 0);
  });
});

describe('burstParticles', () => {
  it('builds exactly count particles, cycling the palette in order', () => {
    const particles = burstParticles(5, 2, 9);
    assert.equal(particles.length, 5);
    assert.deepEqual(
      particles.map((p) => p.colorIndex),
      [0, 1, 0, 1, 0],
    );
  });

  it('keeps every launch parameter inside its documented band', () => {
    const count = 18;
    const slice = (Math.PI * 2) / count;
    const particles = burstParticles(count, 6, 1234);
    particles.forEach((particle, index) => {
      assert.ok(particle.velocity >= 0.45 && particle.velocity <= 1);
      assert.ok(particle.size >= 0.02 && particle.size <= 0.045);
      // Angle jitter never leaves the particle's own slice of the circle.
      assert.ok(Math.abs(particle.angle - slice * index) <= slice / 2);
    });
  });

  it('is deterministic per seed and clamps junk inputs', () => {
    assert.deepEqual(burstParticles(4, 3, 77), burstParticles(4, 3, 77));
    assert.deepEqual(burstParticles(0, 3, 1), []);
    assert.deepEqual(burstParticles(Number.NaN, 3, 1), []);
    // Junk palette size degrades to a single color, never NaN indexes.
    const particles = burstParticles(3, 0, 5);
    assert.deepEqual(
      particles.map((p) => p.colorIndex),
      [0, 0, 0],
    );
  });
});

describe('burstEase', () => {
  it('matches 1 - (1 - t)^3 at literal points and clamps junk', () => {
    assert.equal(burstEase(0), 0);
    assert.equal(burstEase(1), 1);
    assertClose(burstEase(0.5), 0.875);
    assert.equal(burstEase(-1), 0);
    assert.equal(burstEase(2), 1);
  });
});

describe('burst offsets', () => {
  const right: BurstParticle = { angle: 0, velocity: 1, size: 0.03, colorIndex: 0 };
  const down: BurstParticle = {
    angle: Math.PI / 2,
    velocity: 1,
    size: 0.03,
    colorIndex: 0,
  };

  it('start at the origin (t = 0)', () => {
    assert.equal(burstOffsetX(right, 0), 0);
    assert.equal(burstOffsetY(right, 0), 0);
  });

  it('reach radial travel plus gravity at t = 1', () => {
    assertClose(burstOffsetX(right, 1), 1);
    assertClose(burstOffsetY(right, 1), BURST_GRAVITY);
    assertClose(burstOffsetX(down, 1), 0, 1e-12);
    assertClose(burstOffsetY(down, 1), 1 + BURST_GRAVITY);
  });

  it('gravity grows quadratically (literal midpoint)', () => {
    // t=0.5: sin(0)*v*ease + 0.55 * 0.25 = 0.1375 for the rightward particle.
    assertClose(burstOffsetY(right, 0.5), 0.1375);
  });
});

describe('burstAlpha', () => {
  it('holds full opacity through 55%, then fades linearly to 0', () => {
    assert.equal(burstAlpha(0), 1);
    assert.equal(burstAlpha(0.55), 1);
    assertClose(burstAlpha(0.775), 0.5);
    assert.equal(burstAlpha(1), 0);
    assert.equal(burstAlpha(2), 0);
    assert.equal(burstAlpha(-1), 1);
  });
});

describe('burstScale', () => {
  it('pops in over the first 12% and decays to 0.35', () => {
    assert.equal(burstScale(0), 0);
    assertClose(burstScale(0.06), 0.5);
    assert.equal(burstScale(0.12), 1);
    assertClose(burstScale(0.56), 0.675);
    assertClose(burstScale(1), 0.35);
  });
});

describe('pulse envelope', () => {
  it('peak opacity stays restrained', () => {
    assert.ok(PULSE_PEAK_OPACITY <= 0.3);
    assert.ok(PULSE_PEAK_OPACITY > 0);
  });

  it('splits 30/70 and the legs always sum to the rounded total', () => {
    assert.equal(pulseInMs(700), 210);
    assert.equal(pulseOutMs(700), 490);
    assert.equal(pulseInMs(333), 100);
    assert.equal(pulseOutMs(333), 233);
  });

  it('junk totals read as 0', () => {
    assert.equal(pulseInMs(0), 0);
    assert.equal(pulseOutMs(-100), 0);
    assert.equal(pulseInMs(Number.NaN), 0);
    assert.equal(pulseOutMs(Number.NaN), 0);
  });
});

describe('checkmarkGeometry', () => {
  it('emits the literal two-segment path for a 100-box', () => {
    const geometry = checkmarkGeometry(100);
    assert.equal(geometry.d, 'M 20 55 L 42 75 L 80 30');
    // hypot(22,20) + hypot(38,45) = 29.7321... + 58.8982... = 88.6303...
    assertClose(geometry.length, 88.6303, 0.001);
  });

  it('scales linearly with the box edge', () => {
    const small = checkmarkGeometry(50);
    const large = checkmarkGeometry(100);
    assertClose(small.length * 2, large.length);
  });

  it('degrades junk sizes to a zero-length point path', () => {
    const geometry = checkmarkGeometry(Number.NaN);
    assert.equal(geometry.d, 'M 0 0 L 0 0 L 0 0');
    assert.equal(geometry.length, 0);
  });
});
