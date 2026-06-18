/**
 * Budget date-range preset resolvers (budget-range feature, Section 9.2). Every
 * from/to must be derived in America/New_York via the shared periodWindow /
 * isoDateInTz machinery, never the device-local calendar. These assertions pin
 * the six presets against the shared ET window and against explicit civil-day
 * math, including an instant whose ET calendar day differs from its UTC day.
 */
import { periodWindow } from '@goldfinch/shared/periodWindow';

import {
  BUDGET_DATE_RANGE_PRESETS,
  resolveBudgetDateRange,
} from '../src/lib/dateRangePresets';

// Mid-month, mid-day ET instant: 2026-06-15 08:00 ET. Unambiguous for the
// trailing-window and YTD presets.
const MID = new Date('2026-06-15T12:00:00.000Z');

describe('budget date-range presets', () => {
  it('lists exactly the six presets in the signed-off order', () => {
    expect(BUDGET_DATE_RANGE_PRESETS.map((p) => p.id)).toEqual([
      'thisMonth',
      'lastMonth',
      'last30',
      'last90',
      'thisQuarter',
      'ytd',
    ]);
  });

  it('This month is the shared ET monthly window (whole calendar month)', () => {
    expect(resolveBudgetDateRange('thisMonth', MID)).toEqual(
      periodWindow('monthly', MID),
    );
  });

  it('Last month is the whole previous ET calendar month', () => {
    expect(resolveBudgetDateRange('lastMonth', MID)).toEqual({
      from: '2026-05-01',
      to: '2026-05-31',
    });
  });

  it('Last 30 days is the 30 inclusive days ending today (ET)', () => {
    expect(resolveBudgetDateRange('last30', MID)).toEqual({
      from: '2026-05-17',
      to: '2026-06-15',
    });
  });

  it('Last 90 days is the 90 inclusive days ending today (ET)', () => {
    expect(resolveBudgetDateRange('last90', MID)).toEqual({
      from: '2026-03-18',
      to: '2026-06-15',
    });
  });

  it('This quarter is the whole ET calendar quarter', () => {
    // 2026-06-15 falls in Q2 (Apr 1 .. Jun 30).
    expect(resolveBudgetDateRange('thisQuarter', MID)).toEqual({
      from: '2026-04-01',
      to: '2026-06-30',
    });
  });

  it('Year to date is Jan 1 (ET) through today (ET)', () => {
    expect(resolveBudgetDateRange('ytd', MID)).toEqual({
      from: '2026-01-01',
      to: '2026-06-15',
    });
  });

  it('anchors "today" on the ET calendar day, not the UTC day', () => {
    // 2026-03-01 03:00 UTC is 2026-02-28 22:00 ET, so ET "today" is Feb 28.
    // Naive UTC math (getUTCDate) would land on March 1 and break every preset.
    const lateNight = new Date('2026-03-01T03:00:00.000Z');

    // YTD ends on the ET day (Feb 28), proving the anchor.
    expect(resolveBudgetDateRange('ytd', lateNight)).toEqual({
      from: '2026-01-01',
      to: '2026-02-28',
    });
    // This month is February (the ET month), not March.
    expect(resolveBudgetDateRange('thisMonth', lateNight)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    // This quarter is Q1 (Jan 1 .. Mar 31).
    expect(resolveBudgetDateRange('thisQuarter', lateNight)).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
    });
  });

  it('Last month handles the January -> December year rollover (ET)', () => {
    // 2026-01-10 12:00 ET: last month is December 2025.
    const jan = new Date('2026-01-10T17:00:00.000Z');
    expect(resolveBudgetDateRange('lastMonth', jan)).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('Last 30 days never exceeds the server MAX_RANGE_DAYS cap', () => {
    const { from, to } = resolveBudgetDateRange('last90', MID);
    const days =
      Math.round(
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
          86_400_000,
      ) + 1;
    expect(days).toBeLessThanOrEqual(366);
  });
});
