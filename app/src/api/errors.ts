/**
 * Typed API error derived from the server's ErrorEnvelope
 * ({ error: { code, message, details? } }) -- see @goldfinch/shared/types.
 */
import type { ApiErrorBody, ErrorEnvelope } from '@goldfinch/shared/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

/** Thrown when a request is attempted with no usable session. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('No authenticated session');
    this.name = 'NotAuthenticatedError';
  }
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const error = (value as { error?: unknown }).error;
  if (error === null || typeof error !== 'object') return false;
  const body = error as { code?: unknown; message?: unknown };
  return typeof body.code === 'string' && typeof body.message === 'string';
}

/** Build an ApiError from a non-2xx response, tolerating non-envelope bodies. */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }
  if (isErrorEnvelope(parsed)) {
    return new ApiError(response.status, parsed.error);
  }
  return new ApiError(response.status, {
    code: response.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR',
    message: `Request failed with status ${response.status}`,
  });
}
