/**
 * Cognito Managed Login OAuth endpoints + redirect URIs.
 *
 * The endpoint set is constructed from the Managed Login domain rather than
 * fetched from the OIDC discovery document: the four Cognito OAuth endpoints
 * are stable, and skipping discovery removes a network round-trip on every
 * sign-in. The discovery document URL is kept for reference in .env.example.
 */
import { makeRedirectUri, type DiscoveryDocument } from 'expo-auth-session';

import { ENV, OAUTH_REDIRECT_PATH, OAUTH_SCHEME, OAUTH_SCOPES } from '../config';

export const discovery: DiscoveryDocument = {
  authorizationEndpoint: `${ENV.cognitoDomain}/oauth2/authorize`,
  tokenEndpoint: `${ENV.cognitoDomain}/oauth2/token`,
  revocationEndpoint: `${ENV.cognitoDomain}/oauth2/revoke`,
  endSessionEndpoint: `${ENV.cognitoDomain}/logout`,
};

export const cognitoClientId = ENV.cognitoClientId;

/** openid email goldfinch/api -- the resource-server scope gates every API route. */
export const oauthScopes: string[] = [...OAUTH_SCOPES];

/**
 * Platform-aware redirect URI:
 * - native: goldfinch://callback (app scheme)
 * - web: <origin>/callback (served by the SPA's (auth)/callback route)
 * Both values must be registered as allowed callback URLs on the Cognito app
 * client (cognito-auth part).
 */
export const redirectUri: string = makeRedirectUri({
  scheme: OAUTH_SCHEME,
  path: OAUTH_REDIRECT_PATH,
});
