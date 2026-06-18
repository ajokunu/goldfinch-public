/**
 * User-facing message extraction for the recurring review mutation. Maps the
 * API error codes this feature can trigger to actionable copy; everything
 * else falls back to the error's own message.
 */
import { ApiError, NotAuthenticatedError } from '../../../src/api/errors';

export function reviewErrorMessage(error: unknown): string {
  if (error instanceof NotAuthenticatedError) {
    return 'Session expired. Sign in again.';
  }
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'NOT_FOUND':
        return 'This series no longer exists; it may have been re-detected. The list was refreshed.';
      case 'VALIDATION_ERROR':
        return error.message || 'That action is not valid for this series.';
      default:
        return error.message || 'Could not update this series.';
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}
