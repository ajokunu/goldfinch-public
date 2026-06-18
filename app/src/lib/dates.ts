/**
 * Canonical date/month helpers for the whole app (promoted from the
 * dashboard, transactions, and budget features in Phase 7 -- feature code
 * must import from here, never re-implement).
 *
 * Conventions:
 * - Calendar math happens on local-device ISO dates (yyyy-mm-dd) because the
 *   API's from/to params are inclusive calendar dates.
 * - Strings are never fed to `new Date('yyyy-mm-dd')` (UTC midnight shift);
 *   they are parsed into local-time components first.
 * - IsoMonth (yyyy-mm) arithmetic is integer math on year/month parts; Date
 *   objects appear only (in UTC) for day counts and Intl labels.
 * - No money math lives here.
 */
import type { EpochSeconds, IsoDate, IsoMonth } from '@goldfinch/shared/types';

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// ---------------------------------------------------------------------------
// IsoDate (yyyy-mm-dd)
// ---------------------------------------------------------------------------

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Format a Date as a local-calendar ISO date (no UTC conversion, no floats). */
export function toIsoDate(date: Date): IsoDate {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Local-calendar ISO date `days` days before `now` (0 = today). */
export function isoDateDaysAgo(days: number, now: Date = new Date()): IsoDate {
  const shifted = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return toIsoDate(shifted);
}

/**
 * Render the summary's as-of instant (epoch seconds, from SimpleFIN balance
 * dates) as a medium date + short time in the device locale.
 */
export function formatAsOf(epochSeconds: EpochSeconds, locale?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(epochSeconds * 1000));
  } catch {
    return new Date(epochSeconds * 1000).toISOString();
  }
}

/**
 * Render a transaction's ISO calendar date compactly ("Jun 8", with the year
 * appended when it is not the current year). Parsed with local-time Date
 * components -- never `new Date('yyyy-mm-dd')`.
 */
export function formatTxnDate(date: IsoDate, locale?: string): string {
  const match = ISO_DATE_RE.exec(date);
  if (!match) return date;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  const sameYear = year === new Date().getFullYear();
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      year: sameYear ? undefined : 'numeric',
    }).format(parsed);
  } catch {
    return date;
  }
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * Human-readable label for a yyyy-mm-dd date used as a list section header,
 * e.g. "June 7, 2026". Falls back to the raw string for malformed input.
 */
export function formatDateHeading(date: IsoDate): string {
  const match = ISO_DATE_RE.exec(date);
  if (!match) return date;
  const year = match[1];
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const month = MONTH_NAMES[monthIndex];
  if (!month || !year || day < 1 || day > 31) return date;
  return `${month} ${day}, ${year}`;
}

// ---------------------------------------------------------------------------
// IsoMonth (yyyy-mm)
// ---------------------------------------------------------------------------

export function isValidIsoMonth(value: string): value is IsoMonth {
  return ISO_MONTH_RE.test(value);
}

function monthParts(month: IsoMonth): { year: number; month: number } {
  if (!isValidIsoMonth(month)) {
    throw new Error(`Invalid IsoMonth: ${month}`);
  }
  return {
    year: Number.parseInt(month.slice(0, 4), 10),
    month: Number.parseInt(month.slice(5, 7), 10),
  };
}

function buildIsoMonth(year: number, month1: number): IsoMonth {
  return `${String(year).padStart(4, '0')}-${String(month1).padStart(2, '0')}`;
}

/** Current month in the device's local calendar. */
export function currentIsoMonth(now: Date = new Date()): IsoMonth {
  return buildIsoMonth(now.getFullYear(), now.getMonth() + 1);
}

/** Add (or subtract, negative delta) whole months. */
export function addIsoMonths(month: IsoMonth, delta: number): IsoMonth {
  const p = monthParts(month);
  const zeroBased = p.year * 12 + (p.month - 1) + delta;
  const year = Math.floor(zeroBased / 12);
  return buildIsoMonth(year, (zeroBased - year * 12) + 1);
}

/** Lexicographic compare works for zero-padded yyyy-mm; kept explicit. */
export function compareIsoMonth(a: IsoMonth, b: IsoMonth): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusive yyyy-mm sequence from `from` to `to` (empty when from > to). */
export function listIsoMonths(from: IsoMonth, to: IsoMonth): IsoMonth[] {
  const months: IsoMonth[] = [];
  let cursor = from;
  while (compareIsoMonth(cursor, to) <= 0) {
    months.push(cursor);
    cursor = addIsoMonths(cursor, 1);
  }
  return months;
}

/** First/last calendar day of the month as IsoDate, for transaction queries. */
export function monthDateRange(month: IsoMonth): { from: IsoDate; to: IsoDate } {
  const p = monthParts(month);
  // Day 0 of the NEXT month is the last day of this month (UTC, layout-only).
  const lastDay = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** "June 2026" style label. */
export function isoMonthLabel(month: IsoMonth, locale?: string): string {
  const p = monthParts(month);
  const date = new Date(Date.UTC(p.year, p.month - 1, 1));
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return month;
  }
}

/** "Jun" style axis label for charts. */
export function isoMonthShortLabel(month: IsoMonth, locale?: string): string {
  const p = monthParts(month);
  const date = new Date(Date.UTC(p.year, p.month - 1, 1));
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return month.slice(5);
  }
}
