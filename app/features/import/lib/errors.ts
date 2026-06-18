/**
 * User-facing message extraction for this feature's mutation errors. Maps
 * the API error codes the import flow can trigger to actionable copy;
 * everything else falls back to the error's own message.
 */
import { ApiError, NotAuthenticatedError } from '../../../src/api/errors';

export function errorMessage(error: unknown): string {
  if (error instanceof NotAuthenticatedError) {
    return 'Session expired. Sign in again.';
  }
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'VALIDATION_ERROR':
        return error.message || 'Some of these values are invalid.';
      case 'NOT_FOUND':
        return 'The target account no longer exists. It may have been removed on another device.';
      case 'ALREADY_EXISTS':
        return 'An account with these details already exists.';
      default:
        return error.message || 'Request failed.';
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}

/** The 400 row index the import route reports in details: { row }. */
export function validationRowIndex(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR') {
    return null;
  }
  const row = error.details?.['row'];
  return typeof row === 'number' && Number.isInteger(row) && row >= 0 ? row : null;
}
