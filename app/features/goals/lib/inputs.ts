/**
 * Form-input parsing local to the goals feature.
 *
 * House money rules: integers (minor units) for arithmetic, decimal strings
 * at boundaries, never floats. Amounts are parsed at the goal currency's
 * minor-unit digit count (P7-7: 0-digit JPY and 3-digit KWD targets parse
 * correctly -- the caller passes minorUnitDigits(currency)).
 *
 * The ONE float division here is progressFraction, which produces a layout
 * ratio (bar width) -- not a money value.
 *
 * Pure and platform-neutral (no react-native imports): exercised directly by
 * node --test in test/inputs.test.ts.
 */
import type { CurrencyCode, DecimalString, MinorUnits } from '@goldfinch/shared/types';

export class GoalInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoalInputError';
  }
}

const MAX_WHOLE_DIGITS = 13;
/** Sanity bound for minor-unit digit counts (ISO 4217 tops out at 4). */
const MAX_FRACTION_DIGITS = 6;

/**
 * Parse a user-typed non-negative amount into the canonical decimal string
 * at `digits` fraction digits ("1,250" -> "1250.00"; digits 0: "5000" ->
 * "5000"). Returns null when the input is not a plain non-negative amount at
 * that scale. Pure string math; no float is ever created.
 */
export function parseAmountInput(raw: string, digits = 2): DecimalString | null {
  if (!Number.isInteger(digits) || digits < 0 || digits > MAX_FRACTION_DIGITS) {
    throw new GoalInputError(`parseAmountInput: invalid digits: ${digits}`);
  }
  const cleaned = raw.trim().replace(/[$,\s]/g, '');
  const pattern =
    digits === 0
      ? new RegExp(`^\\d{1,${MAX_WHOLE_DIGITS}}$`)
      : new RegExp(`^\\d{1,${MAX_WHOLE_DIGITS}}(\\.\\d{1,${digits}})?$`);
  if (!pattern.test(cleaned)) return null;
  const [whole = '0', frac = ''] = cleaned.split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
  return digits === 0
    ? normalizedWhole
    : `${normalizedWhole}.${frac.padEnd(digits, '0')}`;
}

/** True for a canonical zero ("0", "0.00", ...) from parseAmountInput. */
export function isZeroDecimal(value: DecimalString): boolean {
  return /^0+(\.0+)?$/.test(value);
}

/**
 * Apply the contribution direction to a parsed non-negative amount.
 * Withdrawals are negative contributions per the API contract
 * (GoalContributionDto.amount is signed).
 */
export function signedContributionAmount(
  amount: DecimalString,
  direction: 'add' | 'withdraw',
): DecimalString {
  return direction === 'withdraw' ? `-${amount}` : amount;
}

/** Normalize a typed ISO 4217 code ("usd" -> "USD"); null when malformed. */
export function parseCurrencyCodeInput(raw: string): CurrencyCode | null {
  const trimmed = raw.trim();
  return /^[A-Za-z]{3}$/.test(trimmed) ? trimmed.toUpperCase() : null;
}

/** Layout-only fill ratio for goal progress bars, clamped to [0, 1]. */
export function progressFraction(
  progressMinor: MinorUnits,
  targetMinor: MinorUnits,
): number {
  if (targetMinor <= 0) return progressMinor > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, progressMinor) / targetMinor);
}
