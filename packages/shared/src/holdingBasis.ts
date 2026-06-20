/**
 * Holding cost-basis precedence + investment P/L math (Investments enrichment,
 * Parts A & B; ops/INVESTMENTS-ENRICH-PLAN.md).
 *
 * This module is the ONLY place where
 *
 *   effective cost basis = manual ?? feed cost_basis (non-zero) ?? undefined
 *
 * and the signed gain / percent-return formulas are computed. The API DTO
 * mapper (`toHoldingDto`), the client optimistic projection, and the aggregate
 * tab MUST all call these helpers rather than re-deriving the rule inline — a
 * divergent copy is the exact contract bug the `effective*` / `budgetMath`
 * single-source rule exists to make impossible (row %, hero %, and any future
 * alert must agree by construction).
 *
 * House conventions (mirroring accountTypes.ts + budgetMath.ts):
 * - `effectiveCostBasisMinor` takes a minimal structural slice, validates, and
 *   on dirty runtime data degrades (returns undefined) through the shared
 *   logger — it NEVER throws.
 * - `holdingGainMinor` / `holdingPercentReturn` are the BigInt-exact money math
 *   (no float). They validate `Number.isSafeInteger` on their inputs and throw
 *   on a caller bug (a non-integer reaching the math layer), siblings of
 *   `budgetMath.percentUsed` — but UNLIKE `percentUsed` they are SIGNED (losses
 *   are negative, never clamped to 0) and truncate toward zero.
 */

import { createLogger, type Logger } from './logger.js';
import type { MinorUnits } from './types/common.js';

export class HoldingBasisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HoldingBasisError';
  }
}

/** Module logger used when callers do not inject their own. */
const defaultLogger: Logger = createLogger({
  base: { service: 'shared.holdingBasis' },
});

/**
 * The minimal structural slice the precedence helper needs, so the API mapper,
 * the client projection, and tests can pass partial shapes without a full
 * HoldingItem / HoldingBasisItem.
 */
export interface EffectiveCostBasisFields {
  /**
   * USER-OWNED manual total cost basis (the HOLDING_BASIS item's
   * `costBasisMinor`); undefined when the user has set none. Takes precedence
   * over the feed. A manual 0 is a legitimate user value and wins.
   */
  manualCostBasisMinor?: MinorUnits;
  /**
   * SimpleFIN feed cost basis (the HoldingItem's `costBasisMinor`); undefined
   * when the feed did not provide one. A feed 0 is treated as UNAVAILABLE (the
   * household's tax-advantaged accounts return 0) and never used.
   */
  feedCostBasisMinor?: MinorUnits;
}

/** Which source `effectiveCostBasisMinor` resolved to. */
export type CostBasisSource = 'manual' | 'feed';

/** The effective basis plus the source it came from, or undefined when none. */
export interface EffectiveCostBasis {
  costBasisMinor: MinorUnits;
  source: CostBasisSource;
}

/**
 * THE effective cost basis: `manual ?? feed (non-zero) ?? undefined`.
 *
 * - A manual value (including 0) wins outright — the user explicitly entered it.
 * - Otherwise a feed value is used ONLY when non-zero (a feed 0 means the
 *   institution does not report basis; using it would show a misleading 100%
 *   gain).
 * - Otherwise undefined (the caller renders the em-dash, never $0).
 *
 * Dirty runtime data (a stored value that is not a safe integer) is IGNORED for
 * that source with a logged warning rather than propagated or thrown — this
 * runs inside GET handlers and an optimistic client projection and must always
 * degrade safely.
 */
export function effectiveCostBasisMinor(
  fields: EffectiveCostBasisFields,
  logger: Logger = defaultLogger,
): EffectiveCostBasis | undefined {
  const manual = fields.manualCostBasisMinor;
  if (manual !== undefined) {
    if (Number.isSafeInteger(manual)) {
      return { costBasisMinor: manual, source: 'manual' };
    }
    logger.warn('ignoring invalid manual costBasisMinor on holding basis', {
      manualCostBasisMinor: manual,
    });
  }
  const feed = fields.feedCostBasisMinor;
  if (feed !== undefined) {
    if (Number.isSafeInteger(feed)) {
      // Feed 0 == unavailable: fall through to undefined, not a $0 basis.
      if (feed !== 0) {
        return { costBasisMinor: feed, source: 'feed' };
      }
    } else {
      logger.warn('ignoring invalid feed costBasisMinor on holding', {
        feedCostBasisMinor: feed,
      });
    }
  }
  return undefined;
}

/**
 * Gain/loss = `marketValueMinor - costBasisMinor`, a SIGNED integer (negative
 * on a loss). Plain integer subtraction; both inputs and the result are
 * re-checked for the safe-integer range (a value outside it reaching here is a
 * caller bug, not user data, so this throws rather than degrades — same posture
 * as `budgetMath.remainingMinor`). Same-currency only (P7-7): the caller must
 * have matched currencies before calling.
 */
export function holdingGainMinor(
  marketValueMinor: MinorUnits,
  costBasisMinor: MinorUnits,
): MinorUnits {
  if (!Number.isSafeInteger(marketValueMinor)) {
    throw new HoldingBasisError(
      `marketValueMinor must be a safe integer, got ${String(marketValueMinor)}`,
    );
  }
  if (!Number.isSafeInteger(costBasisMinor)) {
    throw new HoldingBasisError(
      `costBasisMinor must be a safe integer, got ${String(costBasisMinor)}`,
    );
  }
  const result = marketValueMinor - costBasisMinor;
  if (!Number.isSafeInteger(result)) {
    throw new HoldingBasisError('gain exceeds the safe integer range in minor units');
  }
  return result;
}

/**
 * Percent return = `gainMinor / costBasisMinor * 100`, the SIGNED sibling of
 * `budgetMath.percentUsed`. Copies the floor-via-BigInt idiom but does NOT
 * clamp a negative numerator (a loss must report a negative percent, never 0).
 *
 * Rounding: BigInt division truncates TOWARD ZERO, so -149.7% reports -149 (not
 * floored to -150) and +149.7% reports 149 — symmetric truncation, documented
 * and tested. The single source so row %, hero %, and any future alert agree.
 *
 * - Guards `costBasisMinor === 0` -> returns undefined (never divides by zero;
 *   the caller omits percentReturn so the client shows a dash).
 * - Validates `Number.isSafeInteger` on BOTH inputs (a non-integer reaching the
 *   math layer is a caller bug and throws, mirroring `percentUsed`).
 * - `gainMinor` may be negative; `costBasisMinor` is expected non-negative but
 *   the BigInt division is sign-correct either way.
 */
export function holdingPercentReturn(
  gainMinor: MinorUnits,
  costBasisMinor: MinorUnits,
): number | undefined {
  if (!Number.isSafeInteger(gainMinor)) {
    throw new HoldingBasisError(`gainMinor must be a safe integer, got ${String(gainMinor)}`);
  }
  if (!Number.isSafeInteger(costBasisMinor)) {
    throw new HoldingBasisError(
      `costBasisMinor must be a safe integer, got ${String(costBasisMinor)}`,
    );
  }
  if (costBasisMinor === 0) {
    return undefined;
  }
  // BigInt division truncates toward zero for either sign of the numerator,
  // which is the documented rounding rule (truncate, not floor) for the signed
  // case — unlike percentUsed's non-negative-only floor.
  return Number((BigInt(gainMinor) * 100n) / BigInt(costBasisMinor));
}
