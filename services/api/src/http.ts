/**
 * HTTP response/request helpers. Every non-2xx body is the ErrorEnvelope from
 * @goldfinch/shared. The Lambda NEVER sets CORS headers — the HTTP API owns
 * CORS, and duplicate headers break RN Web (master plan section 8).
 */

import { Buffer } from 'node:buffer';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import type { ErrorCode, ErrorEnvelope } from '@goldfinch/shared/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | (string & {}),
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export function json(
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

export function noContent(): APIGatewayProxyStructuredResultV2 {
  return { statusCode: 204 };
}

export function errorResponse(
  status: number,
  code: ErrorCode | (string & {}),
  message: string,
  details?: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  const envelope: ErrorEnvelope = {
    error: details === undefined ? { code, message } : { code, message, details },
  };
  return json(status, envelope);
}

/** Parse the JSON request body; 400 VALIDATION_ERROR on anything malformed. */
export function parseJsonBody(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Record<string, unknown> {
  if (event.body === undefined || event.body === null || event.body.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'request body is required');
  }
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'request body is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function requirePathParam(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  name: string,
): string {
  const value = event.pathParameters?.[name];
  if (value === undefined || value.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `missing path parameter "${name}"`);
  }
  return decodeURIComponent(value);
}
