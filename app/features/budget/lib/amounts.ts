/**
 * Money helpers local to the budget feature.
 *
 * House money rules: integers (minor units) for arithmetic, decimal strings at
 * boundaries, never floats. The client imports only @goldfinch/shared/types
 * (the money subpath is Node-oriented), so the two tiny conversions needed on
 * the client live here as pure string/integer math.
 *
 * The ONE place a float division appears is progressFraction/scaleFraction,
 * which produce layout ratios (bar widths/heights) -- not money values.
 */
import type { DecimalString, MinorUnits } from '@goldfinch/shared/types';

/** Integer minor units -> exact decimal string ("12345" -> "123.45"). */
export function minorToDecimalString(
  minor: MinorUnits,
  digits = 2,
): DecimalString {
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`minorToDecimalString: not a safe integer: ${minor}`);
  }
  const negative = minor < 0;
  const abs = String(Math.abs(minor)).padStart(digits + 1, '0');
  const whole = digits === 0 ? abs : abs.slice(0, -digits);
  // The whole fractional suffix (with its dot) in one branch so neither arm
  // is dead code for zero-digit currencies.
  const fracSuffix = digits === 0 ? '' : `.${abs.slice(-digits)}`;
  return `${negative ? '-' : ''}${whole}${fracSuffix}`;
}

const AMOUNT_INPUT_RE = /^\d{1,13}(\.\d{1,2})?$/;

/**
 * Parse a user-typed budget amount into a normalized two-decimal string
 * ("1,250" -> "1250.00"). Returns null when the input is not a plain
 * non-negative amount. Pure string math; no float is ever created.
 */
export function parseAmountInput(raw: string): DecimalString | null {
  // The replace already strips all whitespace, so no separate trim().
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!AMOUNT_INPUT_RE.test(cleaned)) return null;
  // The regex guarantees a leading digit, so indexOf-based splitting keeps
  // every branch reachable (a destructuring default would be dead code).
  const dotIndex = cleaned.indexOf('.');
  const whole = dotIndex === -1 ? cleaned : cleaned.slice(0, dotIndex);
  const frac = dotIndex === -1 ? '' : cleaned.slice(dotIndex + 1);
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
  return `${normalizedWhole}.${frac.padEnd(2, '0')}`;
}

/**
 * Integer percentage used, e.g. 87 for 87%. May exceed 100 when over budget.
 * Returns null when the limit is not positive (no meaningful percentage).
 */
export function percentUsed(
  spentMinor: MinorUnits,
  limitMinor: MinorUnits,
): number | null {
  if (limitMinor <= 0) return null;
  return Math.round((Math.max(0, spentMinor) * 100) / limitMinor);
}

/** Layout-only fill ratio for progress bars, clamped to [0, 1]. */
export function progressFraction(
  spentMinor: MinorUnits,
  limitMinor: MinorUnits,
): number {
  if (limitMinor <= 0) return spentMinor > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, spentMinor) / limitMinor);
}

/** Layout-only ratio of value to a chart's max, clamped to [0, 1]. */
export function scaleFraction(
  valueMinor: MinorUnits,
  maxMinor: MinorUnits,
): number {
  if (maxMinor <= 0) return 0;
  return Math.min(1, Math.max(0, valueMinor) / maxMinor);
}

/**
 * Display-only integer average of a window total (cash-flow stat cards:
 * "Avg income" / "Avg spending"). Integer division, rounded toward the
 * nearest minor unit; never a money value sent to the API.
 */
export function averageMinor(totalMinor: MinorUnits, count: number): MinorUnits {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.round(totalMinor / count);
}

/**
 * Preset chips for the budget editor (design spec screens.md 3.6): current
 * limit, current +50 and +100 whole currency units, and the spent amount
 * rounded up to a whole unit -- integer minor math, deduped, ascending.
 * `digits` is the currency's minor-unit digit count (e.g. 2 for USD).
 * Non-positive entries are dropped (a zero chip is never useful).
 */
export function presetLimitsMinor(args: {
  currentLimitMinor?: MinorUnits;
  spentMinor?: MinorUnits;
  digits: number;
}): MinorUnits[] {
  const { currentLimitMinor, spentMinor, digits } = args;
  const unit = 10 ** Math.max(0, Math.trunc(digits));
  const presets = new Set<number>();
  const base = currentLimitMinor ?? 0;
  // Zero/negative candidates (no current limit, zero spent) are dropped by
  // the single value > 0 filter below -- no per-candidate guards, which
  // would be unreachable shadows of that rule.
  presets.add(base);
  presets.add(base + 50 * unit);
  presets.add(base + 100 * unit);
  if (spentMinor !== undefined) {
    presets.add(Math.ceil(spentMinor / unit) * unit);
  }
  return [...presets].filter((value) => value > 0).sort((a, b) => a - b);
}
