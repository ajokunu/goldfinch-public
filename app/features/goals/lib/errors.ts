/**
 * User-facing message extraction for goal mutation errors. Maps the API
 * error codes this feature can trigger to actionable copy; everything else
 * falls back to the error's own message.
 */
import { ApiError, NotAuthenticatedError } from '../../../src/api/errors';

export function errorMessage(error: unknown): string {
  if (error instanceof NotAuthenticatedError) {
    return 'Session expired. Sign in again.';
  }
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'VERSION_CONFLICT':
        return 'This goal was changed on another device. The latest values were reloaded; try again.';
      case 'NOT_FOUND':
        return 'This goal no longer exists. It may have been deleted on another device.';
      case 'VALIDATION_ERROR':
        return error.message || 'Some of these values are invalid.';
      default:
        return error.message || 'Request failed.';
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}
