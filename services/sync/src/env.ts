/**
 * Environment configuration for the sync Lambda. Values are injected by the
 * SyncStack (infra/lib/sync-stack.ts); defaults mirror the master-plan config
 * so local tests run without a full env.
 */

import {
  HOUSEHOLD_ID,
  SIMPLEFIN_PARAM_NAME,
  SYNC_EVENT_SOURCE,
} from '@goldfinch/shared/constants';
import type { AccountType } from '@goldfinch/shared/types';

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

export interface SyncEnv {
  tableName: string;
  householdId: string;
  simplefinParamName: string;
  overlapBufferDays: number;
  maxHistoryDays: number;
  metricsNamespace: string;
  /**
   * SimpleFIN exposes no account type, so the mapping from SimpleFIN account
   * id -> GoldFinch AccountType is seeded config (env ACCOUNT_TYPES_JSON,
   * e.g. {"ACT-123":"checking"}). Unmapped accounts normalize to "other".
   */
  accountTypes: Record<string, AccountType>;
  /**
   * EventBridge bus receiving the SyncCompleted event (P7-8). Defaults to the
   * account's default bus, which is where the decisions doc routes the
   * SyncCompleted -> notifications rule.
   */
  eventBusName: string;
  /** Event `source` field; the shared SYNC_EVENT_SOURCE unless overridden. */
  eventSource: string;
  /**
   * Currency whose slice fills the NETWORTH# snapshot's top-level totals
   * (P7-4 reconciled with P7-7: no synthetic mixed-currency totals).
   */
  baseCurrency: string;
  /**
   * Days of posted history fed to the recurrence detector (P7-1). Default 400
   * so yearly cadences (2 occurrences, ~365d apart) stay detectable once the
   * table has accrued enough history; the 90-day SimpleFIN cap only limits
   * what each run FETCHES, not what is already persisted.
   */
  recurrenceLookbackDays: number;
}

const ACCOUNT_TYPES: ReadonlySet<string> = new Set([
  'checking',
  'savings',
  'credit',
  'investment',
  'loan',
  'other',
]);

function requireVar(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) {
    throw new EnvError(`missing required environment variable ${name}`);
  }
  return value;
}

function intVar(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EnvError(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function parseAccountTypes(raw: string | undefined): Record<string, AccountType> {
  if (raw === undefined || raw.length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EnvError('ACCOUNT_TYPES_JSON is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new EnvError('ACCOUNT_TYPES_JSON must be a JSON object of accountId -> type');
  }
  const result: Record<string, AccountType> = {};
  for (const [accountId, type] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof type !== 'string' || !ACCOUNT_TYPES.has(type)) {
      throw new EnvError(
        `ACCOUNT_TYPES_JSON["${accountId}"] must be one of ${[...ACCOUNT_TYPES].join('|')}`,
      );
    }
    result[accountId] = type as AccountType;
  }
  return result;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): SyncEnv {
  return {
    tableName: requireVar(env, 'TABLE_NAME'),
    householdId: env.HOUSEHOLD_ID ?? HOUSEHOLD_ID,
    simplefinParamName: env.SIMPLEFIN_PARAM_NAME ?? SIMPLEFIN_PARAM_NAME,
    overlapBufferDays: intVar(env, 'OVERLAP_BUFFER_DAYS', 7),
    maxHistoryDays: intVar(env, 'MAX_HISTORY_DAYS', 90),
    metricsNamespace: env.METRICS_NAMESPACE ?? 'GoldFinch/Sync',
    accountTypes: parseAccountTypes(env.ACCOUNT_TYPES_JSON),
    eventBusName: env.EVENT_BUS_NAME ?? 'default',
    eventSource: env.EVENT_SOURCE ?? SYNC_EVENT_SOURCE,
    baseCurrency: env.BASE_CURRENCY ?? 'USD',
    recurrenceLookbackDays: intVar(env, 'RECURRENCE_LOOKBACK_DAYS', 400),
  };
}
