/**
 * Lambda environment configuration. Read at request time (not module load) so
 * tests can set process.env before invoking the handler; the values are cheap
 * property reads either way.
 */

import { GSI1_NAME, GSI2_NAME } from '@goldfinch/shared/keys';

export interface ApiEnv {
  tableName: string;
  gsi1Name: string;
  gsi2Name: string;
  defaultTz: string;
  /**
   * Household base currency (P7-7): the currency whose slice the summary
   * top-level totals report. Mirrors the sync Lambda's BASE_CURRENCY ?? 'USD'
   * so the two services can never disagree on what "base" means.
   */
  baseCurrency: string;
}

export function getEnv(): ApiEnv {
  const tableName = process.env.TABLE_NAME;
  if (tableName === undefined || tableName.length === 0) {
    throw new Error('TABLE_NAME environment variable is not set');
  }
  return {
    tableName,
    gsi1Name: process.env.GSI1_NAME ?? GSI1_NAME,
    gsi2Name: process.env.GSI2_NAME ?? GSI2_NAME,
    defaultTz: process.env.DEFAULT_TZ ?? 'America/New_York',
    baseCurrency: process.env.BASE_CURRENCY ?? 'USD',
  };
}

/**
 * Name of the sync Lambda that POST /sync/run async-invokes (set by infra:
 * ApiStack SYNC_FN_NAME, IAM-paired with the InvokeSyncFunction grant on
 * exactly that function's ARN). Read at request time like getEnv; missing is
 * a deployment error and surfaces as the handler's generic 500.
 */
export function getSyncFnName(): string {
  const name = process.env.SYNC_FN_NAME;
  if (name === undefined || name.length === 0) {
    throw new Error('SYNC_FN_NAME environment variable is not set');
  }
  return name;
}
