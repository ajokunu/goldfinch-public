/**
 * Budget percent math (P7-8 / P7-10) — THE single source of "how far through
 * a budget am I" for both the app's progress bars and the notifications
 * Lambda's threshold evaluation. Nobody computes a budget percent any other
 * way; if the app and a push notification ever disagreed on 79% vs 80%, that
 * would be a bug this module exists to make impossible.
 *
 * FLOOR SEMANTICS (locked): percentUsed = floor(spent * 100 / limit).
 * A budget reports N% only once spending has FULLY reached N% of the limit —
 * 79.99% reports 79, so an "80% threshold" alert can never fire early, and
 * 100 is reported only at or beyond the limit. The percent may exceed 100
 * (150% over-spend reports 150); callers cap for display if they want.
 * Matches services/notifications' existing evaluator exactly.
 *
 * This module is also THE single source of budget-range proration
 * (`prorateRangeTargetMinor`) — the budget-range feature's target over an
 * arbitrary [from, to] — so the prorated target and `percentUsed` stay
 * consistent (same floor semantics, no float, same place).
 */

import type { IsoDate, MinorUnits } from './types/common.js';
import { isBudgetPeriod, type BudgetPeriod } from './types/api.js';

export class BudgetMathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetMathError';
  }
}

/**
 * Percent-of-limit notification thresholds, ascending (P7-8). The
 * notifications Lambda and any client-side "near limit" styling key off the
 * same values.
 */
export const BUDGET_ALERT_THRESHOLDS_PERCENT: readonly number[] = [80, 100];

/**
 * floor(spentMinor * 100 / limitMinor), BigInt-exact (no float division).
 *
 * - `spentMinor` is the period's spend as a POSITIVE magnitude (the GSI2
 *   aggregation convention). A negative value (net refunds) clamps to 0.
 * - `limitMinor` must be a positive integer; a zero/negative limit is a
 *   caller bug and throws BudgetMathError rather than returning Infinity-ish
 *   nonsense.
 * - Result is an integer >= 0 and MAY exceed 100.
 */
export function percentUsed(spentMinor: MinorUnits, limitMinor: MinorUnits): number {
  if (!Number.isSafeInteger(spentMinor)) {
    throw new BudgetMathError(`spentMinor must be a safe integer, got ${String(spentMinor)}`);
  }
  if (!Number.isSafeInteger(limitMinor) || limitMinor <= 0) {
    throw new BudgetMathError(
      `limitMinor must be a positive safe integer, got ${String(limitMinor)}`,
    );
  }
  if (spentMinor <= 0) {
    return 0;
  }
  // Non-negative operands: BigInt trunc division == floor.
  return Number((BigInt(spentMinor) * 100n) / BigInt(limitMinor));
}

/** limit - spent; negative once over budget. Inputs as in percentUsed. */
export function remainingMinor(spentMinor: MinorUnits, limitMinor: MinorUnits): MinorUnits {
  if (!Number.isSafeInteger(spentMinor)) {
    throw new BudgetMathError(`spentMinor must be a safe integer, got ${String(spentMinor)}`);
  }
  if (!Number.isSafeInteger(limitMinor) || limitMinor <= 0) {
    throw new BudgetMathError(
      `limitMinor must be a positive safe integer, got ${String(limitMinor)}`,
    );
  }
  const result = limitMinor - Math.max(spentMinor, 0);
  if (!Number.isSafeInteger(result)) {
    throw new BudgetMathError('remaining exceeds the safe integer range');
  }
  return result;
}

/**
 * Thresholds at or below percentUsed(spentMinor, limitMinor), ascending —
 * i.e. every threshold the current spend has reached. The notifications
 * handler diffs this against its SENTNOTIF# dedup markers and notifies about
 * the HIGHEST entry only; the floor semantics above guarantee a threshold
 * appears here only once genuinely reached.
 */
export function reachedThresholds(
  spentMinor: MinorUnits,
  limitMinor: MinorUnits,
  thresholds: readonly number[] = BUDGET_ALERT_THRESHOLDS_PERCENT,
): number[] {
  for (const threshold of thresholds) {
    if (!Number.isSafeInteger(threshold) || threshold <= 0) {
      throw new BudgetMathError(`thresholds must be positive integers, got ${String(threshold)}`);
    }
  }
  const pct = percentUsed(spentMinor, limitMinor);
  return [...thresholds].sort((a, b) => a - b).filter((threshold) => pct >= threshold);
}

// ---------------------------------------------------------------------------
// Range proration (budget-range feature, Decision 2) — THE single source of
// "what is this budget's target over an arbitrary [from, to] range".
//
// All day counts (the whole range, per-month overlaps, per-year overlaps) are
// derived from ONE inclusive-day-count primitive so a whole single month gives
// D_m == N_m => target == L, and from == to gives D == 1. Day arithmetic is the
// proleptic-UTC civil-day calendar (one fixed midnight-UTC instant per civil
// date) used by periodWindow.ts — never device-local Date — so leap days and DST
// seams are exact. Proration is BigInt with a per-term floor, matching
// percentUsed's floor semantics so the displayed percent (which consumes this
// prorated target) can never disagree with the notifications path.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Midnight-UTC epoch ms for a yyyy-mm-dd civil date (one fixed point per date). */
function civilEpochMs(isoDate: IsoDate): number {
  if (typeof isoDate !== 'string' || !ISO_DATE_RE.test(isoDate)) {
    throw new BudgetMathError(`expected a yyyy-mm-dd date, got ${JSON.stringify(isoDate)}`);
  }
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  const ms = Date.UTC(year, month - 1, day);
  // Reject calendar overflow (e.g. 2026-02-30): UTC silently rolls it forward.
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() + 1 !== month ||
    back.getUTCDate() !== day
  ) {
    throw new BudgetMathError(`not a valid calendar date: ${JSON.stringify(isoDate)}`);
  }
  return ms;
}

/**
 * Inclusive whole-day count of the range [from, to] (both yyyy-mm-dd), e.g.
 * from == to => 1, a 30-day month's first..last day => 30. THE single primitive
 * every range day count derives from (the whole range D, per-month D_m,
 * per-year D_y). Exact in the proleptic-UTC day calendar; DST-agnostic.
 *
 * @throws BudgetMathError if either bound is not a valid yyyy-mm-dd, or from > to.
 */
export function inclusiveDayCount(from: IsoDate, to: IsoDate): number {
  const start = civilEpochMs(from);
  const end = civilEpochMs(to);
  if (start > end) {
    throw new BudgetMathError(`from must be <= to, got from=${from} to=${to}`);
  }
  return Math.round((end - start) / MS_PER_DAY) + 1;
}

/** Last calendar day (28/29/30/31) of month `month` (1-based) in `year`. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** yyyy-mm-dd for civil-date components, zero-padding month/day. */
function isoOf(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Whole inclusive days of [from, to] that fall inside calendar month (year, month). */
function overlapDaysInMonth(from: IsoDate, to: IsoDate, year: number, month: number): number {
  const monthFrom = isoOf(year, month, 1);
  const monthTo = isoOf(year, month, lastDayOfMonth(year, month));
  const lo = from > monthFrom ? from : monthFrom;
  const hi = to < monthTo ? to : monthTo;
  if (lo > hi) {
    return 0;
  }
  return inclusiveDayCount(lo, hi);
}

/** Days in calendar year `year` (365 or 366). */
function daysInYear(year: number): number {
  return inclusiveDayCount(isoOf(year, 1, 1), isoOf(year, 12, 31));
}

/** Whole inclusive days of [from, to] that fall inside calendar year `year`. */
function overlapDaysInYear(from: IsoDate, to: IsoDate, year: number): number {
  const yearFrom = isoOf(year, 1, 1);
  const yearTo = isoOf(year, 12, 31);
  const lo = from > yearFrom ? from : yearFrom;
  const hi = to < yearTo ? to : yearTo;
  if (lo > hi) {
    return 0;
  }
  return inclusiveDayCount(lo, hi);
}

/**
 * The prorated budget target over an arbitrary inclusive range [from, to], in
 * integer minor units (budget-range feature, Decision 2 — the single source of
 * the range target; the client never re-derives it). `limitMinor` is the cap for
 * ONE period of the budget's own `period` cadence (e.g. weekly $450 = 45000).
 *
 * Branches strictly on cadence:
 * - monthly: for each calendar month m the range touches,
 *     contribution_m = floor(L * D_m / N_m)   // D_m = overlap days in m, N_m = days in m
 *   summed over m. A whole single month gives D_m == N_m => contribution == L.
 * - weekly: a SINGLE floor over the WHOLE inclusive range — floor(L * D / 7),
 *   D = inclusive days in [from, to]. NOT month-bucketed.
 * - yearly: for each calendar year y the range touches,
 *     contribution_y = floor(L * D_y / N_y)   // D_y = overlap days in y, N_y = days in y
 *   summed over y.
 *
 * All multiplication/division is BigInt with a per-term floor (BigInt trunc ==
 * floor for these non-negative operands), so a multi-term total can sit a few
 * minor units below a naive whole-period figure — by design, matching
 * percentUsed. Pure; no float.
 *
 * @throws BudgetMathError if `limitMinor` is not a positive safe integer, if
 *   `period` is not a BudgetPeriod, if either bound is not a valid yyyy-mm-dd,
 *   or if from > to.
 */
export function prorateRangeTargetMinor(
  limitMinor: MinorUnits,
  period: BudgetPeriod,
  from: IsoDate,
  to: IsoDate,
): MinorUnits {
  if (!Number.isSafeInteger(limitMinor) || limitMinor <= 0) {
    throw new BudgetMathError(
      `limitMinor must be a positive safe integer, got ${String(limitMinor)}`,
    );
  }
  if (!isBudgetPeriod(period)) {
    throw new BudgetMathError(`invalid budget period: ${JSON.stringify(period)}`);
  }
  // Validates both bounds and from <= to via the shared primitive.
  const totalDays = inclusiveDayCount(from, to);
  const L = BigInt(limitMinor);

  let target: bigint;
  switch (period) {
    case 'weekly': {
      // Single floor over the whole inclusive range — NOT month-bucketed.
      target = (L * BigInt(totalDays)) / 7n;
      break;
    }
    case 'monthly': {
      const fromYear = Number(from.slice(0, 4));
      const fromMonth = Number(from.slice(5, 7));
      const toYear = Number(to.slice(0, 4));
      const toMonth = Number(to.slice(5, 7));
      let sum = 0n;
      let year = fromYear;
      let month = fromMonth;
      // Walk each calendar month the range touches, inclusive of both ends.
      while (year < toYear || (year === toYear && month <= toMonth)) {
        const dM = overlapDaysInMonth(from, to, year, month);
        if (dM > 0) {
          const nM = lastDayOfMonth(year, month);
          sum += (L * BigInt(dM)) / BigInt(nM);
        }
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
      target = sum;
      break;
    }
    case 'yearly': {
      const fromYear = Number(from.slice(0, 4));
      const toYear = Number(to.slice(0, 4));
      let sum = 0n;
      for (let year = fromYear; year <= toYear; year += 1) {
        const dY = overlapDaysInYear(from, to, year);
        if (dY > 0) {
          sum += (L * BigInt(dY)) / BigInt(daysInYear(year));
        }
      }
      target = sum;
      break;
    }
  }

  const result = Number(target);
  if (!Number.isSafeInteger(result)) {
    throw new BudgetMathError('prorated target exceeds the safe integer range');
  }
  return result;
}
