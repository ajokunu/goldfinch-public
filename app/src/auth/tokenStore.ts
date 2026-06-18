/**
 * Hardware-backed storage for the Cognito token triple, split across three
 * SecureStore keys (gf.accessToken / gf.refreshToken / gf.idToken) so each
 * entry stays under the 2048-byte SecureStore guidance.
 *
 * The ID token is stored for client-side display claims only (e.g. email);
 * it is NEVER sent to the API -- the API bearer is always the access token.
 */
import { SECURE_KEYS } from '../config';
import { secureStorage } from '../lib/storage';

export interface TokenTriple {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
}

export async function getAccessToken(): Promise<string | null> {
  return secureStorage.getItem(SECURE_KEYS.accessToken);
}

export async function getRefreshToken(): Promise<string | null> {
  return secureStorage.getItem(SECURE_KEYS.refreshToken);
}

export async function getIdToken(): Promise<string | null> {
  return secureStorage.getItem(SECURE_KEYS.idToken);
}

/**
 * Persist a token set. A missing refresh token (Cognito refresh responses do
 * not rotate the refresh token by default) leaves the stored one untouched.
 */
export async function setTokens(tokens: {
  accessToken: string;
  refreshToken?: string | null;
  idToken?: string | null;
}): Promise<void> {
  await secureStorage.setItem(SECURE_KEYS.accessToken, tokens.accessToken);
  if (tokens.refreshToken) {
    await secureStorage.setItem(SECURE_KEYS.refreshToken, tokens.refreshToken);
  }
  if (tokens.idToken) {
    await secureStorage.setItem(SECURE_KEYS.idToken, tokens.idToken);
  }
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    secureStorage.removeItem(SECURE_KEYS.accessToken),
    secureStorage.removeItem(SECURE_KEYS.refreshToken),
    secureStorage.removeItem(SECURE_KEYS.idToken),
  ]);
}
