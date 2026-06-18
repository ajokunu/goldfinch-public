/**
 * Identity extraction — the tenancy boundary.
 *
 * The household is ALWAYS re-derived server-side from the `household` claim on
 * the Cognito ACCESS token (already signature-verified by the HTTP API JWT
 * authorizer; never re-verify here, never trust client input). Locked by the
 * Resolved Decisions Log (decision KEY).
 */

import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { HOUSEHOLD_CLAIM } from '@goldfinch/shared/constants';
import { ApiError } from './http.js';

export interface Identity {
  /** Value of the `household` access-token claim (e.g. "goldfinch-home"). */
  household: string;
  /** Cognito subject of the calling user; stamped on manual edits. */
  sub: string;
}

export function getIdentity(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Identity {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const household = claims[HOUSEHOLD_CLAIM];
  if (typeof household !== 'string' || household.length === 0) {
    throw new ApiError(
      401,
      'UNAUTHORIZED',
      'access token is missing the household claim',
    );
  }
  const sub = claims['sub'];
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new ApiError(401, 'UNAUTHORIZED', 'access token is missing the sub claim');
  }
  return { household, sub };
}
