/** Shared scalar aliases and the API error envelope. */

/** Calendar date, `yyyy-mm-dd` (lexicographic order == chronological order). */
export type IsoDate = string;

/** Calendar month, `yyyy-mm`. */
export type IsoMonth = string;

/** Full ISO-8601 timestamp with `Z` suffix, e.g. `2026-06-09T05:00:12Z`. */
export type IsoTimestamp = string;

/** Unix epoch seconds (SimpleFIN's native timestamp unit). */
export type EpochSeconds = number;

/**
 * Exact decimal money rendering, e.g. `"-45.99"`. Used at API boundaries.
 * Never parse with parseFloat — use `parseDecimalString` from `@goldfinch/shared/money`.
 */
export type DecimalString = string;

/**
 * Integer minor units (cents for 2-digit currencies). The authoritative arithmetic
 * representation everywhere in GoldFinch. Always a safe integer, never a float.
 */
export type MinorUnits = number;

/** ISO-4217 currency code (SimpleFIN may also send a URL for non-fiat; carried as-is). */
export type CurrencyCode = string;

/** Canonical machine-readable error codes used in the error envelope. */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_CURSOR'
  | 'RANGE_TOO_LARGE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'VERSION_CONFLICT'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  /** Known codes above; `(string & {})` keeps the union open for forward compatibility. */
  code: ErrorCode | (string & {});
  message: string;
  /** Optional structured detail (e.g. flattened field errors on VALIDATION_ERROR). */
  details?: Record<string, unknown>;
}

/** Every non-2xx API response body. */
export interface ErrorEnvelope {
  error: ApiErrorBody;
}
