/**
 * The app-side structured logger (P7-10): a thin instantiation of the shared
 * platform-neutral logger from @goldfinch/shared/logger.
 *
 * - JSON lines through the matching console method, so Metro / browser
 *   devtools level filters work.
 * - debug lines are silenced in production builds only (__DEV__ false);
 *   info/warn/error always emit.
 * - Every fire-and-forget call site in the app MUST report failures through
 *   this logger (house rule: no silent void). Use `logger.child({...})` to
 *   carry feature context.
 */
import { createAppLogger, type Logger } from '@goldfinch/shared/logger';

export const logger: Logger = createAppLogger({
  isProduction: !__DEV__,
  base: { app: 'goldfinch-client' },
});

/**
 * Standard wrapper for intentional fire-and-forget promises. Logs (never
 * throws, never swallows silently) so `void someAsyncCall()` call sites
 * become `fireAndForget(someAsyncCall(), 'registerPush', { ... })`.
 */
export function fireAndForget(
  promise: Promise<unknown>,
  operation: string,
  fields?: Record<string, unknown>,
): void {
  promise.catch((error: unknown) => {
    logger.error(`${operation} failed`, { ...fields, error });
  });
}
