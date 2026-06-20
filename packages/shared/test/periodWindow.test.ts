/**
 * periodWindow (P11-2) — current weekly/monthly/yearly window in DEFAULT_TZ
 * (America/New_York). Covers every period's boundaries, the ISO Monday..Sunday
 * week, month and year rollover, leap February, both 2026 DST transitions
 * (2026-03-08 spring-forward and 2026-11-01 fall-back are Sundays — each the
 * last day of its Mon..Sun week), and the exact from/to strings. Pure: never
 * throws on valid input.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_TZ } from '../src/constants.js';
import { DateError } from '../src/dates.js';
import { computeGsi2Keys } from '../src/keys.js';
import { periodWindow, stepWeek } from '../src/periodWindow.js';
import type { IsoDate } from '../src/types/common.js';
import { isBudgetPeriod, BUDGET_PERIODS } from '../src/types/api.js';

/** True when `date` (yyyy-mm-dd) is within an inclusive period window. */
function withinWindow(date: IsoDate, window: { from: IsoDate; to: IsoDate }): boolean {
  return date >= window.from && date <= window.to;
}

/** A Date at a UTC wall-clock instant (the same anchor dates.test.ts uses). */
function utc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

describe('periodWindow — weekly (ISO Monday..Sunday)', () => {
  it('a midweek day yields its Monday..Sunday week', () => {
    // 2026-06-10 12:00 EDT is a Wednesday.
    assert.deepEqual(periodWindow('weekly', utc(2026, 6, 10, 16, 0, 0)), {
      from: '2026-06-08',
      to: '2026-06-14',
    });
  });

  it('a Monday is the first day of its own week', () => {
    // 2026-06-08 12:00 EDT is a Monday.
    assert.deepEqual(periodWindow('weekly', utc(2026, 6, 8, 16, 0, 0)), {
      from: '2026-06-08',
      to: '2026-06-14',
    });
  });

  it('a Sunday is the last day of its own week', () => {
    // 2026-06-14 12:00 EDT is a Sunday; it rolls back to the prior Monday.
    assert.deepEqual(periodWindow('weekly', utc(2026, 6, 14, 16, 0, 0)), {
      from: '2026-06-08',
      to: '2026-06-14',
    });
  });

  it('a week may span a month boundary', () => {
    // 2026-07-01 is a Wednesday; its week runs Mon 2026-06-29 .. Sun 2026-07-05.
    assert.deepEqual(periodWindow('weekly', utc(2026, 7, 1, 16, 0, 0)), {
      from: '2026-06-29',
      to: '2026-07-05',
    });
  });

  it('a week may span a year boundary', () => {
    // 2025-12-31 23:30 EST is a Wednesday (ET day 2025-12-31); week runs
    // Mon 2025-12-29 .. Sun 2026-01-04.
    assert.deepEqual(periodWindow('weekly', utc(2026, 1, 1, 4, 30, 0)), {
      from: '2025-12-29',
      to: '2026-01-04',
    });
  });

  it('handles the spring-forward Sunday (2026-03-08, EST -> EDT)', () => {
    // 2026-03-08 is a Sunday and the spring DST date; under Mon..Sun it is the
    // LAST day of its week (Mon 2026-03-02 .. Sun 2026-03-08). Whole-day
    // arithmetic must not lose or gain a day across the 23-hour civil day.
    assert.deepEqual(periodWindow('weekly', utc(2026, 3, 8, 16, 0, 0)), {
      from: '2026-03-02',
      to: '2026-03-08',
    });
    // The following Wednesday (already EDT) lands in the NEXT week.
    assert.deepEqual(periodWindow('weekly', utc(2026, 3, 11, 16, 0, 0)), {
      from: '2026-03-09',
      to: '2026-03-15',
    });
    // The Saturday just BEFORE the seam shares the spring-seam week.
    assert.deepEqual(periodWindow('weekly', utc(2026, 3, 7, 16, 0, 0)), {
      from: '2026-03-02',
      to: '2026-03-08',
    });
  });

  it('handles the fall-back Sunday (2026-11-01, EDT -> EST)', () => {
    // 2026-11-01 is a Sunday and the fall DST date (25-hour civil day); under
    // Mon..Sun it is the LAST day of its week (Mon 2026-10-26 .. Sun 2026-11-01).
    assert.deepEqual(periodWindow('weekly', utc(2026, 11, 1, 16, 0, 0)), {
      from: '2026-10-26',
      to: '2026-11-01',
    });
    // The following Wednesday (already EST) is in the NEXT week.
    assert.deepEqual(periodWindow('weekly', utc(2026, 11, 4, 17, 0, 0)), {
      from: '2026-11-02',
      to: '2026-11-08',
    });
    // The Saturday just BEFORE the seam shares the fall-seam week.
    assert.deepEqual(periodWindow('weekly', utc(2026, 10, 31, 16, 0, 0)), {
      from: '2026-10-26',
      to: '2026-11-01',
    });
  });

  it('attributes a near-midnight ET instant to its ET day, not the UTC day', () => {
    // 2026-06-14T02:00:00Z is 2026-06-13 22:00 EDT — Saturday in ET, so the
    // week is the one ending Sun 2026-06-14.
    assert.deepEqual(periodWindow('weekly', utc(2026, 6, 14, 2, 0, 0)), {
      from: '2026-06-08',
      to: '2026-06-14',
    });
  });

  it('rolls a near-midnight ET Sunday back to the prior Monday', () => {
    // 2026-06-15T02:30:00Z is 2026-06-14 22:30 EDT — still Sunday in ET, the
    // last day of the week that began Mon 2026-06-08 (not the next week).
    assert.deepEqual(periodWindow('weekly', utc(2026, 6, 15, 2, 30, 0)), {
      from: '2026-06-08',
      to: '2026-06-14',
    });
  });
});

describe('periodWindow — monthly (calendar month)', () => {
  it('returns day 1 .. last day of a 30-day month', () => {
    assert.deepEqual(periodWindow('monthly', utc(2026, 6, 10, 16, 0, 0)), {
      from: '2026-06-01',
      to: '2026-06-30',
    });
  });

  it('returns day 1 .. 31 for a 31-day month', () => {
    assert.deepEqual(periodWindow('monthly', utc(2026, 7, 15, 16, 0, 0)), {
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });

  it('returns Feb 1 .. Feb 28 in a common year', () => {
    assert.deepEqual(periodWindow('monthly', utc(2026, 2, 15, 17, 0, 0)), {
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('returns Feb 1 .. Feb 29 in a leap year', () => {
    // 2024-02-29 12:00 EST is a leap day.
    assert.deepEqual(periodWindow('monthly', utc(2024, 2, 29, 17, 0, 0)), {
      from: '2024-02-01',
      to: '2024-02-29',
    });
  });

  it('is stable on the first instant of a month in ET', () => {
    // 2026-08-01 00:30 EDT.
    assert.deepEqual(periodWindow('monthly', utc(2026, 8, 1, 4, 30, 0)), {
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('is stable on the last instant of a month in ET (December rollover edge)', () => {
    // 2026-12-31 23:30 EST is still December in ET.
    assert.deepEqual(periodWindow('monthly', utc(2027, 1, 1, 4, 30, 0)), {
      from: '2026-12-01',
      to: '2026-12-31',
    });
  });

  it('keeps a late-ET-evening instant in the same month (UTC would roll over)', () => {
    // 2026-07-01T01:00:00Z is 2026-06-30 21:00 EDT — June, not July.
    assert.deepEqual(periodWindow('monthly', utc(2026, 7, 1, 1, 0, 0)), {
      from: '2026-06-01',
      to: '2026-06-30',
    });
  });
});

describe('periodWindow — yearly (Jan 1 .. Dec 31)', () => {
  it('returns the full calendar year', () => {
    assert.deepEqual(periodWindow('yearly', utc(2026, 6, 10, 16, 0, 0)), {
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('is stable on Jan 1 in ET', () => {
    // 2026-01-01 00:30 EST.
    assert.deepEqual(periodWindow('yearly', utc(2026, 1, 1, 5, 30, 0)), {
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('is stable on Dec 31 in ET', () => {
    // 2026-12-31 12:00 EST.
    assert.deepEqual(periodWindow('yearly', utc(2026, 12, 31, 17, 0, 0)), {
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('attributes a late-Dec-31-ET instant to the right year (UTC would roll over)', () => {
    // 2027-01-01T04:30:00Z is 2026-12-31 23:30 EST — still 2026 in ET.
    assert.deepEqual(periodWindow('yearly', utc(2027, 1, 1, 4, 30, 0)), {
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });
});

describe('periodWindow — purity, tz, and defaults', () => {
  it('defaults to DEFAULT_TZ (America/New_York) when tz is omitted', () => {
    const now = utc(2026, 7, 1, 1, 0, 0); // 2026-06-30 21:00 EDT
    assert.deepEqual(
      periodWindow('monthly', now),
      periodWindow('monthly', now, DEFAULT_TZ),
    );
  });

  it('honors an explicit tz override (UTC buckets the same instant in July)', () => {
    // The same instant is June in ET but July in UTC.
    assert.deepEqual(periodWindow('monthly', utc(2026, 7, 1, 1, 0, 0), 'UTC'), {
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });

  it('is pure: same inputs always yield an equal (fresh) window', () => {
    const now = utc(2026, 3, 8, 16, 0, 0);
    const a = periodWindow('weekly', now);
    const b = periodWindow('weekly', now);
    assert.deepEqual(a, b);
    assert.notEqual(a, b); // a fresh object each call, never shared mutable state
  });

  it('does not throw for any valid period at any valid instant', () => {
    for (const period of BUDGET_PERIODS) {
      assert.doesNotThrow(() => periodWindow(period, utc(2026, 11, 1, 16, 0, 0)));
    }
  });

  it('from <= to lexicographically for every period (yyyy-mm-dd ordering)', () => {
    for (const period of BUDGET_PERIODS) {
      const { from, to } = periodWindow(period, utc(2026, 6, 10, 16, 0, 0));
      assert.ok(from <= to, `${period}: ${from} <= ${to}`);
    }
  });
});

describe('periodWindow — invalid input rejection (typed DateError)', () => {
  it('rejects an unknown period with a DateError', () => {
    assert.throws(
      () => periodWindow('daily' as never, utc(2026, 6, 10, 16, 0, 0)),
      DateError,
    );
    assert.throws(
      () => periodWindow('daily' as never, utc(2026, 6, 10, 16, 0, 0)),
      /invalid budget period/,
    );
  });

  it('rejects an invalid Date with a DateError', () => {
    assert.throws(() => periodWindow('monthly', new Date(Number.NaN)), DateError);
  });

  it('rejects an invalid IANA time zone with a DateError', () => {
    assert.throws(
      () => periodWindow('weekly', utc(2026, 6, 10, 16, 0, 0), 'Not/AZone'),
      DateError,
    );
  });
});

describe('isBudgetPeriod (P11-1 runtime guard)', () => {
  it('accepts the three period literals', () => {
    assert.equal(isBudgetPeriod('weekly'), true);
    assert.equal(isBudgetPeriod('monthly'), true);
    assert.equal(isBudgetPeriod('yearly'), true);
  });

  it('rejects everything else', () => {
    for (const bad of ['daily', 'Monthly', 'WEEKLY', '', 'month', undefined, null, 0, {}, []]) {
      assert.equal(isBudgetPeriod(bad), false);
    }
  });

  it('BUDGET_PERIODS contains exactly the three literals in display order', () => {
    assert.deepEqual([...BUDGET_PERIODS], ['weekly', 'monthly', 'yearly']);
    for (const period of BUDGET_PERIODS) {
      assert.equal(isBudgetPeriod(period), true);
    }
  });
});

describe('stepWeek — Mon..Sun week navigation (Feature B)', () => {
  // 2026-06-10 16:00 UTC is a Wednesday -> the Mon..Sun week 2026-06-08..14.
  const now = utc(2026, 6, 10, 16, 0, 0);

  it('delta 0 equals periodWindow(weekly) exactly (derivation, not duplication)', () => {
    assert.deepEqual(stepWeek(now, 0), periodWindow('weekly', now));
    assert.deepEqual(stepWeek(now, 0), { from: '2026-06-08', to: '2026-06-14' });
  });

  it('steps +1 week to the adjacent later Mon..Sun window', () => {
    assert.deepEqual(stepWeek(now, 1), { from: '2026-06-15', to: '2026-06-21' });
  });

  it('steps -1 week to the adjacent earlier Mon..Sun window', () => {
    assert.deepEqual(stepWeek(now, -1), { from: '2026-06-01', to: '2026-06-07' });
  });

  it('steps ±N weeks (each step a full 7-day Mon..Sun span)', () => {
    assert.deepEqual(stepWeek(now, 3), { from: '2026-06-29', to: '2026-07-05' });
    assert.deepEqual(stepWeek(now, -2), { from: '2026-05-25', to: '2026-05-31' });
    // Crossing the year boundary backwards from the 2026-06-08 base.
    assert.deepEqual(stepWeek(now, -23), { from: '2025-12-29', to: '2026-01-04' });
  });

  it('every step stays a full Monday..Sunday 7-day window', () => {
    for (let delta = -60; delta <= 60; delta += 1) {
      const w = stepWeek(now, delta);
      // 7 inclusive days: to == from + 6.
      const fromMs = Date.parse(`${w.from}T00:00:00Z`);
      const toMs = Date.parse(`${w.to}T00:00:00Z`);
      assert.equal((toMs - fromMs) / 86_400_000, 6, `delta ${delta} spans 6 day-steps`);
      // The base window for the stepped Wednesday must match the step result.
      const anchorMs = Date.parse(`${w.from}T16:00:00Z`); // a Monday noon-ET-ish instant
      assert.deepEqual(periodWindow('weekly', new Date(anchorMs)), w, `delta ${delta} round-trips`);
    }
  });

  it('crosses the spring-forward seam (2026-03-08) without losing/gaining a day', () => {
    // The week ending Sun 2026-03-08 is Mon 2026-03-02 .. Sun 2026-03-08.
    const inSpringWeek = utc(2026, 3, 4, 17, 0, 0); // Wed 2026-03-04 (EST)
    assert.deepEqual(stepWeek(inSpringWeek, 0), { from: '2026-03-02', to: '2026-03-08' });
    // Stepping +1 lands fully in EDT, still a clean Mon..Sun.
    assert.deepEqual(stepWeek(inSpringWeek, 1), { from: '2026-03-09', to: '2026-03-15' });
    // Stepping into the seam week from the following week lands back on it.
    const afterSeam = utc(2026, 3, 11, 16, 0, 0); // Wed 2026-03-11 (EDT)
    assert.deepEqual(stepWeek(afterSeam, -1), { from: '2026-03-02', to: '2026-03-08' });
  });

  it('crosses the fall-back seam (2026-11-01) without losing/gaining a day', () => {
    // The week ending Sun 2026-11-01 is Mon 2026-10-26 .. Sun 2026-11-01.
    const inFallWeek = utc(2026, 10, 28, 16, 0, 0); // Wed 2026-10-28 (EDT)
    assert.deepEqual(stepWeek(inFallWeek, 0), { from: '2026-10-26', to: '2026-11-01' });
    // Stepping +1 lands fully in EST, still a clean Mon..Sun.
    assert.deepEqual(stepWeek(inFallWeek, 1), { from: '2026-11-02', to: '2026-11-08' });
    // Stepping into the seam week from the following week lands back on it.
    const afterSeam = utc(2026, 11, 4, 17, 0, 0); // Wed 2026-11-04 (EST)
    assert.deepEqual(stepWeek(afterSeam, -1), { from: '2026-10-26', to: '2026-11-01' });
  });

  it('is pure: a fresh window each call, never shared mutable state', () => {
    const a = stepWeek(now, 2);
    const b = stepWeek(now, 2);
    assert.deepEqual(a, b);
    assert.notEqual(a, b);
  });

  it('rejects a non-integer delta with a DateError', () => {
    assert.throws(() => stepWeek(now, 1.5), DateError);
  });

  it('propagates DateError for an invalid Date or tz (derives from periodWindow)', () => {
    assert.throws(() => stepWeek(new Date(Number.NaN), 1), DateError);
    assert.throws(() => stepWeek(now, 1, 'Not/AZone'), DateError);
  });
});

describe('periodWindow composes with transfer exclusion (budget-spend boundary)', () => {
  // 2026-06-10 16:00 UTC is a Wednesday -> the Mon..Sun week 2026-06-08..14.
  const now = utc(2026, 6, 10, 16, 0, 0);

  it('window bounds are independent of transfer status (pure date math)', () => {
    // periodWindow takes only an instant; there is no transfer input that could
    // shift its bounds. Recomputing is byte-for-byte identical run to run.
    const a = periodWindow('weekly', now);
    const b = periodWindow('weekly', now);
    assert.deepEqual(a, b);
    assert.deepEqual(a, { from: '2026-06-08', to: '2026-06-14' });
    assert.deepEqual(periodWindow('monthly', now), { from: '2026-06-01', to: '2026-06-30' });
  });

  it('a transfer-marked row inside the window contributes zero budget spend', () => {
    // The date IS inside the weekly window (so the GSI2 date BETWEEN range would
    // include it), yet computeGsi2Keys returns null for a transfer on EITHER
    // signal — so it is never in the spend index the budget sums. The window
    // math and the transfer-exclusion math compose: in-window AND excluded.
    const window = periodWindow('weekly', now);
    const date: IsoDate = '2026-06-10';
    assert.equal(withinWindow(date, window), true);

    const ccPaymentFlag = computeGsi2Keys({
      household: 'goldfinch-home',
      categoryId: 'groceries', // wrongly filed under EXPENSE, but...
      categoryType: 'EXPENSE',
      isTransfer: true, // ...the per-row signal evicts it.
      date,
      txnId: 'cc',
    });
    assert.equal(ccPaymentFlag, null);

    const ccPaymentCategory = computeGsi2Keys({
      household: 'goldfinch-home',
      categoryId: 'transfers',
      categoryType: 'TRANSFER',
      isTransfer: false,
      date,
      txnId: 'cc',
    });
    assert.equal(ccPaymentCategory, null);
  });

  it('a genuine in-window EXPENSE still contributes spend (the exclusion is targeted)', () => {
    const window = periodWindow('weekly', now);
    const date: IsoDate = '2026-06-09';
    assert.equal(withinWindow(date, window), true);
    assert.deepEqual(
      computeGsi2Keys({
        household: 'goldfinch-home',
        categoryId: 'groceries',
        categoryType: 'EXPENSE',
        isTransfer: false,
        date,
        txnId: 'food',
      }),
      { GSI2PK: 'USER#goldfinch-home#CAT#groceries', GSI2SK: '2026-06-09#food' },
    );
  });
});
