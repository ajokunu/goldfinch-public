/**
 * Tiny hand-rolled validators (no schema library — keeps the bundle minimal per
 * master plan section 8 decision 2). Every failure is a 400 VALIDATION_ERROR.
 */

import {
  CATEGORY_COLOR_KEYS,
  GLYPH_KEYS,
  isCategoryColorKey,
  isGlyphKey,
} from '@goldfinch/shared/categoryStyle';
import { MAX_TEXT_LENGTHS, type MaxTextLengthField } from '@goldfinch/shared/constants';
import {
  BUDGET_PERIODS,
  type BudgetPeriod,
  isBudgetPeriod,
} from '@goldfinch/shared/types';
import { ApiError } from './http.js';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function requireIsoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a yyyy-mm-dd date`);
  }
  return value;
}

export function requireIsoMonth(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ISO_MONTH_PATTERN.test(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a yyyy-mm month`);
  }
  return value;
}

export function reqString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a non-empty string`);
  }
  return value;
}

export function optString(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a string`);
  }
  return value;
}

/** Like optString but preserves an explicit null (e.g. clearing groupId). */
export function optNullableString(
  body: Record<string, unknown>,
  field: string,
): string | null | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a string or null`);
  }
  return value;
}

/**
 * Enforce a server-side maximum length on an already-extracted free-text value
 * (the route trims/normalizes first, so this checks exactly what is stored).
 * Over-length -> 400 VALIDATION_ERROR. `max` is taken from the shared
 * MAX_TEXT_LENGTHS contract so client and server can never disagree.
 *
 * Returns the value unchanged for ergonomic chaining, e.g.
 *   const name = assertMaxLength(reqString(body, 'name').trim(), 'name', 'categoryName');
 */
export function assertMaxLength(
  value: string,
  field: string,
  bound: MaxTextLengthField,
): string {
  const max = MAX_TEXT_LENGTHS[bound];
  if (value.length > max) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${field} must be at most ${max} characters`,
      { maxLength: max },
    );
  }
  return value;
}

/**
 * Required free-text field with a server-side length cap. Combines reqString
 * (non-empty), an optional trim, and assertMaxLength so a route declares the
 * bound in one call. Trimming is on by default to match how every free-text
 * field is persisted (trimmed); pass `{ trim: false }` only when the route
 * stores the raw value.
 */
export function reqText(
  body: Record<string, unknown>,
  field: string,
  bound: MaxTextLengthField,
  options: { trim?: boolean } = {},
): string {
  const raw = reqString(body, field);
  const value = options.trim === false ? raw : raw.trim();
  return assertMaxLength(value, field, bound);
}

/**
 * Optional free-text field with a server-side length cap. Absent (undefined or
 * null) returns undefined; present is type-checked, optionally trimmed, and
 * length-validated. Mirrors optString plus the bound.
 */
export function optText(
  body: Record<string, unknown>,
  field: string,
  bound: MaxTextLengthField,
  options: { trim?: boolean } = {},
): string | undefined {
  const value = optString(body, field);
  if (value === undefined) return undefined;
  const next = options.trim === false ? value : value.trim();
  return assertMaxLength(next, field, bound);
}

export function optBool(
  body: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a boolean`);
  }
  return value;
}

export function reqInt(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be an integer`);
  }
  return value;
}

export function optInt(
  body: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be an integer`);
  }
  return value;
}

/**
 * P10-1: optional curated glyph key for a category icon. Validated against the
 * shared GLYPH_KEYS set via {@link isGlyphKey} — never a hand-rolled list, so
 * request validation can never drift from the contract. Absent (undefined or
 * null) returns undefined so the caller preserves today's auto behavior; an
 * unknown key is a 400 VALIDATION_ERROR that lists the valid keys.
 */
export function optGlyphKey(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!isGlyphKey(value)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${field} must be a known glyph key`,
      { valid: [...GLYPH_KEYS] },
    );
  }
  return value;
}

/**
 * P10-1: optional category palette KEY ('c1'..'c0' | 'other'). Validated against
 * the shared CATEGORY_COLOR_KEYS set via {@link isCategoryColorKey} — never a
 * hand-rolled list. Absent returns undefined (caller preserves the deterministic
 * hash pick); an unknown key is a 400 VALIDATION_ERROR that lists the valid keys.
 */
export function optCategoryColorKey(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!isCategoryColorKey(value)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${field} must be a known category color key`,
      { valid: [...CATEGORY_COLOR_KEYS] },
    );
  }
  return value;
}

/**
 * P11-3: optional budget period ('weekly' | 'monthly' | 'yearly'). Validated
 * against the shared BUDGET_PERIODS set via {@link isBudgetPeriod} — never a
 * hand-rolled list, so request validation cannot drift from the contract.
 * Absent (undefined or null) returns undefined so the caller applies its own
 * default (POST defaults to 'monthly'; PATCH leaves the stored period unchanged);
 * an unknown value is a 400 VALIDATION_ERROR that lists the valid periods.
 */
export function optBudgetPeriod(
  body: Record<string, unknown>,
  field: string,
): BudgetPeriod | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!isBudgetPeriod(value)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `${field} must be a known budget period`,
      { valid: [...BUDGET_PERIODS] },
    );
  }
  return value;
}
