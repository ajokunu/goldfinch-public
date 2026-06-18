/**
 * Typed fetch wrapper for the GoldFinch API.
 *
 * - Attaches the Cognito ACCESS token as the bearer (never the ID token);
 *   the API Gateway JWT authorizer checks audience + the goldfinch/api scope.
 * - On 401: one silent refresh, one retry; if the session is unrecoverable,
 *   clears tokens + the query cache and flips the auth store to signed-out
 *   (which routes the user back to the (auth) group).
 * - Non-2xx responses become typed ApiError instances from the ErrorEnvelope.
 */
import { ENV } from '../config';
import { getFreshAccessToken, refreshTokens } from '../auth/authSession';
import { clearTokens } from '../auth/tokenStore';
import { logger } from '../lib/logger';
import { useAuthStore } from '../state/authStore';
import { ApiError, NotAuthenticatedError, apiErrorFromResponse } from './errors';
import { queryClient } from './queryClient';

export type QueryParams = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export function buildQueryString(query: QueryParams | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

/** Tear down the local session and route back to sign-in. */
export async function forceSignOut(): Promise<void> {
  await clearTokens();
  queryClient.clear();
  useAuthStore.getState().setAuthenticated(false);
}

async function doFetch(
  path: string,
  options: ApiFetchOptions,
  accessToken: string,
): Promise<Response> {
  const url = `${ENV.apiUrl}${path}${buildQueryString(options.query)}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...options.headers,
  };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  return fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body,
    signal: options.signal,
  });
}

/**
 * Perform an authenticated API request and parse the JSON response as T.
 * 204 responses resolve to undefined (type the endpoint accordingly).
 */
export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const accessToken = await getFreshAccessToken();
  if (!accessToken) {
    logger.warn('no usable session for API request; forcing sign-out', { path });
    await forceSignOut();
    throw new NotAuthenticatedError();
  }

  let response = await doFetch(path, options, accessToken);

  if (response.status === 401) {
    const refreshed = await refreshTokens();
    if (!refreshed) {
      logger.warn('401 and token refresh failed; forcing sign-out', { path });
      await forceSignOut();
      throw new NotAuthenticatedError();
    }
    response = await doFetch(path, options, refreshed);
    if (response.status === 401) {
      logger.warn('401 persisted after a fresh token; forcing sign-out', { path });
      await forceSignOut();
      throw await apiErrorFromResponse(response);
    }
  }

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export { ApiError, NotAuthenticatedError };
