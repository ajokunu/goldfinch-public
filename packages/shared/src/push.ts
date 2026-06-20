/**
 * Expo push-token format guard — the single source of truth for what a valid
 * "ExponentPushToken[...]" / "ExpoPushToken[...]" string looks like. Enforced at
 * BOTH ends of the contract: the API write path (services/api) rejects a
 * malformed token at registration time with a 400, and the notifications
 * fan-out (services/notifications) defends legacy/pre-existing DynamoDB rows by
 * disabling any token that no longer matches. Keeping the pattern here means the
 * two cannot drift.
 *
 * Pure module: no I/O, no dependencies.
 */

/** The Expo relay's token shape: at least one non-`]`/non-whitespace char in brackets. */
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[^\]\s]+\]$/;

/** True for "ExponentPushToken[...]" / "ExpoPushToken[...]" strings. */
export function isExpoPushToken(token: unknown): token is string {
  return typeof token === 'string' && EXPO_PUSH_TOKEN_PATTERN.test(token);
}
