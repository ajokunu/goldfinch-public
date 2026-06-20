/**
 * Aggregate holdings across ALL investment accounts for the Investments tab.
 *
 * Pure functions, no react-native imports (exercised directly by node --test in
 * test/aggregate.test.ts):
 *
 * - aggregateHoldings(): groups HoldingDto rows strictly by (currency, symbol)
 *   into one position per ticker. Shares are summed as EXACT decimal strings
 *   (never parsed into floats -- a float would silently corrupt fractional
 *   share totals). marketValueMinor sums as integer minor units. costBasisMinor
 *   sums only when EVERY holding in the group reports it (a partial sum would
 *   understate the basis), tracked by costBasisComplete. The newest asOf in the
 *   group is carried. P/L (gain/percentReturn) is computed per group through the
 *   SHARED holdingBasis helpers (the single source the API DTO mapper and the
 *   client optimistic projection both use), and ONLY when the group's basis is
 *   complete. accountId is carried so a single-account row knows its
 *   (accountId, symbol) edit target; a group spanning >1 account is marked
 *   non-editable (§9.1) so the cost-basis sheet never writes to an ambiguous
 *   account.
 *
 * - totalsByCurrency(): per-currency {marketValue, costBasis, gain, percent}
 *   totals over the grouped positions. P7-7 money discipline: subtotals are
 *   grouped strictly by currency -- a mixed-currency grand total is NEVER
 *   synthesized. This is the SINGLE source for the per-currency totals; the
 *   per-account components/HoldingsTable.tsx consumes totalsByCurrencyHoldings
 *   (the same fold over un-aggregated DTOs) rather than keeping its own copy.
 */
import {
  holdingGainMinor,
  holdingPercentReturn,
} from '@goldfinch/shared/holdingBasis';
import type {
  CurrencyCode,
  DecimalString,
  EpochSeconds,
  HoldingDto,
  MinorUnits,
} from '@goldfinch/shared/types';

/** Mirrors lib/format.ts: a signed integer or fixed-point decimal string. */
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Sum of two exact decimal strings, returned as an exact decimal string.
 *
 * No floats: the two operands are aligned to the longer fractional length,
 * concatenated into integer digit strings, and added with BigInt. Trailing
 * fractional zeros introduced by the alignment are trimmed back off so
 * '10.00' + '5' renders as '15', and '1.5' + '2.25' as '3.75'. Malformed
 * input (anything DECIMAL_RE rejects) is treated as 0 for that operand so a
 * bad upstream value can never throw mid-aggregation.
 */
export function addShares(a: DecimalString, b: DecimalString): DecimalString {
  const left = normalizeDecimal(a);
  const right = normalizeDecimal(b);
  const fracLen = Math.max(left.frac.length, right.frac.length);
  const leftScaled = scaleToBigInt(left, fracLen);
  const rightScaled = scaleToBigInt(right, fracLen);
  const sum = leftScaled + rightScaled;
  return bigIntToDecimal(sum, fracLen);
}

interface ParsedDecimal {
  negative: boolean;
  int: string;
  frac: string;
}

function normalizeDecimal(value: string): ParsedDecimal {
  const trimmed = value.trim();
  if (!DECIMAL_RE.test(trimmed)) {
    return { negative: false, int: '0', frac: '' };
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const dot = unsigned.indexOf('.');
  if (dot === -1) {
    return { negative, int: unsigned, frac: '' };
  }
  return {
    negative,
    int: unsigned.slice(0, dot),
    frac: unsigned.slice(dot + 1),
  };
}

function scaleToBigInt(parsed: ParsedDecimal, fracLen: number): bigint {
  const padded = parsed.frac.padEnd(fracLen, '0');
  const digits = `${parsed.int}${padded}` || '0';
  const magnitude = BigInt(digits);
  return parsed.negative ? -magnitude : magnitude;
}

function bigIntToDecimal(value: bigint, fracLen: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(fracLen + 1, '0');
  const cut = digits.length - fracLen;
  const intPart = digits.slice(0, cut);
  let fracPart = digits.slice(cut).replace(/0+$/, '');
  const sign = negative ? '-' : '';
  return fracPart.length > 0 ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}

export interface AggregatePosition {
  /** Display ticker (undefined when the source rows carry no symbol). */
  symbol?: string;
  /** First-seen description for the group (label under a missing symbol). */
  description: string;
  currency: CurrencyCode;
  /** Total share count across accounts, exact decimal string. */
  shares: DecimalString;
  /** Total market value in integer minor units. */
  marketValueMinor: MinorUnits;
  /** Total cost basis in minor units; valid only when costBasisComplete. */
  costBasisMinor: MinorUnits;
  /** False when ANY holding in the group lacks a cost basis. */
  costBasisComplete: boolean;
  /**
   * The (accountId, symbol) edit target for the cost-basis sheet, present only
   * when this group maps to a SINGLE account (§9.1). undefined when the group
   * spans >1 account (ambiguous edit target) or carries no symbol -- the row is
   * then non-editable.
   */
  accountId?: string;
  /** Whether tapping this row may open the cost-basis sheet (single account + symbol). */
  editable: boolean;
  /**
   * Current price per share for the group, minor units (the per-account DTO
   * value passed through). Only carried when the group has a single holding
   * row, since a per-share price is undefined across heterogeneous lots; absent
   * otherwise so the row shows a dash rather than a misleading blended price.
   */
  currentPriceMinor?: MinorUnits;
  /** Total gain/loss in minor units; present only when costBasisComplete. */
  gainMinor?: MinorUnits;
  /** Signed percent return; present only when costBasisComplete and basis > 0. */
  percentReturn?: number;
  /** Newest snapshot timestamp seen in the group. */
  asOf: EpochSeconds;
  /** Number of distinct underlying holding rows folded into this position. */
  holdingCount: number;
}

export interface CurrencyTotal {
  currency: CurrencyCode;
  marketValueMinor: MinorUnits;
  costBasisMinor: MinorUnits;
  /** False when any position in this currency lacks a complete cost basis. */
  costBasisComplete: boolean;
  /** Total gain/loss in minor units; valid only when costBasisComplete. */
  gainMinor: MinorUnits;
  /** Signed percent return for the currency; present only when complete and basis > 0. */
  percentReturn?: number;
}

/**
 * Stable grouping key. Symboled rows merge by (currency, symbol); unsymboled
 * rows fall back to (currency, `desc:<description>`) so two DIFFERENT unnamed
 * positions never wrongly merge, and two rows for the SAME unnamed position
 * (e.g. the same fund held in two accounts) still combine.
 */
function groupKey(holding: HoldingDto): string {
  const id = holding.symbol ?? `desc:${holding.description}`;
  return `${holding.currency} ${id}`;
}

/**
 * Fold per-account holdings into one position per (currency, symbol), sorted by
 * market value DESCENDING (the default for the Investments tab). Each group's
 * P/L is finalized through the shared holdingBasis helpers once complete.
 */
export function aggregateHoldings(
  holdings: readonly HoldingDto[],
): AggregatePosition[] {
  const groups = new Map<string, AggregatePosition>();
  for (const holding of holdings) {
    const key = groupKey(holding);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        symbol: holding.symbol,
        description: holding.description,
        currency: holding.currency,
        shares: holding.shares,
        marketValueMinor: holding.marketValueMinor,
        costBasisMinor: holding.costBasisMinor ?? 0,
        costBasisComplete: holding.costBasisMinor !== undefined,
        accountId: holding.accountId,
        editable: holding.symbol !== undefined,
        currentPriceMinor: holding.currentPriceMinor,
        asOf: holding.asOf,
        holdingCount: 1,
      });
      continue;
    }
    existing.shares = addShares(existing.shares, holding.shares);
    existing.marketValueMinor += holding.marketValueMinor;
    if (holding.costBasisMinor === undefined) {
      existing.costBasisComplete = false;
    } else {
      existing.costBasisMinor += holding.costBasisMinor;
    }
    // A group spanning more than one account has no single (accountId, symbol)
    // edit target: clear it and disable editing so the sheet never writes to an
    // ambiguous account (§9.1).
    if (holding.accountId !== existing.accountId) {
      existing.accountId = undefined;
      existing.editable = false;
    }
    // A per-share price is only meaningful for a single lot; a blended group
    // drops it (the row shows a dash rather than a misleading price).
    existing.currentPriceMinor = undefined;
    if (holding.asOf > existing.asOf) existing.asOf = holding.asOf;
    existing.holdingCount += 1;
  }
  const positions = [...groups.values()];
  for (const position of positions) finalizePositionPl(position);
  return positions.sort(comparePositions);
}

/**
 * Compute gain/percentReturn for a complete group via the SHARED helpers (the
 * same single source the API DTO mapper uses), leaving both undefined when the
 * group's basis is incomplete so the row shows a dash. Same-currency by
 * construction (the group is keyed on currency).
 */
function finalizePositionPl(position: AggregatePosition): void {
  if (!position.costBasisComplete) return;
  const gainMinor = holdingGainMinor(
    position.marketValueMinor,
    position.costBasisMinor,
  );
  position.gainMinor = gainMinor;
  position.percentReturn = holdingPercentReturn(gainMinor, position.costBasisMinor);
}

/** Sort by market value DESCENDING; ties break by currency then symbol/desc. */
function comparePositions(a: AggregatePosition, b: AggregatePosition): number {
  if (a.marketValueMinor !== b.marketValueMinor) {
    return a.marketValueMinor > b.marketValueMinor ? -1 : 1;
  }
  if (a.currency !== b.currency) return a.currency < b.currency ? -1 : 1;
  const aKey = a.symbol ?? a.description;
  const bKey = b.symbol ?? b.description;
  // Named tickers sort before unsymboled rows within a currency.
  if (a.symbol !== undefined && b.symbol === undefined) return -1;
  if (a.symbol === undefined && b.symbol !== undefined) return 1;
  if (aKey === bKey) return 0;
  return aKey < bKey ? -1 : 1;
}

/**
 * This position's allocation as a fraction of its currency's total market
 * value, returned as a percentage NUMBER (0..100). BigInt math, per-currency
 * (P7-7): `marketValueMinor * 100 / currencyTotalMinor`, truncated toward zero.
 * Returns undefined when the currency total is <= 0 (no meaningful share).
 */
export function allocationPercent(
  position: AggregatePosition,
  currencyTotalMinor: MinorUnits,
): number | undefined {
  if (currencyTotalMinor <= 0) return undefined;
  return Number((BigInt(position.marketValueMinor) * 100n) / BigInt(currencyTotalMinor));
}

/**
 * Per-currency totals over aggregated positions. The SINGLE source for the
 * Investments tab's totals AND (via totalsByCurrencyHoldings) the per-account
 * HoldingsTable. marketValueMinor sums always; costBasisComplete is true for a
 * currency only when every position in it is itself complete, in which case
 * costBasisMinor / gainMinor / percentReturn are the full per-currency figures
 * (gain/percent through the shared helpers). P7-7: never a mixed-currency grand
 * total. Sorted by currency code.
 */
export function totalsByCurrency(
  positions: readonly AggregatePosition[],
): CurrencyTotal[] {
  const map = new Map<CurrencyCode, CurrencyTotal>();
  for (const position of positions) {
    const existing = map.get(position.currency) ?? newCurrencyTotal(position.currency);
    existing.marketValueMinor += position.marketValueMinor;
    if (position.costBasisComplete) {
      existing.costBasisMinor += position.costBasisMinor;
    } else {
      existing.costBasisComplete = false;
    }
    map.set(position.currency, existing);
  }
  return finalizeTotals(map);
}

/**
 * Per-currency totals folded directly over un-aggregated HoldingDto rows (the
 * per-account HoldingsTable shape). Identical accumulation rule to
 * totalsByCurrency so the two surfaces can never diverge (§9.2 single-source).
 */
export function totalsByCurrencyHoldings(
  holdings: readonly HoldingDto[],
): CurrencyTotal[] {
  const map = new Map<CurrencyCode, CurrencyTotal>();
  for (const holding of holdings) {
    const existing = map.get(holding.currency) ?? newCurrencyTotal(holding.currency);
    existing.marketValueMinor += holding.marketValueMinor;
    if (holding.costBasisMinor === undefined) {
      existing.costBasisComplete = false;
    } else {
      existing.costBasisMinor += holding.costBasisMinor;
    }
    map.set(holding.currency, existing);
  }
  return finalizeTotals(map);
}

function newCurrencyTotal(currency: CurrencyCode): CurrencyTotal {
  return {
    currency,
    marketValueMinor: 0,
    costBasisMinor: 0,
    costBasisComplete: true,
    gainMinor: 0,
  };
}

/** Finalize gain/percent for each complete currency total and sort by code. */
function finalizeTotals(map: Map<CurrencyCode, CurrencyTotal>): CurrencyTotal[] {
  const totals = [...map.values()];
  for (const total of totals) {
    if (total.costBasisComplete) {
      total.gainMinor = holdingGainMinor(total.marketValueMinor, total.costBasisMinor);
      total.percentReturn = holdingPercentReturn(total.gainMinor, total.costBasisMinor);
    }
  }
  return totals.sort((a, b) =>
    a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0,
  );
}
