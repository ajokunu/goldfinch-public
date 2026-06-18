/**
 * Budget-period windows (Phase 11, P11-2) — the single source of truth for
 * "what calendar range does the CURRENT weekly/monthly/yearly period cover".
 *
 * Every window is computed in DEFAULT_TZ (America/New_York), matching the
 * calendar GoldFinch buckets transaction SK dates by (see dates.ts). The output
 * `{ from, to }` are inclusive yyyy-mm-dd bounds, drop-in for the GSI2 date
 * BETWEEN range the budget-spend query already uses (GSI2SK = date).
 *
 *   - weekly:  current calendar week, MONDAY .. SUNDAY (ISO convention).
 *   - monthly: current calendar month, day 1 .. last day of month.
 *   - yearly:  current calendar year, Jan 1 .. Dec 31.
 *
 * Pure: no I/O, no process.env, no throws on valid input. The instant -> ET
 * calendar-day and ET weekday derivations both reuse the cached Intl/tz helpers
 * in dates.ts, so there is no hand-rolled UTC-offset math here. Whole-day
 * arithmetic for the weekly window is done in the proleptic-UTC day calendar
 * (one fixed point per civil date), which never crosses a DST seam.
 *
 * `stepWeek` (Feature B — budget week navigation) derives from the weekly
 * window and shifts it by whole weeks via the same civil-day arithmetic, so the
 * Mon..Sun boundary is single-sourced and never re-derived.
 */

import { DEFAULT_TZ } from './constants.js';
import { DateError, isoDateInTz, weekdayInTz } from './dates.js';
import type { IsoDate } from './types/common.js';
import { isBudgetPeriod, type BudgetPeriod } from './types/api.js';

/** Inclusive calendar window for a budget period, as yyyy-mm-dd bounds. */
export interface PeriodWindow {
  /** First day of the period (yyyy-mm-dd), inclusive. */
  from: IsoDate;
  /** Last day of the period (yyyy-mm-dd), inclusive. */
  to: IsoDate;
}

const MS_PER_DAY = 86_400_000;

/** Parsed yyyy-mm-dd calendar-date components (1-based month). */
interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** yyyy-mm-dd -> components. The input here always comes from `isoDateInTz`. */
function partsOfIsoDate(isoDate: IsoDate): DateParts {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  return { year, month, day };
}

/**
 * Components -> yyyy-mm-dd, zero-padding month and day to two digits. The year
 * is emitted as-is: it always originates from the en-CA `isoDateInTz` formatter
 * (a 4-digit year) and is only ever shifted by whole days via `addCivilDays`,
 * so for every date this app handles it is already four digits.
 */
function isoDateOfParts(parts: DateParts): IsoDate {
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

/**
 * Add `deltaDays` whole days to a civil date, in the proleptic-UTC day calendar.
 * Each civil date maps to one fixed midnight-UTC instant, so stepping by whole
 * days is exact and DST-agnostic (we are counting calendar days, not seconds).
 */
function addCivilDays(parts: DateParts, deltaDays: number): DateParts {
  const anchor = Date.UTC(parts.year, parts.month - 1, parts.day);
  const shifted = new Date(anchor + deltaDays * MS_PER_DAY);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Last calendar day of the month containing `parts` (handles leap Februaries). */
function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this month; UTC avoids DST drift.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The inclusive calendar window of the CURRENT `period` at instant `now`, in
 * `tz` (default America/New_York). Pure; never throws on valid input.
 *
 * @throws DateError if `period` is not a BudgetPeriod, `now` is an invalid Date,
 *   or `tz` is not a valid IANA zone — the same typed error class the rest of
 *   the date layer uses, so callers log/translate it uniformly.
 */
export function periodWindow(
  period: BudgetPeriod,
  now: Date,
  tz: string = DEFAULT_TZ,
): PeriodWindow {
  if (!isBudgetPeriod(period)) {
    throw new DateError(`invalid budget period: ${JSON.stringify(period)}`);
  }
  // Both helpers validate `now` (invalid Date) and `tz` (bad IANA zone) and
  // throw DateError; calling isoDateInTz first surfaces those uniformly.
  const today = partsOfIsoDate(isoDateInTz(now, tz));

  switch (period) {
    case 'monthly': {
      const from = isoDateOfParts({ year: today.year, month: today.month, day: 1 });
      const to = isoDateOfParts({
        year: today.year,
        month: today.month,
        day: lastDayOfMonth(today.year, today.month),
      });
      return { from, to };
    }
    case 'yearly': {
      return {
        from: isoDateOfParts({ year: today.year, month: 1, day: 1 }),
        to: isoDateOfParts({ year: today.year, month: 12, day: 31 }),
      };
    }
    case 'weekly': {
      // ISO week: Monday(start) .. Sunday(end). weekdayInTz is 0=Sun..6=Sat;
      // daysSinceMonday maps Mon->0, Tue->1, ... Sun->6, so a Sunday rolls back
      // into the week that began the prior Monday. Step back to that Monday and
      // forward to the following Sunday.
      const dow = weekdayInTz(now, tz);
      const daysSinceMonday = (dow + 6) % 7;
      const from = addCivilDays(today, -daysSinceMonday);
      const to = addCivilDays(today, 6 - daysSinceMonday);
      return { from: isoDateOfParts(from), to: isoDateOfParts(to) };
    }
  }
}

/**
 * Step a Mon..Sun weekly window by `weekDelta` whole weeks (Feature B — budget
 * week navigation). Derives from the SHIPPED weekly window so the Monday..Sunday
 * boundary is single-sourced and can never drift from `periodWindow('weekly')`:
 * it shifts BOTH `from` and `to` by `7 * weekDelta` civil days through the same
 * proleptic-UTC `addCivilDays` the weekly window uses, so the window stays a full
 * 7-day Mon..Sun span across every DST seam.
 *
 * - `weekDelta` 0 returns a window equal to `periodWindow('weekly', now, tz)`
 *   (derivation, not duplication).
 * - Negative steps go to earlier weeks, positive to later weeks; any integer is
 *   allowed (every week exists — there is no min/max gate).
 *
 * Pure; never throws on valid input.
 *
 * @throws DateError if `now` is an invalid Date or `tz` is not a valid IANA zone
 *   (surfaced via the underlying `periodWindow('weekly', ...)` call).
 */
export function stepWeek(
  now: Date,
  weekDelta: number,
  tz: string = DEFAULT_TZ,
): PeriodWindow {
  if (!Number.isInteger(weekDelta)) {
    throw new DateError(`weekDelta must be an integer, got ${JSON.stringify(weekDelta)}`);
  }
  const base = periodWindow('weekly', now, tz);
  const shift = 7 * weekDelta;
  return {
    from: isoDateOfParts(addCivilDays(partsOfIsoDate(base.from), shift)),
    to: isoDateOfParts(addCivilDays(partsOfIsoDate(base.to), shift)),
  };
}
