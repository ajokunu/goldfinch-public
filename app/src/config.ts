/**
 * Client runtime configuration and shell constants.
 *
 * EXPO_PUBLIC_* variables are statically inlined by Expo at bundle time, so
 * they must be referenced as literal `process.env.EXPO_PUBLIC_X` expressions.
 *
 * Policy note (updated Phase 7): the client imports types from
 * `@goldfinch/shared/types` plus the platform-neutral runtime subpaths
 * (`/money`, `/csv`, `/rules`, `/budgetMath`, `/logger` -- no node:* imports).
 * Auth-critical constants below predate that policy and stay mirrored here in
 * sync with @goldfinch/shared/constants.
 */

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export const ENV = {
  /** Base URL of the API Gateway HTTP API (no trailing slash). */
  apiUrl: stripTrailingSlash(process.env.EXPO_PUBLIC_API_URL ?? ''),
  /** Cognito Managed Login domain origin, e.g. https://x.auth.us-east-1.amazoncognito.com */
  cognitoDomain: stripTrailingSlash(process.env.EXPO_PUBLIC_COGNITO_DOMAIN ?? ''),
  /** Cognito app client id (== JWT authorizer audience). */
  cognitoClientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID ?? '',
  /** Optional override for the EAS project id used by push registration. */
  easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
} as const;

/** Mirrors API_SCOPE in @goldfinch/shared/constants (types-only import policy). */
export const API_SCOPE = 'goldfinch/api';

/** Scopes requested from Cognito Managed Login. */
export const OAUTH_SCOPES = ['openid', 'email', API_SCOPE] as const;

/** Deep-link scheme + path for the native OAuth redirect (goldfinch://callback). */
export const OAUTH_SCHEME = 'goldfinch';
export const OAUTH_REDIRECT_PATH = 'callback';

/**
 * Biometric re-lock inactivity window. The gate locks on cold start and when
 * the app returns to the foreground after being away longer than this -- NOT
 * on every background blip (master plan section 12, decision 7; window widened
 * to 5 minutes per the shell spec).
 */
export const LOCK_AFTER_MS = 5 * 60 * 1000;

/** Refresh the access token when it has less than this many seconds left. */
export const TOKEN_REFRESH_SKEW_SECONDS = 60;

/**
 * SecureStore key names. The Cognito token triple is split across keys so each
 * value stays under SecureStore's 2048-byte-per-entry guidance.
 */
export const SECURE_KEYS = {
  accessToken: 'gf.accessToken',
  refreshToken: 'gf.refreshToken',
  idToken: 'gf.idToken',
  /** Non-token preferences (theme override, biometric toggle, device id). */
  prefs: 'gf.prefs',
  deviceId: 'gf.deviceId',
} as const;

/** TanStack Query defaults (master plan section 12 configuration values). */
export const QUERY_STALE_TIME_MS = 30_000;
export const QUERY_GC_TIME_MS = 300_000;
