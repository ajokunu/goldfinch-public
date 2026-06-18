/**
 * SimpleFIN access-URL reader.
 *
 * The access URL is the ONLY real secret in GoldFinch. It lives in one SSM
 * SecureString (/goldfinch/prod/simplefin/access-url) encrypted with the
 * customer-managed CMK, readable solely by the sync Lambda role (decision D1).
 * The value is cached at module scope with a TTL so warm invocations skip the
 * SSM + KMS round trip, and it is NEVER logged - not here, not anywhere.
 */

import { GetParameterCommand, type SSMClient } from '@aws-sdk/client-ssm';

/** Minimal client surface so tests can inject a fake without aws-sdk mocks. */
export type SsmClientLike = Pick<SSMClient, 'send'>;

/** The parameter is absent: the one-time claim/bootstrap flow never ran. */
export class AccessUrlMissingError extends Error {
  constructor(paramName: string) {
    super(
      `SSM parameter ${paramName} not found - run scripts/claim-simplefin-token.ts ` +
        'and store the access URL per the runbook',
    );
    this.name = 'AccessUrlMissingError';
  }
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  paramName: string;
  value: string;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

export interface GetAccessUrlOptions {
  client: SsmClientLike;
  /** Cache lifetime; defaults to 15 minutes. */
  ttlMs?: number;
  /** Clock injection for tests; epoch milliseconds. */
  nowMs?: () => number;
}

/**
 * Read (and cache) the SimpleFIN access URL. Throws AccessUrlMissingError when
 * the parameter does not exist and propagates every other SSM/KMS failure.
 */
export async function getAccessUrl(
  paramName: string,
  options: GetAccessUrlOptions,
): Promise<string> {
  const nowMs = options.nowMs ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  if (cache !== null && cache.paramName === paramName && cache.expiresAt > nowMs()) {
    return cache.value;
  }

  let value: string | undefined;
  try {
    const response = await options.client.send(
      new GetParameterCommand({ Name: paramName, WithDecryption: true }),
    );
    value = response.Parameter?.Value;
  } catch (err) {
    if (err instanceof Error && err.name === 'ParameterNotFound') {
      throw new AccessUrlMissingError(paramName);
    }
    throw err;
  }

  if (value === undefined || value.length === 0) {
    throw new AccessUrlMissingError(paramName);
  }

  cache = { paramName, value, expiresAt: nowMs() + ttlMs };
  return value;
}

/** Test hook: drop the module-scope cache between cases. */
export function clearAccessUrlCache(): void {
  cache = null;
}
