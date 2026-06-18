/** Goal projected-completion math (P7-2): linear pace, BigInt-exact. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_PROJECTION_DAYS,
  ProjectionError,
  addDaysToIsoDate,
  isValidIsoDate,
  paceStatus,
  parseTargetDateInput,
  projectCompletion,
  type GoalProjection,
} from '../lib/projection.js';

const TODAY = '2026-06-09';

function project(
  progressMinor: number,
  targetMinor: number,
  createdAt = '2026-01-01T00:00:00.000Z',
  today = TODAY,
): GoalProjection {
  return projectCompletion({ progressMinor, targetMinor, createdAt, today });
}

describe('projectCompletion', () => {
  it('reports achieved at and beyond the target', () => {
    assert.deepEqual(project(10_000, 10_000), { kind: 'achieved' });
    assert.deepEqual(project(15_000, 10_000), { kind: 'achieved' });
  });

  it('has no projection without positive progress', () => {
    assert.deepEqual(project(0, 10_000), { kind: 'none', reason: 'no-progress' });
    assert.deepEqual(project(-500, 10_000), { kind: 'none', reason: 'no-progress' });
  });

  it('extends the average daily pace linearly', () => {
    // Created 100 days before today; half saved -> 100 more days.
    const created = addDaysToIsoDate(TODAY, -100);
    const result = project(5_000, 10_000, `${created}T12:00:00.000Z`);
    assert.deepEqual(result, {
      kind: 'projected',
      date: addDaysToIsoDate(TODAY, 100),
      daysRemaining: 100,
    });
  });

  it('rounds the remaining days up (never projects early)', () => {
    // elapsed 10, progress 3000, remaining 7000:
    // ceil(7000 * 10 / 3000) = ceil(23.33) = 24.
    const created = addDaysToIsoDate(TODAY, -10);
    const result = project(3_000, 10_000, `${created}T00:00:00.000Z`);
    assert.deepEqual(result, {
      kind: 'projected',
      date: addDaysToIsoDate(TODAY, 24),
      daysRemaining: 24,
    });
  });

  it('is exact where float division would misround', () => {
    // ceil(1_000_000 * 997 / 1_000_003): true quotient is 996.99...,
    // so the exact answer is 997.
    const created = addDaysToIsoDate(TODAY, -997);
    const result = project(1_000_003, 2_000_003, `${created}T00:00:00.000Z`);
    assert.equal(result.kind, 'projected');
    assert.equal((result as { daysRemaining: number }).daysRemaining, 997);
  });

  it('clamps the elapsed window to one day (created today)', () => {
    // Same-day goal with progress: pace = progress per 1 day.
    const result = project(100, 1_000, `${TODAY}T08:00:00.000Z`);
    assert.deepEqual(result, {
      kind: 'projected',
      date: addDaysToIsoDate(TODAY, 9),
      daysRemaining: 9,
    });
  });

  it('clamps a future createdAt (device clock behind the server)', () => {
    const future = addDaysToIsoDate(TODAY, 3);
    const result = project(100, 1_000, `${future}T00:00:00.000Z`);
    assert.deepEqual(result, {
      kind: 'projected',
      date: addDaysToIsoDate(TODAY, 9),
      daysRemaining: 9,
    });
  });

  it('reports too-distant beyond MAX_PROJECTION_DAYS, inclusive boundary', () => {
    const created = addDaysToIsoDate(TODAY, -1);
    // progress 1, elapsed 1 -> daysRemaining == remaining.
    const atLimit = project(1, 1 + MAX_PROJECTION_DAYS, `${created}T00:00:00.000Z`);
    assert.equal(atLimit.kind, 'projected');
    assert.equal((atLimit as { daysRemaining: number }).daysRemaining, MAX_PROJECTION_DAYS);

    const overLimit = project(1, 2 + MAX_PROJECTION_DAYS, `${created}T00:00:00.000Z`);
    assert.deepEqual(overLimit, { kind: 'none', reason: 'too-distant' });
  });

  it('stays exact at safe-integer magnitudes (BigInt product)', () => {
    // remaining * elapsed overflows 2^53 as a float; BigInt keeps it exact.
    const created = addDaysToIsoDate(TODAY, -10_000);
    const progress = 2 ** 52;
    const target = 2 ** 52 + 2 ** 50;
    // ceil(2^50 * 10000 / 2^52) = ceil(2500) = 2500.
    const result = project(progress, target, `${created}T00:00:00.000Z`);
    assert.deepEqual(result, {
      kind: 'projected',
      date: addDaysToIsoDate(TODAY, 2_500),
      daysRemaining: 2_500,
    });
  });

  it('throws ProjectionError on malformed input', () => {
    assert.throws(() => project(0.5, 1_000), ProjectionError);
    assert.throws(() => project(Number.NaN, 1_000), ProjectionError);
    assert.throws(() => project(100, 0), ProjectionError);
    assert.throws(() => project(100, -1_000), ProjectionError);
    assert.throws(() => project(100, 1.5), ProjectionError);
    assert.throws(() => project(100, 1_000, 'not-a-timestamp'), ProjectionError);
    assert.throws(
      () => project(100, 1_000, '2026-01-01T00:00:00.000Z', '2026-13-01'),
      ProjectionError,
    );
  });
});

describe('paceStatus', () => {
  const projected = (date: string): GoalProjection => ({
    kind: 'projected',
    date,
    daysRemaining: 1,
  });

  it('is null without a deadline', () => {
    assert.equal(paceStatus(projected('2026-07-01'), undefined), null);
    assert.equal(paceStatus(projected('2026-07-01'), null), null);
    assert.equal(paceStatus({ kind: 'achieved' }, undefined), null);
  });

  it('achieved is always on track', () => {
    assert.equal(paceStatus({ kind: 'achieved' }, '2020-01-01'), 'on-track');
  });

  it('compares the projected date to the deadline, inclusive', () => {
    assert.equal(paceStatus(projected('2026-07-01'), '2026-07-01'), 'on-track');
    assert.equal(paceStatus(projected('2026-06-30'), '2026-07-01'), 'on-track');
    assert.equal(paceStatus(projected('2026-07-02'), '2026-07-01'), 'behind');
  });

  it('an unprojectable goal with a deadline is behind', () => {
    assert.equal(
      paceStatus({ kind: 'none', reason: 'no-progress' }, '2026-07-01'),
      'behind',
    );
    assert.equal(
      paceStatus({ kind: 'none', reason: 'too-distant' }, '2026-07-01'),
      'behind',
    );
  });
});

describe('addDaysToIsoDate', () => {
  it('crosses month, year, and leap boundaries', () => {
    assert.equal(addDaysToIsoDate('2026-12-31', 1), '2027-01-01');
    assert.equal(addDaysToIsoDate('2026-01-31', 1), '2026-02-01');
    assert.equal(addDaysToIsoDate('2024-02-28', 1), '2024-02-29'); // leap
    assert.equal(addDaysToIsoDate('2025-02-28', 1), '2025-03-01'); // non-leap
    assert.equal(addDaysToIsoDate('2026-06-09', 0), '2026-06-09');
    assert.equal(addDaysToIsoDate('2026-01-01', -1), '2025-12-31');
    assert.equal(addDaysToIsoDate('2026-06-09', 365), '2027-06-09');
  });

  it('throws on malformed input', () => {
    assert.throws(() => addDaysToIsoDate('2026-6-9', 1), ProjectionError);
    assert.throws(() => addDaysToIsoDate('2026-06-09', 1.5), ProjectionError);
    assert.throws(() => addDaysToIsoDate('2026-06-09', Number.NaN), ProjectionError);
  });
});

describe('isValidIsoDate', () => {
  it('accepts calendar-valid dates only', () => {
    assert.equal(isValidIsoDate('2026-06-09'), true);
    assert.equal(isValidIsoDate('2024-02-29'), true); // leap day
    assert.equal(isValidIsoDate('2025-02-29'), false);
    assert.equal(isValidIsoDate('2026-13-01'), false);
    assert.equal(isValidIsoDate('2026-00-10'), false);
    assert.equal(isValidIsoDate('2026-04-31'), false);
    assert.equal(isValidIsoDate('2026-6-9'), false);
    assert.equal(isValidIsoDate('06/09/2026'), false);
    assert.equal(isValidIsoDate(''), false);
  });
});

describe('parseTargetDateInput', () => {
  it('treats blank as "no deadline"', () => {
    assert.deepEqual(parseTargetDateInput(''), { ok: true, value: undefined });
    assert.deepEqual(parseTargetDateInput('   '), { ok: true, value: undefined });
  });

  it('accepts calendar-valid yyyy-mm-dd, trimmed', () => {
    assert.deepEqual(parseTargetDateInput(' 2026-09-01 '), {
      ok: true,
      value: '2026-09-01',
    });
  });

  it('rejects everything else', () => {
    assert.deepEqual(parseTargetDateInput('2026-2-1'), { ok: false });
    assert.deepEqual(parseTargetDateInput('2026-02-30'), { ok: false });
    assert.deepEqual(parseTargetDateInput('September 1'), { ok: false });
  });
});
