/**
 * Money helpers: integer minor units (cents) for all arithmetic, exact decimal
 * strings at API boundaries. No floats, no parseFloat, anywhere.
 *
 * Parsing/serialization is done with string and BigInt math; results are returned
 * as plain numbers only after a Number.isSafeInteger check.
 */

import type { CurrencyCode, DecimalString, MinorUnits } from './types/common.js';

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** ISO-4217 currencies with 0 minor-unit digits. */
const ZERO_DIGIT_CURRENCIES: ReadonlySet<string> = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** ISO-4217 currencies with 3 minor-unit digits. */
const THREE_DIGIT_CURRENCIES: ReadonlySet<string> = new Set([
  'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
]);

/**
 * Minor-unit digits for a currency (2 for the default case, e.g. USD cents).
 * Non-ISO inputs (SimpleFIN may send a URL for non-fiat) fall back to 2.
 */
export function minorUnitDigits(currency: CurrencyCode): number {
  const code = currency.toUpperCase();
  if (ZERO_DIGIT_CURRENCIES.has(code)) return 0;
  if (THREE_DIGIT_CURRENCIES.has(code)) return 3;
  return 2;
}

/** Throws unless `value` is a safe integer (i.e. valid minor units). */
export function assertMinorUnits(
  value: number,
  label = 'amount',
): asserts value is MinorUnits {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new MoneyError(
      `${label} must be a safe integer in minor units, got ${String(value)}`,
    );
  }
}

function assertDigits(digits: number): void {
  if (!Number.isInteger(digits) || digits < 0 || digits > 8) {
    throw new MoneyError(`minor-unit digits must be an integer in [0, 8], got ${String(digits)}`);
  }
}

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/**
 * Parse an exact decimal string (e.g. "-45.99") into integer minor units.
 * Rejects floats-in-disguise: scientific notation, NaN, more significant
 * fractional digits than the scale allows, and anything non-numeric.
 */
export function parseDecimalString(value: string, digits = 2): MinorUnits {
  assertDigits(digits);
  if (typeof value !== 'string') {
    throw new MoneyError(`expected a decimal string, got ${typeof value}`);
  }
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) {
    throw new MoneyError(`not a decimal string: "${value}"`);
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const intPart = match[2]!;
  const fracRaw = match[3] ?? '';
  if (fracRaw.length > digits && /[1-9]/.test(fracRaw.slice(digits))) {
    throw new MoneyError(
      `"${value}" has more than ${digits} significant fractional digits`,
    );
  }
  const frac = fracRaw.slice(0, digits).padEnd(digits, '0');
  const minorBig =
    sign * (BigInt(intPart) * 10n ** BigInt(digits) + BigInt(frac === '' ? '0' : frac));
  const minor = Number(minorBig);
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError(`"${value}" exceeds the safe integer range in minor units`);
  }
  return minor;
}

/** Parse a decimal string using the currency's minor-unit scale. */
export function parseCurrencyAmount(
  value: string,
  currency: CurrencyCode,
): MinorUnits {
  return parseDecimalString(value, minorUnitDigits(currency));
}

/**
 * Render integer minor units as an exact decimal string, e.g. -4599 -> "-45.99".
 * Lossless inverse of parseDecimalString at the same scale.
 */
export function toDecimalString(minor: MinorUnits, digits = 2): DecimalString {
  assertMinorUnits(minor);
  assertDigits(digits);
  const negative = minor < 0;
  const abs = BigInt(Math.abs(minor));
  if (digits === 0) {
    return `${negative ? '-' : ''}${abs.toString()}`;
  }
  const base = 10n ** BigInt(digits);
  const intPart = (abs / base).toString();
  const fracPart = (abs % base).toString().padStart(digits, '0');
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

/** Render minor units as a decimal string using the currency's scale. */
export function toCurrencyDecimalString(
  minor: MinorUnits,
  currency: CurrencyCode,
): DecimalString {
  return toDecimalString(minor, minorUnitDigits(currency));
}

/** Overflow-checked integer sum. */
export function addMinor(...values: MinorUnits[]): MinorUnits {
  let total = 0n;
  for (const value of values) {
    assertMinorUnits(value);
    total += BigInt(value);
  }
  const result = Number(total);
  if (!Number.isSafeInteger(result)) {
    throw new MoneyError('sum exceeds the safe integer range in minor units');
  }
  return result;
}

export function negateMinor(value: MinorUnits): MinorUnits {
  assertMinorUnits(value);
  // -0 normalization: negating 0 stays 0.
  return value === 0 ? 0 : -value;
}

/** Sign test that works on either boundary representation without parsing to float. */
export function isNegativeAmount(value: DecimalString | MinorUnits): boolean {
  if (typeof value === 'number') {
    assertMinorUnits(value);
    return value < 0;
  }
  // Validates the string and relies on the canonical sign position.
  parseDecimalString(value, 8);
  return value.trim().startsWith('-');
}

/**
 * Locale/currency display formatting for the render edge, e.g. -4599 ->
 * "-$45.99". The exact decimal string is handed to Intl.NumberFormat (string
 * inputs are supported since ES2023 / Node 20), so no float ever exists.
 */
export function formatMinor(
  minor: MinorUnits,
  currency: CurrencyCode,
  locale = 'en-US',
): string {
  const decimal = toDecimalString(minor, minorUnitDigits(currency));
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  });
  // TS lib ES2022 types format() as number | bigint; the runtime (ES2023+)
  // accepts exact decimal strings. Widen the signature rather than parse a float.
  const format = formatter.format as (value: number | bigint | string) => string;
  return format(decimal);
}
