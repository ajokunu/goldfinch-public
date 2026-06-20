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
 */

import type { MinorUnits } from './types/common.js';

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
