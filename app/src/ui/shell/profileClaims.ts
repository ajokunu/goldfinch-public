/**
 * Pure mapping from a decoded Cognito ID-token payload to the display
 * identity the shell shows (More-hub profile card, desktop sidebar footer --
 * design-spec shell.md 3.1). Identity is DISPLAY ONLY: the ID token is never
 * sent to the API and claims are never used for authorization.
 *
 * Zero imports: node --test target (src/ui/test/navActive.test.ts).
 */

export interface ProfileClaims {
  /** Display name claim (`name`, else `given_name`); null when absent. */
  name: string | null;
  /** Email claim; null when absent. */
  email: string | null;
  /**
   * Uppercased first character (full code point, so Hangul and astral
   * characters survive) of the name, else of the email; null when neither
   * claim exists.
   */
  initial: string | null;
}

/** The "claims unavailable" rendering: card chrome without identity text. */
export const EMPTY_PROFILE: ProfileClaims = Object.freeze({
  name: null,
  email: null,
  initial: null,
});

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Never throws; junk claim shapes degrade to nulls field-by-field. */
export function profileFromClaims(
  payload: Record<string, unknown>,
): ProfileClaims {
  const email = nonEmptyString(payload['email']);
  const name =
    nonEmptyString(payload['name']) ?? nonEmptyString(payload['given_name']);
  const source = name ?? email;
  const first = source === null ? undefined : Array.from(source)[0];
  return {
    name,
    email,
    initial: first === undefined ? null : first.toLocaleUpperCase(),
  };
}
