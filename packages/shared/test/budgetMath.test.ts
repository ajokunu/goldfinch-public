/** Budget percent math (P7-8): the locked floor semantics, exhaustively. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BUDGET_ALERT_THRESHOLDS_PERCENT,
  BudgetMathError,
  percentUsed,
  reachedThresholds,
  remainingMinor,
} from '../src/budgetMath.js';

describe('percentUsed', () => {
  it('floors: a percent is reported only once fully reached', () => {
    assert.equal(percentUsed(0, 1000), 0);
    assert.equal(percentUsed(1, 1000), 0);
    assert.equal(percentUsed(9, 1000), 0);
    assert.equal(percentUsed(10, 1000), 1);
    assert.equal(percentUsed(799, 1000), 79); // 79.9% -> 79: an 80% alert can never fire early
    assert.equal(percentUsed(800, 1000), 80);
    assert.equal(percentUsed(999, 1000), 99);
    assert.equal(percentUsed(1000, 1000), 100);
  });

  it('exceeds 100 on over-spend (no cap)', () => {
    assert.equal(percentUsed(1500, 1000), 150);
    assert.equal(percentUsed(100_000, 1000), 10_000);
  });

  it('clamps negative spend (net refunds) to 0', () => {
    assert.equal(percentUsed(-500, 1000), 0);
  });

  it('is BigInt-exact at the top of the safe-integer range', () => {
    const limit = Number.MAX_SAFE_INTEGER; // 9007199254740991
    const spent = 4_503_599_627_370_496; // 2^52
    // floor(2^52 * 100 / (2^53 - 1)) computed exactly:
    assert.equal(
      percentUsed(spent, limit),
      Number((BigInt(spent) * 100n) / BigInt(limit)),
    );
    assert.equal(percentUsed(limit, limit), 100);
  });

  it('rejects non-positive or non-integer limits and non-integer spend', () => {
    assert.throws(() => percentUsed(100, 0), BudgetMathError);
    assert.throws(() => percentUsed(100, -1000), BudgetMathError);
    assert.throws(() => percentUsed(100, 10.5), BudgetMathError);
    assert.throws(() => percentUsed(10.5, 1000), BudgetMathError);
    assert.throws(() => percentUsed(Number.NaN, 1000), BudgetMathError);
  });
});

describe('remainingMinor', () => {
  it('returns limit - spent, negative once over budget', () => {
    assert.equal(remainingMinor(300, 1000), 700);
    assert.equal(remainingMinor(1000, 1000), 0);
    assert.equal(remainingMinor(1200, 1000), -200);
  });

  it('clamps negative spend to 0 (refunds cannot inflate the remainder)', () => {
    assert.equal(remainingMinor(-500, 1000), 1000);
  });

  it('rejects invalid inputs', () => {
    assert.throws(() => remainingMinor(100, 0), BudgetMathError);
    assert.throws(() => remainingMinor(0.5, 1000), BudgetMathError);
  });
});

describe('reachedThresholds', () => {
  it('defaults to the locked [80, 100] contract', () => {
    assert.deepEqual([...BUDGET_ALERT_THRESHOLDS_PERCENT], [80, 100]);
    assert.deepEqual(reachedThresholds(0, 1000), []);
    assert.deepEqual(reachedThresholds(799, 1000), []);
    assert.deepEqual(reachedThresholds(800, 1000), [80]);
    assert.deepEqual(reachedThresholds(999, 1000), [80]);
    assert.deepEqual(reachedThresholds(1000, 1000), [80, 100]);
    assert.deepEqual(reachedThresholds(2500, 1000), [80, 100]);
  });

  it('accepts custom thresholds and returns them ascending', () => {
    assert.deepEqual(reachedThresholds(500, 1000, [100, 25, 50]), [25, 50]);
  });

  it('does not mutate the caller threshold array', () => {
    const thresholds = [100, 80];
    reachedThresholds(1000, 1000, thresholds);
    assert.deepEqual(thresholds, [100, 80]);
  });

  it('rejects non-positive or non-integer thresholds', () => {
    assert.throws(() => reachedThresholds(500, 1000, [0]), BudgetMathError);
    assert.throws(() => reachedThresholds(500, 1000, [-10]), BudgetMathError);
    assert.throws(() => reachedThresholds(500, 1000, [79.5]), BudgetMathError);
  });
});

describe('mutation hardening (P7-10)', () => {
  it('BudgetMathError carries its name for structured logging', () => {
    try {
      percentUsed(100, 0);
      assert.fail('expected a throw');
    } catch (error) {
      assert.ok(error instanceof BudgetMathError);
      assert.equal(error.name, 'BudgetMathError');
    }
  });

  it('error messages name the offending argument and value exactly', () => {
    assert.throws(() => percentUsed(0.5, 1000), /spentMinor must be a safe integer, got 0\.5/);
    assert.throws(() => percentUsed(100, 0), /limitMinor must be a positive safe integer, got 0/);
    assert.throws(() => remainingMinor(0.5, 1000), /spentMinor must be a safe integer, got 0\.5/);
    assert.throws(() => remainingMinor(Number.NaN, 1000), /spentMinor must be a safe integer, got NaN/);
    assert.throws(() => remainingMinor(100, -5), /limitMinor must be a positive safe integer, got -5/);
    assert.throws(() => reachedThresholds(500, 1000, [0]), /thresholds must be positive integers, got 0/);
  });

  it('returns reached thresholds ascending regardless of caller order', () => {
    // Both orderings of the same set, plus a 3-element scramble: a dropped or
    // degenerate sort comparator cannot produce ascending output for all three.
    assert.deepEqual(reachedThresholds(500, 1000, [50, 25]), [25, 50]);
    assert.deepEqual(reachedThresholds(500, 1000, [25, 50]), [25, 50]);
    assert.deepEqual(reachedThresholds(990, 1000, [99, 1, 50]), [1, 50, 99]);
  });
});
