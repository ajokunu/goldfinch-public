/**
 * JWT claim fixtures and API Gateway HTTP API v2 event factories.
 *
 * The API contract (master plan sections 8/14, resolved decision D2) is:
 * bearer = Cognito ACCESS token, resource-server scope "goldfinch/api",
 * household ALWAYS re-derived server-side from the `household` claim
 * (value "goldfinch-home"). These fixtures mirror exactly the claim set the
 * API Gateway JWT authorizer hands the Lambda, so handler tests exercise the
 * same identity path production does.
 */

import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  API_SCOPE,
  HOUSEHOLD_CLAIM,
  HOUSEHOLD_ID,
} from '@goldfinch/shared/constants';

/** The two real household members, as stable synthetic Cognito subs. */
export const TEST_SUB_ALEX = '11111111-aaaa-4aaa-8aaa-111111111111';
export const TEST_SUB_TAYLOR = '22222222-bbbb-4bbb-8bbb-222222222222';

export const TEST_ISSUER =
  'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TESTPOOL';
export const TEST_CLIENT_ID = 'test-app-client-id';

/** Deterministic clock for fixtures (claims, item timestamps default off this). */
export const TEST_NOW_ISO = '2026-06-09T12:00:00.000Z';
export const TEST_NOW_EPOCH = Math.floor(Date.parse(TEST_NOW_ISO) / 1000);

export interface JwtClaimsInput {
  /** Defaults to the locked household id "goldfinch-home". */
  household?: string;
  /** Defaults to TEST_SUB_ALEX. */
  sub?: string;
  scope?: string;
  /** Merged last; set a key to undefined-like '' to keep, or use omit list. */
  overrides?: Record<string, string>;
  /** Claim keys to delete after merging (e.g. ['household'] to test 401). */
  omit?: readonly string[];
}

/**
 * Access-token claims as the JWT authorizer presents them (all string-valued).
 * Note: access tokens carry `client_id`, not `aud`.
 */
export function makeJwtClaims(input: JwtClaimsInput = {}): Record<string, string> {
  const claims: Record<string, string> = {
    sub: input.sub ?? TEST_SUB_ALEX,
    [HOUSEHOLD_CLAIM]: input.household ?? HOUSEHOLD_ID,
    scope: input.scope ?? API_SCOPE,
    token_use: 'access',
    client_id: TEST_CLIENT_ID,
    iss: TEST_ISSUER,
    jti: 'test-jti-0001',
    auth_time: String(TEST_NOW_EPOCH),
    iat: String(TEST_NOW_EPOCH),
    exp: String(TEST_NOW_EPOCH + 3600),
    username: input.sub ?? TEST_SUB_ALEX,
    ...(input.overrides ?? {}),
  };
  for (const key of input.omit ?? []) {
    delete claims[key];
  }
  return claims;
}

export interface ApiEventInput {
  /** e.g. "GET /transactions" or "PATCH /transactions/{txnId}". */
  routeKey: string;
  query?: Record<string, string>;
  pathParameters?: Record<string, string>;
  /** JSON-serialized into the event body. */
  body?: unknown;
  /** Full claim replacement; defaults to makeJwtClaims(). */
  claims?: Record<string, string>;
  sub?: string;
  household?: string;
  headers?: Record<string, string>;
}

function buildRawPath(
  routeKey: string,
  pathParameters: Record<string, string> | undefined,
): string {
  const path = routeKey.split(' ')[1] ?? '/';
  return path.replace(/\{(\w+)\}/g, (_match, name: string) => {
    return pathParameters?.[name] ?? `{${name}}`;
  });
}

function buildRawQueryString(query: Record<string, string> | undefined): string {
  if (query === undefined) return '';
  return new URLSearchParams(query).toString();
}

/**
 * Synthetic APIGatewayProxyEventV2WithJWTAuthorizer matching what the HTTP API
 * (payload format 2.0) delivers for a JWT-authorized route.
 */
export function makeApiGatewayEvent(
  input: ApiEventInput,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const { routeKey, query, pathParameters, body } = input;
  const method = routeKey.split(' ')[0] ?? 'GET';
  const rawPath = buildRawPath(routeKey, pathParameters);
  const claims =
    input.claims ??
    makeJwtClaims({ sub: input.sub, household: input.household });
  const scope = claims['scope'];

  const event = {
    version: '2.0',
    routeKey,
    rawPath,
    rawQueryString: buildRawQueryString(query),
    headers: { 'content-type': 'application/json', ...(input.headers ?? {}) },
    queryStringParameters: query,
    pathParameters,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'test-api.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test-api',
      http: {
        method,
        path: rawPath,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'goldfinch-testing',
      },
      requestId: 'test-request-id',
      routeKey,
      stage: '$default',
      time: TEST_NOW_ISO,
      timeEpoch: TEST_NOW_EPOCH * 1000,
      authorizer: {
        principalId: '',
        integrationLatency: 0,
        jwt: {
          claims,
          scopes: scope === undefined ? [] : scope.split(' '),
        },
      },
    },
  };
  return event as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

/** Event whose authorizer carries NO household/sub claims (must yield 401). */
export function makeAnonymousEvent(
  routeKey: string,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return makeApiGatewayEvent({
    routeKey,
    claims: makeJwtClaims({ omit: [HOUSEHOLD_CLAIM, 'sub'] }),
  });
}

/**
 * Set the API Lambda's environment contract (TABLE_NAME etc.) for tests.
 * Returns the table name so tests and the fake table stay in agreement.
 */
export const TEST_TABLE_NAME = 'GoldFinch-test';

export function setApiTestEnv(tableName: string = TEST_TABLE_NAME): string {
  process.env.TABLE_NAME = tableName;
  process.env.GSI1_NAME = 'GSI1';
  process.env.GSI2_NAME = 'GSI2';
  process.env.DEFAULT_TZ = 'America/New_York';
  return tableName;
}
