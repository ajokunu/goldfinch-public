/**
 * App API Lambda entry point. One function, internal routing by routeKey.
 *
 * Error mapping: ApiError -> its status/code; CursorError -> 400 BAD_CURSOR;
 * KeyError/MoneyError/CsvError/RuleMatchError -> 400 VALIDATION_ERROR; anything
 * else is logged (shared structured logger, P7-10) with the requestId and
 * returned as a generic 500 (no internals leak to the client).
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { CursorError } from '@goldfinch/shared/cursor';
import { CsvError } from '@goldfinch/shared/csv';
import { KeyError } from '@goldfinch/shared/keys';
import { MoneyError } from '@goldfinch/shared/money';
import { RuleMatchError } from '@goldfinch/shared/rules';
import { ApiError, errorResponse } from './http.js';
import { logger } from './logger.js';
import { routes } from './router.js';

function toErrorResponse(
  err: unknown,
  requestId: string,
  routeKey: string,
): APIGatewayProxyStructuredResultV2 {
  if (err instanceof ApiError) {
    return errorResponse(err.status, err.code, err.message, err.details);
  }
  if (err instanceof CursorError) {
    return errorResponse(400, 'BAD_CURSOR', err.message);
  }
  if (
    err instanceof KeyError ||
    err instanceof MoneyError ||
    err instanceof CsvError ||
    err instanceof RuleMatchError
  ) {
    return errorResponse(400, 'VALIDATION_ERROR', err.message);
  }
  logger.error('unhandled error', { requestId, routeKey, err });
  return errorResponse(500, 'INTERNAL_ERROR', 'internal server error');
}

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const requestId = event.requestContext?.requestId ?? 'unknown';
  try {
    const route = routes[event.routeKey];
    if (route === undefined) {
      return errorResponse(404, 'NOT_FOUND', `no handler for route "${event.routeKey}"`);
    }
    return await route(event);
  } catch (err) {
    return toErrorResponse(err, requestId, event.routeKey);
  }
};
