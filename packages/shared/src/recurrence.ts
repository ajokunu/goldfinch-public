/**
 * Recurring/subscription series detection (P7-1, tuned per P8-5.2/5.3) —
 * pure logic, no AWS.
 *
 * Runs inside the daily sync Lambda after transaction upsert. The pipeline:
 *
 *   1. Group posted transactions by (accountId, currency, normalized payee).
 *      Normalization lowercases and strips TRAILING number/date tokens
 *      ("NETFLIX.COM 884213" and "NETFLIX.COM 991010" group together).
 *   2. Within a group, cluster amounts within 12% tolerance (integer math;
 *      P8-5.2 widened from the original 10%).
 *   3. Classify the cluster's cadence from the MEDIAN gap between unique
 *      occurrence dates: weekly 6-8d, biweekly 12-16d, monthly 26-35d,
 *      yearly 350-380d. Minimum 3 occurrences (2 for yearly; ALSO 2 for
 *      monthly when the observation window is shorter than 3 monthly periods
 *      — P8-5.2, the 90-day SimpleFIN history boundary case).
 *   4. Emit a DetectedSeries with a DETERMINISTIC seriesId so the daily run
 *      upserts the same RECURRING#<seriesId> item instead of duplicating it.
 *   5. P8-5.3 subscriptions cross-seed: any payee group with >= 2
 *      occurrences categorized `hintCategoryId` ('subscriptions') that the
 *      cadence detector did NOT emit becomes a low-confidence series with
 *      source 'category-hint', so it still surfaces in the review list.
 *
 * NOTE: this normalizer is intentionally different from services/ai's
 * categorization normalizePayee (which uppercases and strips interior
 * tokens); recurrence grouping only strips trailing noise, per the decisions
 * doc.
 */

import { sha256Hex } from './internal/sha256.js';
import { assertIsoDate } from './keys.js';
import type { RecurringCadence, RecurringSeriesSource } from './types/entities.js';
import type { CurrencyCode, IsoDate, MinorUnits } from './types/common.js';

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurrenceError';
  }
}

/** The minimal transaction shape the detector needs. Callers pass POSTED rows only. */
export interface RecurrenceCandidateTxn {
  txnId: string;
  payee: string;
  /** Signed minor units (bills are negative). */
  amountMinor: MinorUnits;
  currency: CurrencyCode;
  date: IsoDate;
  accountId: string;
  /**
   * Canonical category slug (null while uncategorized). Only consulted by the
   * P8-5.3 category-hint pass; cadence detection ignores it entirely.
   */
  categoryId?: string | null;
}

export interface DetectedSeries {
  /** Deterministic id — stable across runs for the same (account, currency, payee, cadence). */
  seriesId: string;
  /** Display payee: the most recent occurrence's original payee. */
  payee: string;
  payeeNormalized: string;
  accountId: string;
  currency: CurrencyCode;
  cadence: RecurringCadence;
  /** Integer mean (half away from zero) of the matched amounts. */
  avgAmountMinor: MinorUnits;
  lastDate: IsoDate;
  nextExpectedDate: IsoDate;
  /** Number of UNIQUE occurrence dates matched. */
  occurrenceCount: number;
  /** Matched transaction ids, oldest first. */
  txnIds: string[];
  /**
   * P8-5.3: 'detector' for cadence-classified series, 'category-hint' for
   * subscriptions-category cross-seeds (low cadence confidence by design).
   */
  source: RecurringSeriesSource;
}

// ---------------------------------------------------------------------------
// Cadence contract (P7-1, locked windows)
// ---------------------------------------------------------------------------

export interface CadenceWindow {
  /** Inclusive bounds on the median gap, days. */
  minDays: number;
  maxDays: number;
  /** Days added to lastDate for nextExpectedDate (monthly/yearly use calendar math). */
  nominalDays: number;
}

export const CADENCE_WINDOWS: Readonly<Record<RecurringCadence, CadenceWindow>> = {
  weekly: { minDays: 6, maxDays: 8, nominalDays: 7 },
  biweekly: { minDays: 12, maxDays: 16, nominalDays: 14 },
  monthly: { minDays: 26, maxDays: 35, nominalDays: 30 },
  yearly: { minDays: 350, maxDays: 380, nominalDays: 365 },
};

/** Minimum unique occurrences per cadence: 3, except 2 for yearly. */
export const MIN_OCCURRENCES: Readonly<Record<RecurringCadence, number>> = {
  weekly: 3,
  biweekly: 3,
  monthly: 3,
  yearly: 2,
};

/**
 * P8-5.2: a monthly series is accepted at 2 occurrences when the observation
 * window is shorter than this many monthly periods (3 x 30 nominal days =
 * 90 days). SimpleFIN serves only ~90 days of history on first link, which
 * makes 3 monthly hits the boundary case; until the stored history outgrows
 * the window, requiring 3 would systematically under-detect.
 */
export const SHORT_WINDOW_MONTHLY_PERIODS = 3;

/** Occurrences accepted for monthly inside a short observation window. */
export const SHORT_WINDOW_MONTHLY_MIN_OCCURRENCES = 2;

/**
 * Minimum unique occurrences for a cadence given the observation window
 * (days between the earliest observable transaction and the detection run).
 * `undefined` / non-finite windows fall back to the locked MIN_OCCURRENCES —
 * the relaxation NEVER applies when the window is unknown.
 */
export function minOccurrencesFor(
  cadence: RecurringCadence,
  observedWindowDays?: number,
): number {
  if (
    cadence === 'monthly' &&
    observedWindowDays !== undefined &&
    Number.isFinite(observedWindowDays) &&
    observedWindowDays <
      SHORT_WINDOW_MONTHLY_PERIODS * CADENCE_WINDOWS.monthly.nominalDays
  ) {
    return SHORT_WINDOW_MONTHLY_MIN_OCCURRENCES;
  }
  return MIN_OCCURRENCES[cadence];
}

/** Classification order — the windows do not overlap, so order is cosmetic but fixed. */
const CADENCES: readonly RecurringCadence[] = ['weekly', 'biweekly', 'monthly', 'yearly'];

/**
 * Map a median gap (whole days) to a cadence, or null when it falls in none
 * of the locked windows (e.g. 9-11d, 17-25d, 36-349d, >380d).
 */
export function classifyCadence(medianGapDays: number): RecurringCadence | null {
  if (!Number.isFinite(medianGapDays)) {
    return null;
  }
  for (const cadence of CADENCES) {
    const window = CADENCE_WINDOWS[cadence];
    if (medianGapDays >= window.minDays && medianGapDays <= window.maxDays) {
      return cadence;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Payee normalization
// ---------------------------------------------------------------------------

/**
 * A trailing token that is "number/date noise": a #/* reference marker
 * ("#1234", "*0042"), a digit run of 3+ ("884213" — shorter runs are usually
 * part of the name, "pho 75"), or a date-shaped token ("06/01", "2026-05-01",
 * "12/31/26").
 */
const TRAILING_NOISE_TOKEN = /^(?:[#*]\d+|\d{3,}|\d{1,4}[/.\-:]\d[\d/.\-:]*)$/;

/**
 * Recurrence grouping key: lowercase, collapse whitespace, then repeatedly
 * strip trailing number/date tokens and trailing separator punctuation.
 * Interior tokens are preserved ("pho 75" stays "pho 75"; only TRAILING noise
 * goes). Never returns empty: an all-noise payee falls back to its lowercased
 * collapsed form so it still groups with itself.
 */
export function normalizePayeeForRecurrence(payee: string): string {
  const collapsed = payee.toLowerCase().replace(/\s+/g, ' ').trim();
  const tokens = collapsed.split(' ');
  while (tokens.length > 1 && TRAILING_NOISE_TOKEN.test(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  let result = tokens.join(' ').replace(/[#*,\-.\s]+$/, '');
  if (result.length === 0) {
    result = collapsed;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Amount tolerance (12% per P8-5.2, integer math — no floats)
// ---------------------------------------------------------------------------

/**
 * P8-5.2: amount cluster tolerance, percent. Widened from the original P7-1
 * 10% after tuning against real data (annual price bumps and tax shifts
 * commonly land in the 10-12% band and were forking series).
 */
export const AMOUNT_TOLERANCE_PERCENT = 12;

/**
 * True when two signed amounts are within AMOUNT_TOLERANCE_PERCENT of each
 * other: |a - b| * 100 <= 12 * max(|a|, |b|). Opposite signs never match (a
 * refund is not an occurrence of a bill); two zeros match.
 */
export function amountsWithinTolerance(a: MinorUnits, b: MinorUnits): boolean {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    throw new RecurrenceError('amounts must be safe integers in minor units');
  }
  if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
    return false;
  }
  const absA = Math.abs(a);
  const absB = Math.abs(b);
  // BigInt: |a - b| * 100 could exceed 2^53 for extreme inputs.
  return (
    BigInt(Math.abs(a - b)) * 100n <=
    BigInt(AMOUNT_TOLERANCE_PERCENT) * BigInt(Math.max(absA, absB))
  );
}

/** Integer mean, rounded half away from zero, BigInt-exact. */
function integerMean(values: readonly MinorUnits[]): MinorUnits {
  if (values.length === 0) {
    throw new RecurrenceError('cannot take the mean of zero amounts');
  }
  let sum = 0n;
  for (const value of values) {
    sum += BigInt(value);
  }
  const count = BigInt(values.length);
  const sign = sum < 0n ? -1n : 1n;
  const mean = (2n * (sign * sum) + count) / (2n * count);
  const result = Number(sign * mean);
  if (!Number.isSafeInteger(result)) {
    throw new RecurrenceError('mean amount exceeds the safe integer range');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Calendar math (pure yyyy-mm-dd arithmetic; UTC day numbers, no time zones)
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

function isoParts(date: IsoDate): { year: number; month: number; day: number } {
  assertIsoDate(date);
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

function partsToIso(year: number, month: number, day: number): IsoDate {
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  assertIsoDate(iso);
  return iso;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whole days from `a` to `b` (positive when b is later). Exact in UTC. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const pa = isoParts(a);
  const pb = isoParts(b);
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) /
      MS_PER_DAY,
  );
}

function addDays(date: IsoDate, days: number): IsoDate {
  const p = isoParts(date);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return partsToIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** +N calendar months with day-of-month clamping (Jan 31 + 1mo = Feb 28/29). */
function addMonthsClamped(date: IsoDate, months: number): IsoDate {
  const p = isoParts(date);
  const zeroBased = p.month - 1 + months;
  const year = p.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12 + 1;
  const day = Math.min(p.day, daysInMonth(year, month));
  return partsToIso(year, month, day);
}

/**
 * The date the NEXT occurrence is expected after `lastDate`:
 * weekly +7d, biweekly +14d, monthly +1 calendar month (day clamped),
 * yearly +1 year (Feb 29 clamps to Feb 28).
 */
export function nextExpectedDate(lastDate: IsoDate, cadence: RecurringCadence): IsoDate {
  switch (cadence) {
    case 'weekly':
      return addDays(lastDate, 7);
    case 'biweekly':
      return addDays(lastDate, 14);
    case 'monthly':
      return addMonthsClamped(lastDate, 1);
    case 'yearly':
      return addMonthsClamped(lastDate, 12);
  }
}

// ---------------------------------------------------------------------------
// Series id
// ---------------------------------------------------------------------------

/** Bumped if the seriesId derivation ever changes (would re-key RECURRING# items). */
export const SERIES_ID_VERSION = 'v1';

/**
 * Deterministic series id: 32 hex chars of
 * sha256("recurrence-v1|account|currency|payeeNormalized|cadence"). Stable
 * across runs, safe in SKs and URL paths. Amount is deliberately excluded so
 * a price change (within tolerance drift over time) does not fork the series.
 */
export function seriesIdFor(
  accountId: string,
  currency: CurrencyCode,
  payeeNormalized: string,
  cadence: RecurringCadence,
): string {
  if (accountId.length === 0 || currency.length === 0 || payeeNormalized.length === 0) {
    throw new RecurrenceError('seriesIdFor requires non-empty components');
  }
  return sha256Hex(
    `recurrence-${SERIES_ID_VERSION}|${accountId}|${currency}|${payeeNormalized}|${cadence}`,
  ).slice(0, 32);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

interface AmountCluster {
  txns: RecurrenceCandidateTxn[];
}

/** Lower-middle median of a non-empty sorted-ascending integer array. */
function lowerMedian(sortedValues: readonly number[]): number {
  return sortedValues[Math.floor((sortedValues.length - 1) / 2)]!;
}

/**
 * The category slug whose payees are cross-seeded as 'category-hint' series
 * (P8-5.3). Defined HERE — the single source for the business rule — so the
 * sync pass and tests cannot drift on the slug.
 */
export const SUBSCRIPTIONS_HINT_CATEGORY_ID = 'subscriptions';

export interface DetectRecurringOptions {
  /**
   * Days between the earliest observable transaction and the detection run.
   * When provided and shorter than 3 monthly periods (90 days), monthly
   * cadence is accepted at 2 occurrences (P8-5.2). Omit when unknown — the
   * relaxation then never applies.
   */
  observedWindowDays?: number;
  /**
   * P8-5.3: category slug whose >= 2-occurrence payee groups become
   * 'category-hint' series when the cadence detector emitted nothing for the
   * group (pass SUBSCRIPTIONS_HINT_CATEGORY_ID). Omit to disable the pass.
   */
  hintCategoryId?: string;
}

/** Date-then-txnId comparator shared by the detector and hint passes. */
function byDateThenTxnId(a: RecurrenceCandidateTxn, b: RecurrenceCandidateTxn): number {
  return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.txnId < b.txnId ? -1 : 1);
}

/** Unique ascending dates of a date-sorted candidate list. */
function uniqueDatesOf(sorted: readonly RecurrenceCandidateTxn[]): IsoDate[] {
  const dates: IsoDate[] = [];
  for (const txn of sorted) {
    if (dates[dates.length - 1] !== txn.date) {
      dates.push(txn.date);
    }
  }
  return dates;
}

/** Ascending gaps (days) between consecutive unique dates. */
function sortedGaps(uniqueDates: readonly IsoDate[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < uniqueDates.length; i += 1) {
    gaps.push(daysBetween(uniqueDates[i - 1]!, uniqueDates[i]!));
  }
  gaps.sort((a, b) => a - b);
  return gaps;
}

/**
 * Detect recurring series over a set of POSTED transactions (callers must
 * exclude pending rows). Pure and deterministic: same input array (any
 * order) -> same output. Series are returned sorted by payeeNormalized, then
 * seriesId.
 */
export function detectRecurringSeries(
  txns: readonly RecurrenceCandidateTxn[],
  options: DetectRecurringOptions = {},
): DetectedSeries[] {
  // 1. Group by (accountId, currency, normalized payee).
  const groups = new Map<string, RecurrenceCandidateTxn[]>();
  const groupMeta = new Map<string, { accountId: string; currency: CurrencyCode; payeeNormalized: string }>();
  for (const txn of txns) {
    assertIsoDate(txn.date);
    const payeeNormalized = normalizePayeeForRecurrence(txn.payee);
    const key = `${txn.accountId}\u0000${txn.currency}\u0000${payeeNormalized}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [txn]);
      groupMeta.set(key, { accountId: txn.accountId, currency: txn.currency, payeeNormalized });
    } else {
      group.push(txn);
    }
  }

  const bySeriesId = new Map<string, DetectedSeries>();
  // Group keys for which the cadence detector emitted a series this run; the
  // hint pass never re-emits a payee the detector already covered.
  const detectedGroupKeys = new Set<string>();
  const sortedGroups = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  for (const [key, group] of sortedGroups) {
    const meta = groupMeta.get(key)!;

    // 2. Cluster amounts within tolerance of the cluster's running mean.
    //    Sorting by amount first makes clustering order-independent.
    const sortedByAmount = [...group].sort(
      (a, b) => a.amountMinor - b.amountMinor || (a.txnId < b.txnId ? -1 : a.txnId > b.txnId ? 1 : 0),
    );
    const clusters: AmountCluster[] = [];
    for (const txn of sortedByAmount) {
      const current = clusters[clusters.length - 1];
      if (
        current !== undefined &&
        amountsWithinTolerance(integerMean(current.txns.map((t) => t.amountMinor)), txn.amountMinor)
      ) {
        current.txns.push(txn);
      } else {
        clusters.push({ txns: [txn] });
      }
    }

    // 3. Classify each cluster's cadence from unique-date gaps.
    for (const cluster of clusters) {
      const byDate = [...cluster.txns].sort(byDateThenTxnId);
      const uniqueDates = uniqueDatesOf(byDate);
      if (uniqueDates.length < 2) {
        continue;
      }
      const cadence = classifyCadence(lowerMedian(sortedGaps(uniqueDates)));
      if (cadence === null) {
        continue;
      }
      if (uniqueDates.length < minOccurrencesFor(cadence, options.observedWindowDays)) {
        continue;
      }

      const lastDate = uniqueDates[uniqueDates.length - 1]!;
      const lastTxn = byDate[byDate.length - 1]!;
      const candidate: DetectedSeries = {
        seriesId: seriesIdFor(meta.accountId, meta.currency, meta.payeeNormalized, cadence),
        payee: lastTxn.payee,
        payeeNormalized: meta.payeeNormalized,
        accountId: meta.accountId,
        currency: meta.currency,
        cadence,
        avgAmountMinor: integerMean(cluster.txns.map((t) => t.amountMinor)),
        lastDate,
        nextExpectedDate: nextExpectedDate(lastDate, cadence),
        occurrenceCount: uniqueDates.length,
        txnIds: byDate.map((t) => t.txnId),
        source: 'detector',
      };
      detectedGroupKeys.add(key);

      // 4. seriesId excludes amount, so two amount clusters of one payee can
      //    collide; keep the stronger series (more occurrences, then later
      //    lastDate) — documented behavior, not a silent overwrite.
      const existing = bySeriesId.get(candidate.seriesId);
      if (
        existing === undefined ||
        candidate.occurrenceCount > existing.occurrenceCount ||
        (candidate.occurrenceCount === existing.occurrenceCount && candidate.lastDate > existing.lastDate)
      ) {
        bySeriesId.set(candidate.seriesId, candidate);
      }
    }
  }

  // 5. P8-5.3 subscriptions cross-seed: payee groups with >= 2 occurrences
  //    categorized `hintCategoryId` that the detector did not emit become
  //    low-confidence 'category-hint' series. No amount clustering (the gate
  //    being relaxed IS confidence); cadence is the classified median gap
  //    when it lands in a window, else 'monthly' (the subscriptions default).
  if (options.hintCategoryId !== undefined) {
    for (const [key, group] of sortedGroups) {
      if (detectedGroupKeys.has(key)) {
        continue;
      }
      const hinted = group.filter((txn) => txn.categoryId === options.hintCategoryId);
      const byDate = [...hinted].sort(byDateThenTxnId);
      const uniqueDates = uniqueDatesOf(byDate);
      if (uniqueDates.length < 2) {
        continue;
      }
      const meta = groupMeta.get(key)!;
      const cadence = classifyCadence(lowerMedian(sortedGaps(uniqueDates))) ?? 'monthly';
      const seriesId = seriesIdFor(meta.accountId, meta.currency, meta.payeeNormalized, cadence);
      // seriesId embeds the group key + cadence, so a collision could only
      // come from this group's own detector series — already skipped above.
      // Guarded anyway: a hint must never overwrite a detector series.
      if (bySeriesId.has(seriesId)) {
        continue;
      }
      const lastDate = uniqueDates[uniqueDates.length - 1]!;
      const lastTxn = byDate[byDate.length - 1]!;
      bySeriesId.set(seriesId, {
        seriesId,
        payee: lastTxn.payee,
        payeeNormalized: meta.payeeNormalized,
        accountId: meta.accountId,
        currency: meta.currency,
        cadence,
        avgAmountMinor: integerMean(hinted.map((t) => t.amountMinor)),
        lastDate,
        nextExpectedDate: nextExpectedDate(lastDate, cadence),
        occurrenceCount: uniqueDates.length,
        txnIds: byDate.map((t) => t.txnId),
        source: 'category-hint',
      });
    }
  }

  return [...bySeriesId.values()].sort(
    (a, b) =>
      (a.payeeNormalized < b.payeeNormalized ? -1 : a.payeeNormalized > b.payeeNormalized ? 1 : 0) ||
      (a.seriesId < b.seriesId ? -1 : a.seriesId > b.seriesId ? 1 : 0),
  );
}
