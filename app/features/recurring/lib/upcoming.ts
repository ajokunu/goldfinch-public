/**
 * Pure grouping/projection helpers for the recurring feature (P7-1).
 *
 * Money discipline: all sums are integer minor-unit additions/multiplications
 * grouped strictly per currency (P7-7: never a synthetic mixed-currency
 * total). No floats, no division -- exact integer math only.
 *
 * Date discipline: IsoDate strings (yyyy-mm-dd) compare lexicographically;
 * cadence stepping reuses the shared calendar-clamped nextExpectedDate so
 * client projection agrees with the sync detector's own arithmetic.
 */
import type {
  CurrencyCode,
  IsoDate,
  IsoMonth,
  MinorUnits,
  RecurringCadence,
  RecurringSeriesDto,
  RecurringStatus,
} from '@goldfinch/shared/types';
import { nextExpectedDate } from '@goldfinch/shared/recurrence';

import { monthDateRange } from '../../../src/lib/dates';

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const CADENCE_LABELS: Readonly<Record<RecurringCadence, string>> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/** Human label for a cadence badge ("Weekly", "Every 2 weeks", ...). */
export function cadenceLabel(cadence: RecurringCadence): string {
  return CADENCE_LABELS[cadence];
}

// ---------------------------------------------------------------------------
// Ordering and filtering
// ---------------------------------------------------------------------------

/**
 * Soonest-due-first ordering with deterministic ties (payee, then seriesId)
 * so optimistic cache writes never reshuffle rows visually.
 */
export function compareByNextExpected(
  a: RecurringSeriesDto,
  b: RecurringSeriesDto,
): number {
  if (a.nextExpectedDate !== b.nextExpectedDate) {
    return a.nextExpectedDate < b.nextExpectedDate ? -1 : 1;
  }
  const aPayee = a.payee.toLowerCase();
  const bPayee = b.payee.toLowerCase();
  if (aPayee !== bPayee) return aPayee < bPayee ? -1 : 1;
  return a.seriesId < b.seriesId ? -1 : a.seriesId > b.seriesId ? 1 : 0;
}

/** All series with the given review status, soonest due first. */
export function seriesByStatus(
  items: readonly RecurringSeriesDto[],
  status: RecurringStatus,
): RecurringSeriesDto[] {
  return items.filter((item) => item.status === status).sort(compareByNextExpected);
}

/**
 * Series shown in the upcoming view: everything not ignored (detected items
 * are included so an unreviewed bill is never invisible), soonest due first.
 */
export function activeSeries(
  items: readonly RecurringSeriesDto[],
): RecurringSeriesDto[] {
  return items.filter((item) => item.status !== 'ignored').sort(compareByNextExpected);
}

/**
 * A bill is an expense series. Detection never mixes signs within a series
 * (amountsWithinTolerance rejects opposite signs), so the average's sign is
 * the series' sign; positive series are recurring income (paychecks).
 */
export function isBill(series: RecurringSeriesDto): boolean {
  return series.avgAmountMinor < 0;
}

/** Active expense series only -- the dashboard card's slice. */
export function upcomingBills(
  items: readonly RecurringSeriesDto[],
): RecurringSeriesDto[] {
  return activeSeries(items).filter(isBill);
}

/** True when the expected charge date has passed without a matching txn. */
export function isOverdue(series: RecurringSeriesDto, today: IsoDate): boolean {
  return series.nextExpectedDate < today;
}

// ---------------------------------------------------------------------------
// Month projection
// ---------------------------------------------------------------------------

/**
 * Safety cap on cadence steps when a series' nextExpectedDate is far in the
 * past (e.g. a long-dead weekly series the user never ignored). 500 weekly
 * steps is nearly a decade -- anything beyond is display noise, not data.
 */
const MAX_PROJECTION_STEPS = 500;

/**
 * How many occurrences of a series land inside `month`, projected forward
 * from its nextExpectedDate by cadence. Occurrences already paid this month
 * do not count (the detector advanced nextExpectedDate past them); overdue
 * occurrences earlier in the month still do.
 */
export function occurrencesInMonth(
  firstExpected: IsoDate,
  cadence: RecurringCadence,
  month: IsoMonth,
): number {
  const { from, to } = monthDateRange(month);
  let date = firstExpected;
  let count = 0;
  for (let step = 0; step < MAX_PROJECTION_STEPS && date <= to; step += 1) {
    if (date >= from) count += 1;
    date = nextExpectedDate(date, cadence);
  }
  return count;
}

/** Per-currency total of bill occurrences still expected within a month. */
export interface MonthBillTotal {
  currency: CurrencyCode;
  /** Signed (negative) integer minor units across all due occurrences. */
  totalMinor: MinorUnits;
  /** Number of expected charges, counting weekly bills once per hit. */
  dueCount: number;
}

/**
 * "Due this month" totals for the upcoming-bills views: non-ignored expense
 * series only, one entry per currency (sorted by code), each weekly/biweekly
 * series counted once per projected occurrence in the month.
 */
export function monthBillTotals(
  items: readonly RecurringSeriesDto[],
  month: IsoMonth,
): MonthBillTotal[] {
  const byCurrency = new Map<CurrencyCode, { totalMinor: number; dueCount: number }>();
  for (const series of items) {
    if (series.status === 'ignored' || !isBill(series)) continue;
    const occurrences = occurrencesInMonth(
      series.nextExpectedDate,
      series.cadence,
      month,
    );
    if (occurrences === 0) continue;
    const entry = byCurrency.get(series.currency) ?? { totalMinor: 0, dueCount: 0 };
    entry.totalMinor += series.avgAmountMinor * occurrences;
    entry.dueCount += occurrences;
    byCurrency.set(series.currency, entry);
  }
  return [...byCurrency.entries()]
    .map(([currency, entry]) => ({
      currency,
      totalMinor: entry.totalMinor,
      dueCount: entry.dueCount,
    }))
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}
