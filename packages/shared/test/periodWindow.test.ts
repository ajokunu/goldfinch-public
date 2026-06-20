/**
 * periodWindow (P11-2) — current weekly/monthly/yearly window in DEFAULT_TZ
 * (America/New_York). Covers every period's boundaries, the US Sunday..Saturday
 * week, month and year rollover, leap February, both 2026 DST transitions
 * (2026-03-08 spring-forward and 2026-11-01 fall-back are Sundays), and the
 * exact from/to strings. Pure: never throws on valid input.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_TZ } from '../src/constants.js';
import { DateError } from '../src/dates.js';
import { periodWindow } from '../src/periodWindow.js';
import { isBudgetPeriod, BUDGET_PERIODS } from '../src/types/api.js';

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

describe('periodWindow — weekly (US Sunday..Saturday)', () => {
  it('a midweek day yields its Sunday..Saturday week', () => {
    // 2026-06-10 12:00 EDT is a Wednesday.
    assert.deepEqual(periodWindow('weekly', utc(2026, 6, 10, 16, 0, 0)), {
      from: '2026-06-07',
      to: '2026-06-13',
    });
  });

  it('a Sunday is the first day of its own week', () => {
    // 2026-06-07 12:00 EDT is a Sunday.
    assert.deepEqual(periodWindow('weekly', utc(2026, 6, 7, 16, 0, 0)), {
      from: '2026-06-07',
      to: '2026-06-13',
    });
  });

  it('a Saturday is the last day of its own week', () => {
    // 2026-06-13 12:00 EDT is a Saturday.
    assert.deepEqual(periodWindow('weekly', utc(2026, 6, 13, 16, 0, 0)), {
      from: '2026-06-07',
      to: '2026-06-13',
    });
  });

  it('a week may span a month boundary', () => {
    // 2026-07-01 is a Wednesday; its week runs Sun 2026-06-28 .. Sat 2026-07-04.
    assert.deepEqual(periodWindow('weekly', utc(2026, 7, 1, 16, 0, 0)), {
      from: '2026-06-28',
      to: '2026-07-04',
    });
  });

  it('a week may span a year boundary', () => {
    // 2025-12-31 23:30 EST is a Wednesday (ET day 2025-12-31); week runs
    // Sun 2025-12-28 .. Sat 2026-01-03.
    assert.deepEqual(periodWindow('weekly', utc(2026, 1, 1, 4, 30, 0)), {
      from: '2025-12-28',
      to: '2026-01-03',
    });
  });

  it('handles the spring-forward Sunday (2026-03-08, EST -> EDT)', () => {
    // 2026-03-08 is a Sunday and the spring DST date; whole-day arithmetic must
    // not lose or gain a day across the 23-hour civil day.
    assert.deepEqual(periodWindow('weekly', utc(2026, 3, 8, 16, 0, 0)), {
      from: '2026-03-08',
      to: '2026-03-14',
    });
    // The following Wednesday (already EDT) lands in the same week.
    assert.deepEqual(periodWindow('weekly', utc(2026, 3, 11, 16, 0, 0)), {
      from: '2026-03-08',
      to: '2026-03-14',
    });
    // The Saturday just BEFORE belongs to the prior week.
    assert.deepEqual(periodWindow('weekly', utc(2026, 3, 7, 16, 0, 0)), {
      from: '2026-03-01',
      to: '2026-03-07',
    });
  });

  it('handles the fall-back Sunday (2026-11-01, EDT -> EST)', () => {
    // 2026-11-01 is a Sunday and the fall DST date (25-hour civil day).
    assert.deepEqual(periodWindow('weekly', utc(2026, 11, 1, 16, 0, 0)), {
      from: '2026-11-01',
      to: '2026-11-07',
    });
    // The following Wednesday (already EST) is in the same week.
    assert.deepEqual(periodWindow('weekly', utc(2026, 11, 4, 17, 0, 0)), {
      from: '2026-11-01',
      to: '2026-11-07',
    });
    // The Saturday just BEFORE belongs to the prior week.
    assert.deepEqual(periodWindow('weekly', utc(2026, 10, 31, 16, 0, 0)), {
      from: '2026-10-25',
      to: '2026-10-31',
    });
  });

  it('attributes a near-midnight ET instant to its ET day, not the UTC day', () => {
    // 2026-06-14T02:00:00Z is 2026-06-13 22:00 EDT — still Saturday in ET,
    // so the week is the one ending 2026-06-13, not the next one.
    assert.deepEqual(periodWindow('weekly', utc(2026, 6, 14, 2, 0, 0)), {
      from: '2026-06-07',
      to: '2026-06-13',
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
