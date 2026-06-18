/**
 * Environment configuration for the two Lambda entry points. The only secret is
 * the Expo access token, which lives in SSM SecureString (shared CMK pattern,
 * same as the SimpleFIN token but a DIFFERENT parameter -- this service must
 * never be granted /goldfinch/prod/simplefin/access-url).
 *
 * Env-var contract with infra (NotificationsStack):
 *   TABLE_NAME              required  DynamoDB single-table name
 *   GOLDFINCH_HOUSEHOLD     optional  household partition id (default HOUSEHOLD_ID)
 *   EXPO_ACCESS_TOKEN_PARAM optional  SSM name (default /goldfinch/expo/access-token)
 */

import { HOUSEHOLD_ID } from '@goldfinch/shared/constants';

/** Default SSM SecureString holding the Expo access token (enhanced push security). */
export const EXPO_ACCESS_TOKEN_PARAM_NAME = '/goldfinch/expo/access-token';

export interface NotificationsConfig {
  /** DynamoDB single-table name (env TABLE_NAME, required). */
  tableName: string;
  /** SSM parameter holding the Expo access token (env EXPO_ACCESS_TOKEN_PARAM). */
  expoAccessTokenParam: string;
  /** Household partition discriminator (env GOLDFINCH_HOUSEHOLD, default HOUSEHOLD_ID). */
  household: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function getConfigFromEnv(env: NodeJS.ProcessEnv = process.env): NotificationsConfig {
  const tableName = env.TABLE_NAME;
  if (tableName === undefined || tableName.length === 0) {
    throw new ConfigError('TABLE_NAME environment variable is required');
  }
  const household = env.GOLDFINCH_HOUSEHOLD;
  return {
    tableName,
    expoAccessTokenParam:
      env.EXPO_ACCESS_TOKEN_PARAM !== undefined && env.EXPO_ACCESS_TOKEN_PARAM.length > 0
        ? env.EXPO_ACCESS_TOKEN_PARAM
        : EXPO_ACCESS_TOKEN_PARAM_NAME,
    household: household !== undefined && household.length > 0 ? household : HOUSEHOLD_ID,
  };
}
