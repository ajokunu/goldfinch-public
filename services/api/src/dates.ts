/** Date helpers. All "today"/"current month" math respects DEFAULT_TZ. */

import { isoDateInTz } from '@goldfinch/shared/dates';
import type { IsoDate, IsoMonth, IsoTimestamp } from '@goldfinch/shared/types';

/** Today's calendar date in the given IANA time zone, as yyyy-mm-dd. */
export function todayInTz(tz: string): IsoDate {
  // Delegates to the shared tz-calendar helper so SK bucketing and API
  // windows can never disagree on what "today" means.
  return isoDateInTz(new Date(), tz);
}

export function currentMonthInTz(tz: string): IsoMonth {
  return todayInTz(tz).slice(0, 7);
}

/** Inclusive day count of [from, to]. Both must be valid yyyy-mm-dd. */
export function rangeDays(from: IsoDate, to: IsoDate): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

/** First and last calendar day of a yyyy-mm month. */
export function monthDateRange(month: IsoMonth): { from: IsoDate; to: IsoDate } {
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

/** Every yyyy-mm month in [from, to] inclusive. from must be <= to. */
export function listMonths(from: IsoMonth, to: IsoMonth): IsoMonth[] {
  const months: IsoMonth[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}
