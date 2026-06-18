/**
 * Structurally valid (header.payload.signature) but UNSIGNED Cognito-shaped
 * JWTs for e2e auth injection. The web client only base64url-decodes the
 * payload to read `exp` (app/src/lib/jwt.ts) and display claims
 * (app/src/ui/shell/profileClaims.ts); signatures are verified server-side
 * only, and every API call in these tests is route-mocked, so a fabricated
 * signature never reaches a verifier.
 */

function base64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'e2e-fixture-key' };
  return [
    base64Url(JSON.stringify(header)),
    base64Url(JSON.stringify(payload)),
    base64Url('e2e-fixture-signature'),
  ].join('.');
}

export interface FixtureIdentity {
  sub: string;
  email: string;
  givenName: string;
  fullName: string;
}

/** Display-only identity; deliberately fictional (never a real user). */
export const FIXTURE_IDENTITY: FixtureIdentity = {
  sub: '7c1f3e02-e2e0-4e2e-9a51-aaaaaaaaaaaa',
  email: 'robin@goldfinch.test',
  givenName: 'Robin',
  fullName: 'Robin Finch',
};

export interface TokenTriple {
  accessToken: string;
  refreshToken: string;
  idToken: string;
}

/**
 * Cognito-shaped token triple valid for one hour from `now`. The access token
 * must stay above TOKEN_REFRESH_SKEW_SECONDS (60s) of remaining life for the
 * whole run or the client would attempt a silent refresh against the real
 * Cognito domain.
 */
export function buildTokenTriple(
  clientId: string,
  now: Date = new Date(),
): TokenTriple {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + 3600;
  const iss =
    'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_e2eFixture';

  const accessToken = encodeJwt({
    sub: FIXTURE_IDENTITY.sub,
    iss,
    client_id: clientId,
    origin_jti: 'e2e-origin-jti',
    event_id: 'e2e-event-id',
    token_use: 'access',
    scope: 'openid email goldfinch/api',
    auth_time: iat,
    exp,
    iat,
    jti: 'e2e-access-jti',
    username: FIXTURE_IDENTITY.sub,
  });

  const idToken = encodeJwt({
    sub: FIXTURE_IDENTITY.sub,
    iss,
    aud: clientId,
    token_use: 'id',
    email: FIXTURE_IDENTITY.email,
    email_verified: true,
    given_name: FIXTURE_IDENTITY.givenName,
    name: FIXTURE_IDENTITY.fullName,
    'cognito:username': FIXTURE_IDENTITY.sub,
    auth_time: iat,
    exp,
    iat,
    jti: 'e2e-id-jti',
  });

  return {
    accessToken,
    // Cognito refresh tokens are opaque; any non-empty string is shape-true.
    refreshToken: 'e2e-fixture-refresh-token',
    idToken,
  };
}
