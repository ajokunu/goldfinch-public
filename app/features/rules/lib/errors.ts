/**
 * User-facing message extraction for rule mutation errors. Maps the API error
 * codes this feature can trigger to actionable copy; everything else falls
 * back to the error's own message. (Same shape as the budget feature's
 * helper; features stay decoupled, so each owns its own copy/mapping.)
 */
import { ApiError, NotAuthenticatedError } from '../../../src/api/errors';

export function errorMessage(error: unknown): string {
  if (error instanceof NotAuthenticatedError) {
    return 'Session expired. Sign in again.';
  }
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'VERSION_CONFLICT':
        return 'This rule was changed on another device. The latest values were reloaded; close and reopen to edit them.';
      case 'NOT_FOUND':
        return 'This rule no longer exists. It may have been deleted on another device.';
      case 'VALIDATION_ERROR':
        return error.message || 'Some of these values are invalid.';
      default:
        return error.message || 'Request failed.';
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}

export function isVersionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'VERSION_CONFLICT';
}
