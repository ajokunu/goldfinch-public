/**
 * In-Lambda HTTPS retry layer over the shared SimpleFIN client.
 *
 * Retries ONLY transient failures: HTTP 429 / 5xx (SimpleFinHttpError) and
 * network-level fetch failures (undici throws TypeError). 402 and 403 are
 * raised by the shared client as their own classes
 * (SimpleFinPaymentRequiredError / SimpleFinAuthError) and are STRUCTURALLY
 * unreachable by this retry path - they are terminal: retrying a lapsed
 * subscription or a dead access URL only burns the 24-requests/day budget.
 */

import type { Logger } from '@goldfinch/shared/logger';
import {
  SimpleFinHttpError,
  fetchAccounts,
  type FetchAccountsOptions,
  type FetchLike,
  type SimpleFinAccountSet,
} from '@goldfinch/shared/simplefin';

import type { SleepFn } from './writer.js';

export interface FetchRetryOptions {
  fetchImpl?: FetchLike;
  /** Total attempts including the first (default 4). */
  attempts?: number;
  /** Base backoff delay in ms (default 500; tests pass a no-op sleep). */
  baseDelayMs?: number;
  sleep?: SleepFn;
  /** Structured logger (P7-10): every retried failure is logged, not swallowed. */
  logger?: Logger;
}

const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function isRetryable(err: unknown): boolean {
  if (err instanceof SimpleFinHttpError) {
    return err.status === 429 || err.status >= 500;
  }
  // Node's fetch (undici) signals network failures as TypeError('fetch failed').
  return err instanceof TypeError;
}

export async function fetchAccountsWithRetry(
  accessUrl: string,
  options: FetchAccountsOptions,
  retry: FetchRetryOptions = {},
): Promise<SimpleFinAccountSet> {
  const attempts = retry.attempts ?? 4;
  const baseDelayMs = retry.baseDelayMs ?? 500;
  const sleep = retry.sleep ?? defaultSleep;
  const fetchImpl = retry.fetchImpl ?? fetch;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchAccounts(accessUrl, options, fetchImpl);
    } catch (err) {
      if (!isRetryable(err) || attempt >= attempts - 1) {
        throw err;
      }
      const exp = baseDelayMs * 2 ** attempt;
      const delayMs = Math.round(exp / 2 + Math.random() * (exp / 2));
      // P7-10: a retried failure is still a failure; log it with context.
      retry.logger?.warn('simplefin fetch attempt failed; retrying', {
        attempt: attempt + 1,
        attempts,
        delayMs,
        status: err instanceof SimpleFinHttpError ? err.status : undefined,
        error: err,
      });
      await sleep(delayMs);
    }
  }
}
