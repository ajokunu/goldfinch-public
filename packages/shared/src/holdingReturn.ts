/**
 * Investment price-history normalization — the single source for the
 * Investments tab's "yearly movement" chart (ops/INVESTMENTS-CHART-PLAN.md).
 *
 * The chart metric is NORMALIZED % RETURN: a position's price-per-share series
 * (derived from market_value / shares and snapshotted daily by sync) is indexed
 * to the FIRST point in the visible window (baseline 0%) and plotted as % change.
 * Normalizing PRICE-PER-SHARE — not position VALUE — makes the line
 * contribution-neutral: a 401k's value rises as you deposit, but price-per-share
 * is the true market movement.
 *
 * This module is the ONLY place the normalization + window-return formulas live.
 * The client hook, the chart, and any headline MUST call these helpers rather
 * than re-deriving the math inline (the same single-source rule as holdingBasis
 * / budgetMath; a divergent copy is a contract bug).
 *
 * House conventions (mirroring holdingBasis.ts):
 * - BigInt-exact money math, no float. Percent truncates TOWARD ZERO (a -149.7%
 *   point reports -149, symmetric with +149.7% -> 149), documented + tested.
 * - These run inside an optimistic client projection over data returned by the
 *   API, so they DEGRADE on dirty data (log through the shared logger, drop the
 *   bad point / return empty) and NEVER throw. A non-positive or non-safe-integer
 *   baseline price means "no usable series" -> [].
 */

import { createLogger, type Logger } from './logger.js';
import { parseDecimalString } from './money.js';
import type { MinorUnits } from './types/common.js';

/** One snapshotted price-per-share point (the API's HoldingPricePointDto slice). */
export interface PricePoint {
  date: string;
  pricePerShareMinor: MinorUnits;
}

/** One normalized point: % change vs the window's first price (0 at baseline). */
export interface ReturnPoint {
  date: string;
  /** Signed integer percent (truncated toward zero); 0 at the baseline point. */
  returnPercent: number;
}

const defaultLogger: Logger = createLogger({
  base: { service: 'shared.holdingReturn' },
});

/** A price is usable as a baseline/denominator only if a safe positive integer. */
function isUsablePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Normalize an ordered price-per-share series to % return indexed to the first
 * point (baseline 0%). Points are assumed in ascending date order (the snapshot
 * SK sorts chronologically). Returns [] when there is no usable baseline (empty
 * input, or the first price is missing / non-positive / not a safe integer).
 * Individual later points that are dirty are dropped with a logged warning
 * rather than corrupting the series.
 *
 *   returnPercent(t) = trunc( (price(t) - price0) * 100 / price0 )
 *
 * computed via BigInt (truncates toward zero for either sign of the numerator).
 */
export function normalizeReturnSeries(
  points: readonly PricePoint[],
  logger: Logger = defaultLogger,
): ReturnPoint[] {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }
  // The baseline is the first point of the window. A non-positive baseline price
  // cannot normalize (divide-by-zero / sign nonsense), so the series is unusable.
  const baseline = points[0];
  if (baseline === undefined || !isUsablePrice(baseline.pricePerShareMinor)) {
    logger.warn('holding return series has no usable baseline price', {
      firstDate: baseline?.date,
      firstPrice: baseline?.pricePerShareMinor,
    });
    return [];
  }
  const price0 = BigInt(baseline.pricePerShareMinor);
  const out: ReturnPoint[] = [];
  for (const point of points) {
    if (!isUsablePrice(point.pricePerShareMinor)) {
      logger.warn('dropping dirty holding price snapshot from return series', {
        date: point?.date,
        pricePerShareMinor: point?.pricePerShareMinor,
      });
      continue;
    }
    const price = BigInt(point.pricePerShareMinor);
    // BigInt division truncates toward zero — the documented signed rounding.
    const returnPercent = Number(((price - price0) * 100n) / price0);
    out.push({ date: point.date, returnPercent });
  }
  return out;
}

/**
 * The headline: total % return across the visible window (first point to last).
 * Undefined when fewer than two usable points exist (nothing to compare), so the
 * caller renders a dash rather than a misleading 0%.
 */
export function windowReturnPercent(
  points: readonly PricePoint[],
  logger: Logger = defaultLogger,
): number | undefined {
  const series = normalizeReturnSeries(points, logger);
  if (series.length < 2) {
    return undefined;
  }
  return series[series.length - 1]!.returnPercent;
}

/**
 * Scale used to parse fractional share counts to an exact integer before the
 * BigInt price division (6 dp covers brokerage fractional-share precision).
 */
const SHARE_SCALE = 6;

/**
 * Price per share = `marketValueMinor / shares`, BigInt-exact in minor units —
 * the SINGLE source for both the API `currentPrice` DTO field and the sync daily
 * price snapshot, so the displayed price and the charted history cannot drift.
 * Returns undefined (caller shows a dash / skips the snapshot) when `shares` is
 * non-numeric or <= 0, or the result is not a safe integer — never a
 * divide-by-zero or a misleading price. BigInt division truncates toward zero.
 */
export function pricePerShareMinor(
  marketValueMinor: MinorUnits,
  shares: string,
): MinorUnits | undefined {
  if (!Number.isSafeInteger(marketValueMinor)) {
    return undefined;
  }
  let sharesScaled: bigint;
  try {
    sharesScaled = BigInt(parseDecimalString(shares, SHARE_SCALE));
  } catch {
    return undefined;
  }
  if (sharesScaled <= 0n) {
    return undefined;
  }
  const priceScale = 10n ** BigInt(SHARE_SCALE);
  const priceMinor = Number((BigInt(marketValueMinor) * priceScale) / sharesScaled);
  if (!Number.isSafeInteger(priceMinor)) {
    return undefined;
  }
  return priceMinor;
}
