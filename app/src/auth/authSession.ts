/**
 * OAuth 2.0 Authorization Code + PKCE against Cognito Managed Login via
 * expo-auth-session (master plan section 12, decision 4).
 *
 * Exposes:
 * - signIn():            launches Managed Login, exchanges the code, persists tokens
 * - refreshTokens():     silent refresh (deduplicated across concurrent callers)
 * - getFreshAccessToken(): access token with automatic near-expiry refresh
 * - signOut():           best-effort refresh-token revocation + local clear
 */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import { TOKEN_REFRESH_SKEW_SECONDS } from '../config';
import { jwtSecondsRemaining } from '../lib/jwt';
import { logger } from '../lib/logger';
import { cognitoClientId, discovery, oauthScopes, redirectUri } from './cognito';
import * as tokenStore from './tokenStore';

// Required so the web popup flow can complete when the callback page loads.
WebBrowser.maybeCompleteAuthSession();

export type SignInResult =
  | { status: 'success' }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

async function persistTokenResponse(
  response: AuthSession.TokenResponse,
): Promise<void> {
  await tokenStore.setTokens({
    accessToken: response.accessToken,
    refreshToken: response.refreshToken ?? null,
    idToken: response.idToken ?? null,
  });
}

/**
 * Launch Cognito Managed Login (system browser / popup), then exchange the
 * authorization code for the token triple using the PKCE verifier.
 */
export async function signIn(): Promise<SignInResult> {
  const request = new AuthSession.AuthRequest({
    clientId: cognitoClientId,
    scopes: oauthScopes,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
  });

  const result = await request.promptAsync(discovery);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { status: 'cancelled' };
  }
  if (result.type !== 'success') {
    return { status: 'error', message: `Sign-in failed (${result.type})` };
  }
  const code = result.params['code'];
  if (!code) {
    return {
      status: 'error',
      message: result.params['error_description'] ?? 'No authorization code returned',
    };
  }

  try {
    const tokenResponse = await AuthSession.exchangeCodeAsync(
      {
        clientId: cognitoClientId,
        code,
        redirectUri,
        extraParams: { code_verifier: request.codeVerifier ?? '' },
      },
      discovery,
    );
    await persistTokenResponse(tokenResponse);
    return { status: 'success' };
  } catch (error) {
    logger.error('OAuth code exchange failed', { error });
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Token exchange failed',
    };
  }
}

let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchange the stored refresh token for a new access (+ id) token. Returns the
 * new access token, or null when no session can be restored. Concurrent calls
 * share one network exchange.
 */
export function refreshTokens(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = await tokenStore.getRefreshToken();
  if (!refreshToken) return null;
  try {
    const response = await AuthSession.refreshAsync(
      { clientId: cognitoClientId, refreshToken },
      discovery,
    );
    await persistTokenResponse(response);
    return response.accessToken;
  } catch (error) {
    // Refresh token expired or revoked; the caller decides to sign out.
    logger.warn('silent token refresh failed; session cannot be restored', {
      error,
    });
    return null;
  }
}

/**
 * Return an access token that is valid for at least TOKEN_REFRESH_SKEW_SECONDS,
 * refreshing silently when needed. Null means the session is gone.
 */
export async function getFreshAccessToken(): Promise<string | null> {
  const accessToken = await tokenStore.getAccessToken();
  if (accessToken) {
    const remaining = jwtSecondsRemaining(accessToken);
    if (remaining !== null && remaining > TOKEN_REFRESH_SKEW_SECONDS) {
      return accessToken;
    }
  }
  return refreshTokens();
}

/**
 * Best-effort restore on cold start: reuse a still-valid access token, else
 * silently refresh. Returns true when a session exists.
 */
export async function restoreSession(): Promise<boolean> {
  const token = await getFreshAccessToken();
  return token !== null;
}

/**
 * Sign out: revoke the refresh token at Cognito (best effort -- revoking the
 * refresh token also invalidates the access tokens it minted), then clear the
 * stored triple. The Managed Login browser cookie is intentionally left alone;
 * the next sign-in simply re-prompts.
 */
export async function signOut(): Promise<void> {
  const refreshToken = await tokenStore.getRefreshToken();
  if (refreshToken && discovery.revocationEndpoint) {
    try {
      await AuthSession.revokeAsync(
        { clientId: cognitoClientId, token: refreshToken },
        discovery,
      );
    } catch (error) {
      // Network failure must not block local sign-out.
      logger.warn('refresh token revocation failed; clearing local tokens anyway', {
        error,
      });
    }
  }
  await tokenStore.clearTokens();
}
