/**
 * Pure display helpers for the restyled Activity screen (screens.md 2.3/2.4).
 *
 * No react-native or app imports: this module is node --test- and
 * StrykerJS-testable. Date strings are compared, never parsed -- the caller
 * supplies today/yesterday ISO dates from app/src/lib/dates helpers.
 */

export type DayHeadingKind = 'today' | 'yesterday' | 'other';

/**
 * Classify a yyyy-mm-dd section date against the current wall-clock day so
 * the component can render t('Today') / t('Yesterday') / formatDateHeading.
 */
export function dayHeadingKind(
  date: string,
  todayIso: string,
  yesterdayIso: string,
): DayHeadingKind {
  if (date === todayIso) return 'today';
  if (date === yesterdayIso) return 'yesterday';
  return 'other';
}

/**
 * True when a DecimalString amount is strictly positive. Income rows render
 * in `pos` with an explicit '+' (screens.md 2.3); zero and negative do not.
 * Defensive on malformed input: anything without a nonzero digit is not
 * positive.
 */
export function isPositiveDecimal(amount: string): boolean {
  const trimmed = amount.trim();
  if (trimmed.startsWith('-')) return false;
  return /[1-9]/.test(trimmed);
}

/**
 * Token initial: first character of the payee, uppercased; '?' for empty
 * (components.md 5.1 `letter()`).
 */
export function initialOf(value: string): string {
  const first = value.trim().charAt(0);
  return first === '' ? '?' : first.toUpperCase();
}
