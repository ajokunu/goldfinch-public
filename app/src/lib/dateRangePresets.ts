/**
 * Budget-view date-range presets (budget-range feature, Decision 1 / Section
 * 9.2). The Month/Year header opens a chooser of these six presets; selecting
 * one re-scopes the budget screen to that inclusive [from,to] range.
 *
 * EVERY from/to is derived in America/New_York (DEFAULT_TZ), the calendar the
 * server windows budget spend by. "Today" is the ET calendar day of `now`
 * (shared `isoDateInTz`), and all stepping is proleptic-UTC civil-day math (one
 * fixed midnight-UTC instant per civil date), exactly as `periodWindow.ts`
 * does. This module NEVER uses `Date.getFullYear/getMonth/getDate` or the
 * device-local helpers in `app/src/lib/dates.ts` -- those compute on the
 * device's local calendar and would land the wrong day for a user outside ET
 * (the reason Activity's `transactions/lib/dateRanges.ts` resolvers are NOT
 * reused here; Activity stays on its local resolvers in v1).
 *
 * "This month" / "This quarter" resolve to the WHOLE calendar month/quarter so
 * a monthly-cadence budget's prorated target over them equals its stored cap
 * (Decision 2 degenerates to the full period). "Last 30 / Last 90 / Year to
 * date" end at today. Every preset stays within the server's MAX_RANGE_DAYS
 * (366) cap, so none can trigger RANGE_TOO_LARGE.
 */
import type { IsoDate } from '@goldfinch/shared/types';
import { DEFAULT_TZ } from '@goldfinch/shared/constants';
import { isoDateInTz } from '@goldfinch/shared/dates';
import { periodWindow } from '@goldfinch/shared/periodWindow';

import type { I18nKey } from '../i18n';

/** Stable preset identifiers, in display order (Section 9.1). */
export type DateRangePresetId =
  | 'thisMonth'
  | 'lastMonth'
  | 'last30'
  | 'last90'
  | 'thisQuarter'
  | 'ytd';

export interface BudgetDateRange {
  from: IsoDate;
  to: IsoDate;
}

export interface DateRangePreset {
  id: DateRangePresetId;
  /** Radio-row label (I18nKey; each has a Korean value in strings.ts). */
  label: I18nKey;
}

/** Chooser order (Section 9.1): This month, Last month, Last 30, Last 90, This quarter, YTD. */
export const BUDGET_DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'last90', label: 'Last 90 days' },
  { id: 'thisQuarter', label: 'This quarter' },
  { id: 'ytd', label: 'Year to date' },
] as const;

const MS_PER_DAY = 86_400_000;

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** yyyy-mm-dd -> components. Input always comes from `isoDateInTz`. */
function partsOf(isoDate: IsoDate): CivilDate {
  return {
    year: Number(isoDate.slice(0, 4)),
    month: Number(isoDate.slice(5, 7)),
    day: Number(isoDate.slice(8, 10)),
  };
}

/** Components -> yyyy-mm-dd, zero-padding month and day. */
function isoOf(parts: CivilDate): IsoDate {
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

/**
 * Add `deltaDays` whole days in the proleptic-UTC day calendar. Each civil date
 * maps to one fixed midnight-UTC instant, so stepping is exact and DST-agnostic.
 */
function addCivilDays(parts: CivilDate, deltaDays: number): CivilDate {
  const anchor = Date.UTC(parts.year, parts.month - 1, parts.day);
  const shifted = new Date(anchor + deltaDays * MS_PER_DAY);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Last calendar day (28/29/30/31) of month `month` (1-based) in `year`. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Resolve a budget preset to inclusive from/to bounds in America/New_York.
 * `now` is injectable for tests; defaults to the current instant.
 */
export function resolveBudgetDateRange(
  preset: DateRangePresetId,
  now: Date = new Date(),
): BudgetDateRange {
  // ET calendar "today" — the single anchor every preset steps from.
  const today = partsOf(isoDateInTz(now, DEFAULT_TZ));
  const todayIso = isoOf(today);

  switch (preset) {
    case 'thisMonth':
      // Whole ET calendar month (the shared monthly window).
      return periodWindow('monthly', now);
    case 'lastMonth': {
      // First day of this month, stepped back one civil day, is the last day of
      // the previous month; that month's day 1 is its first day.
      const firstOfThis = isoOf({ year: today.year, month: today.month, day: 1 });
      const lastOfPrev = partsOf(isoOf(addCivilDays(partsOf(firstOfThis), -1)));
      return {
        from: isoOf({ year: lastOfPrev.year, month: lastOfPrev.month, day: 1 }),
        to: isoOf(lastOfPrev),
      };
    }
    case 'last30':
      // 30 inclusive days ending today (today - 29 .. today).
      return { from: isoOf(addCivilDays(today, -29)), to: todayIso };
    case 'last90':
      // 90 inclusive days ending today (today - 89 .. today).
      return { from: isoOf(addCivilDays(today, -89)), to: todayIso };
    case 'thisQuarter': {
      // Whole ET calendar quarter: first month is the quarter's anchor month,
      // last day is the last day of the quarter's final month.
      const startMonth = Math.floor((today.month - 1) / 3) * 3 + 1;
      const endMonth = startMonth + 2;
      return {
        from: isoOf({ year: today.year, month: startMonth, day: 1 }),
        to: isoOf({
          year: today.year,
          month: endMonth,
          day: lastDayOfMonth(today.year, endMonth),
        }),
      };
    }
    case 'ytd':
      // Jan 1 (ET) through today (ET).
      return { from: isoOf({ year: today.year, month: 1, day: 1 }), to: todayIso };
  }
}
