/**
 * Display-name validation — the single source of truth shared by the API
 * route (services/api) and the client editors (Settings field + dashboard
 * greeting sheet). Keeping the rule here means the server and both client
 * entry points can never disagree on what a valid display name is.
 *
 * Rule: trim surrounding whitespace, then the result must be between
 * PROFILE_DISPLAY_NAME_MIN_LENGTH and PROFILE_DISPLAY_NAME_MAX_LENGTH
 * characters inclusive. Counting uses Array.from so an emoji or astral
 * codepoint counts as one character, not its UTF-16 unit length.
 */
import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_DISPLAY_NAME_MIN_LENGTH,
} from './constants.js';

/** Trim surrounding whitespace; the canonical stored form. */
export function normalizeDisplayName(raw: string): string {
  return raw.trim();
}

/** Codepoint length (astral-safe), used for the bounds check. */
export function displayNameLength(raw: string): number {
  return Array.from(normalizeDisplayName(raw)).length;
}

/** True when the trimmed name is within the inclusive length bounds. */
export function isValidDisplayName(raw: string): boolean {
  const length = displayNameLength(raw);
  return (
    length >= PROFILE_DISPLAY_NAME_MIN_LENGTH &&
    length <= PROFILE_DISPLAY_NAME_MAX_LENGTH
  );
}

export type DisplayNameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: 'too-short' | 'too-long' };

/**
 * Validate and normalize in one step. Returns the trimmed value when valid,
 * or a specific reason so callers can render the right message.
 */
export function validateDisplayName(raw: string): DisplayNameValidation {
  const value = normalizeDisplayName(raw);
  const length = Array.from(value).length;
  if (length < PROFILE_DISPLAY_NAME_MIN_LENGTH) {
    return { ok: false, reason: 'too-short' };
  }
  if (length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }
  return { ok: true, value };
}
