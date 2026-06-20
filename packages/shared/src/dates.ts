/**
 * Pure time-zone-aware date helpers.
 *
 * GoldFinch buckets every transaction SK date and every API date window by the
 * SAME calendar: DEFAULT_TZ (America/New_York). These helpers are the one
 * implementation of "what calendar day is this instant in tz X"; services must
 * not roll their own with Date#toISOString (that is the UTC calendar and shifts
 * 8pm-midnight ET instants into the next day).
 */

import { DEFAULT_TZ } from './constants.js';
import type { EpochSeconds, IsoDate } from './types/common.js';

export class DateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateError';
  }
}

// Intl.DateTimeFormat construction is expensive; cache one formatter per zone
// (sync normalizes hundreds of transactions per run).
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(tz);
  if (cached !== undefined) {
    return cached;
  }
  let formatter: Intl.DateTimeFormat;
  try {
    // en-CA with 2-digit parts formats as yyyy-mm-dd.
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new DateError(`invalid IANA time zone: "${tz}"`);
  }
  formatterCache.set(tz, formatter);
  return formatter;
}

// Same one-per-zone caching for the weekday formatter (the en-US 'short'
// weekday is locale-stable: 'Sun'..'Sat'). Separate from the date formatter so
// each stays single-purpose.
const weekdayFormatterCache = new Map<string, Intl.DateTimeFormat>();

/** 0=Sunday..6=Saturday, indexed by the en-US 'short' weekday label. */
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function weekdayFormatterFor(tz: string): Intl.DateTimeFormat {
  const cached = weekdayFormatterCache.get(tz);
  if (cached !== undefined) {
    return cached;
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  } catch {
    throw new DateError(`invalid IANA time zone: "${tz}"`);
  }
  weekdayFormatterCache.set(tz, formatter);
  return formatter;
}

/** The calendar date (yyyy-mm-dd) of `date` in the given IANA time zone. */
export function isoDateInTz(date: Date, tz: string): IsoDate {
  if (Number.isNaN(date.getTime())) {
    throw new DateError('cannot derive a calendar date from an invalid Date');
  }
  return formatterFor(tz).format(date);
}

/**
 * The day of the week of `date` in the given IANA time zone, as 0=Sunday ..
 * 6=Saturday (the US convention used by `periodWindow`'s weekly window). Derived
 * from the same Intl/tz machinery as `isoDateInTz` rather than `Date#getUTCDay`,
 * so an instant near midnight ET is attributed to its ET calendar day.
 */
export function weekdayInTz(date: Date, tz: string): number {
  if (Number.isNaN(date.getTime())) {
    throw new DateError('cannot derive a weekday from an invalid Date');
  }
  const label = weekdayFormatterFor(tz).format(date);
  const index = WEEKDAY_INDEX[label];
  if (index === undefined) {
    // Unreachable for valid IANA zones; the en-US 'short' weekday is locale-stable.
    throw new DateError(`unexpected weekday label "${label}" for time zone "${tz}"`);
  }
  return index;
}

/**
 * Epoch seconds -> calendar date (yyyy-mm-dd) in `tz` (DEFAULT_TZ unless
 * overridden). This is the transaction SK date-bucketing rule.
 */
export function epochSecondsToIsoDateInTz(
  epochSeconds: EpochSeconds,
  tz: string = DEFAULT_TZ,
): IsoDate {
  if (!Number.isFinite(epochSeconds)) {
    throw new DateError(`invalid epoch timestamp: ${String(epochSeconds)}`);
  }
  return isoDateInTz(new Date(Math.trunc(epochSeconds) * 1000), tz);
}
