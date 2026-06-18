/** Budget percent math (P7-8): the locked floor semantics, exhaustively. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BUDGET_ALERT_THRESHOLDS_PERCENT,
  BudgetMathError,
  inclusiveDayCount,
  percentUsed,
  prorateRangeTargetMinor,
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

describe('inclusiveDayCount', () => {
  it('from == to is exactly 1 day', () => {
    assert.equal(inclusiveDayCount('2026-06-15', '2026-06-15'), 1);
  });

  it('counts whole inclusive days', () => {
    assert.equal(inclusiveDayCount('2026-06-01', '2026-06-30'), 30); // June
    assert.equal(inclusiveDayCount('2026-01-01', '2026-12-31'), 365); // common year
    assert.equal(inclusiveDayCount('2024-01-01', '2024-12-31'), 366); // leap year
    assert.equal(inclusiveDayCount('2024-02-01', '2024-02-29'), 29); // leap February
  });

  it('is DST-agnostic across both 2026 seams (civil-day, not wall-clock seconds)', () => {
    assert.equal(inclusiveDayCount('2026-03-02', '2026-03-08'), 7); // spring-forward week
    assert.equal(inclusiveDayCount('2026-10-26', '2026-11-01'), 7); // fall-back week
  });

  it('rejects from > to and malformed dates', () => {
    assert.throws(() => inclusiveDayCount('2026-06-16', '2026-06-15'), BudgetMathError);
    assert.throws(() => inclusiveDayCount('2026-6-1', '2026-06-15'), BudgetMathError);
    assert.throws(() => inclusiveDayCount('2026-02-30', '2026-03-01'), BudgetMathError);
  });
});

describe('prorateRangeTargetMinor — monthly cadence (per-month floor)', () => {
  it('a whole single month equals the stored limit exactly (D_m == N_m)', () => {
    // June has 30 days; the full month gives floor(L * 30 / 30) == L for any L.
    assert.equal(prorateRangeTargetMinor(45000, 'monthly', '2026-06-01', '2026-06-30'), 45000);
    // 31-day month.
    assert.equal(prorateRangeTargetMinor(12345, 'monthly', '2026-07-01', '2026-07-31'), 12345);
    // Common-year February (28).
    assert.equal(prorateRangeTargetMinor(28000, 'monthly', '2026-02-01', '2026-02-28'), 28000);
    // Leap-year February (29) — denominator must be 29, still == L.
    assert.equal(prorateRangeTargetMinor(29000, 'monthly', '2024-02-01', '2024-02-29'), 29000);
  });

  it('a partial month prorates with a BigInt per-term floor', () => {
    // 14 inclusive days of June (30): floor(45000 * 14 / 30) = floor(21000) = 21000.
    assert.equal(prorateRangeTargetMinor(45000, 'monthly', '2026-06-01', '2026-06-14'), 21000);
    // A floor that actually truncates: floor(10000 * 1 / 30) = floor(333.33) = 333.
    assert.equal(prorateRangeTargetMinor(10000, 'monthly', '2026-06-15', '2026-06-15'), 333);
    // Leap-Feb partial: floor(29000 * 10 / 29) = floor(10000) = 10000.
    assert.equal(prorateRangeTargetMinor(29000, 'monthly', '2024-02-01', '2024-02-10'), 10000);
  });

  it('a multi-month range equals the SUM of per-month floors (not a whole-range floor)', () => {
    // June 15..July 15 for L=10000:
    //   June  16 days / 30 -> floor(10000*16/30) = floor(5333.33) = 5333
    //   July  15 days / 31 -> floor(10000*15/31) = floor(4838.70) = 4838
    //   sum = 10171
    const june = Math.floor((10000 * 16) / 30);
    const july = Math.floor((10000 * 15) / 31);
    assert.equal(june, 5333);
    assert.equal(july, 4838);
    assert.equal(
      prorateRangeTargetMinor(10000, 'monthly', '2026-06-15', '2026-07-15'),
      june + july,
    );
    assert.equal(prorateRangeTargetMinor(10000, 'monthly', '2026-06-15', '2026-07-15'), 10171);
  });

  it('two whole consecutive months equal 2 * L (each term is exact)', () => {
    assert.equal(prorateRangeTargetMinor(45000, 'monthly', '2026-06-01', '2026-07-31'), 90000);
  });

  it('a multi-month range crossing a year boundary sums per-month floors', () => {
    // Dec 2026 (31) whole + Jan 2027 (31) whole = 2 * L.
    assert.equal(prorateRangeTargetMinor(50000, 'monthly', '2026-12-01', '2027-01-31'), 100000);
  });
});

describe('prorateRangeTargetMinor — weekly cadence (single floor over whole range)', () => {
  it('a 7-day range equals the stored weekly limit (floor(L * 7 / 7) == L)', () => {
    assert.equal(prorateRangeTargetMinor(45000, 'weekly', '2026-06-08', '2026-06-14'), 45000);
  });

  it('from == to is one day: floor(L / 7)', () => {
    assert.equal(prorateRangeTargetMinor(45000, 'weekly', '2026-06-15', '2026-06-15'), 6428);
    assert.equal(Math.floor(45000 / 7), 6428);
  });

  it('prorates by overlap/7 over an arbitrary span', () => {
    // 10 inclusive days: floor(45000 * 10 / 7) = floor(64285.71) = 64285.
    assert.equal(prorateRangeTargetMinor(45000, 'weekly', '2026-06-08', '2026-06-17'), 64285);
  });

  it('is a SINGLE floor over the WHOLE range, NOT month-bucketed', () => {
    // June 20 .. July 10 = 21 inclusive days spanning two months.
    // Correct weekly proration: floor(45000 * 21 / 7) = 135000 (one floor).
    // A month-bucketed regression would do floor(45000*11/7)+floor(45000*10/7)
    //   = floor(70714.28) + floor(64285.71) = 70714 + 64285 = 134999 (off by 1).
    const days = inclusiveDayCount('2026-06-20', '2026-07-10');
    assert.equal(days, 21);
    const singleFloor = Math.floor((45000 * 21) / 7); // 135000
    const monthBucketed = Math.floor((45000 * 11) / 7) + Math.floor((45000 * 10) / 7); // 134999
    assert.equal(singleFloor, 135000);
    assert.equal(monthBucketed, 134999);
    assert.notEqual(singleFloor, monthBucketed);
    assert.equal(
      prorateRangeTargetMinor(45000, 'weekly', '2026-06-20', '2026-07-10'),
      singleFloor,
    );
  });
});

describe('prorateRangeTargetMinor — yearly cadence (per-year floor)', () => {
  it('a whole common year equals the stored limit (/365)', () => {
    assert.equal(prorateRangeTargetMinor(365000, 'yearly', '2026-01-01', '2026-12-31'), 365000);
  });

  it('a whole leap year equals the stored limit (/366)', () => {
    assert.equal(prorateRangeTargetMinor(366000, 'yearly', '2024-01-01', '2024-12-31'), 366000);
  });

  it('prorates a partial common year by overlap/365', () => {
    // 31 inclusive January days: floor(365000 * 31 / 365) = floor(31000) = 31000.
    assert.equal(prorateRangeTargetMinor(365000, 'yearly', '2026-01-01', '2026-01-31'), 31000);
  });

  it('prorates a partial leap year by overlap/366', () => {
    // 31 inclusive January days of 2024: floor(366000 * 31 / 366) = 31000.
    assert.equal(prorateRangeTargetMinor(366000, 'yearly', '2024-01-01', '2024-01-31'), 31000);
  });

  it('a multi-year range sums per-year floors with the right denominator each year', () => {
    // 2024 (leap, 366) whole + 2025 (common, 365) Jan 1..Jan 31 (31 days):
    //   2024: floor(366000 * 366 / 366) = 366000
    //   2025: floor(366000 * 31 / 365)  = floor(31084.93) = 31084
    const y2024 = 366000;
    const y2025 = Math.floor((366000 * 31) / 365);
    assert.equal(y2025, 31084);
    assert.equal(
      prorateRangeTargetMinor(366000, 'yearly', '2024-01-01', '2025-01-31'),
      y2024 + y2025,
    );
  });
});

describe('prorateRangeTargetMinor — integer-exactness and validation', () => {
  it('is integer-exact at large minor-unit magnitudes (BigInt, no float)', () => {
    const L = 9_000_000_000; // $90,000,000.00
    const expected = Number((BigInt(L) * 14n) / 30n);
    assert.equal(prorateRangeTargetMinor(L, 'monthly', '2026-06-01', '2026-06-14'), expected);
  });

  it('from == to (1 day) prorates the single touched period', () => {
    // Monthly single day in a 30-day month: floor(L * 1 / 30).
    assert.equal(prorateRangeTargetMinor(45000, 'monthly', '2026-06-10', '2026-06-10'), 1500);
    assert.equal(Math.floor(45000 / 30), 1500);
  });

  it('rejects a non-positive or non-integer limit', () => {
    assert.throws(() => prorateRangeTargetMinor(0, 'monthly', '2026-06-01', '2026-06-30'), BudgetMathError);
    assert.throws(() => prorateRangeTargetMinor(-100, 'monthly', '2026-06-01', '2026-06-30'), BudgetMathError);
    assert.throws(() => prorateRangeTargetMinor(10.5, 'monthly', '2026-06-01', '2026-06-30'), BudgetMathError);
  });

  it('rejects an unknown period and from > to', () => {
    assert.throws(
      () => prorateRangeTargetMinor(45000, 'daily' as never, '2026-06-01', '2026-06-30'),
      BudgetMathError,
    );
    assert.throws(
      () => prorateRangeTargetMinor(45000, 'monthly', '2026-06-30', '2026-06-01'),
      BudgetMathError,
    );
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
