/**
 * Real-AWS dependency wiring, kept in one file that the handlers load lazily
 * (dynamic import) so unit tests exercise the full pipeline with injected fakes
 * and never touch the AWS SDK.
 *
 * Caching: the document client, the SSM client, and the decrypted Expo access
 * token are module-scope singletons reused across warm invocations. A FAILED
 * token read is deliberately NOT cached: degraded mode (P7-8) is re-probed on
 * the next invocation so provisioning the parameter heals the service without
 * a redeploy.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { Logger } from '@goldfinch/shared/logger';
import { getConfigFromEnv, type NotificationsConfig } from './config.js';
import { createExpoClient, type ExpoClient } from './expo.js';
import { createDynamoStore, type NotificationStore } from './store.js';

export interface RuntimeDeps {
  store: NotificationStore;
  expo: ExpoClient;
  household: string;
  logger: Logger;
  /** True when the Expo access token is unavailable (P7-8 degraded mode). */
  degraded: boolean;
}

let cachedDocumentClient: DynamoDBDocumentClient | undefined;
let cachedSsmClient: SSMClient | undefined;
let cachedAccessToken: string | undefined;

function getDocumentClient(): DynamoDBDocumentClient {
  if (cachedDocumentClient === undefined) {
    cachedDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return cachedDocumentClient;
}

/**
 * Loads the Expo access token from SSM. Returns undefined (degraded mode)
 * when the parameter is missing, empty, or unreadable: per P7-8 the service
 * must keep working in Expo Go before push credentials are provisioned, so a
 * missing secret logs loudly and downgrades to unauthenticated relay calls --
 * it never crashes the Lambda.
 */
async function getExpoAccessToken(
  config: NotificationsConfig,
  logger: Logger,
): Promise<string | undefined> {
  if (cachedAccessToken !== undefined) return cachedAccessToken;
  cachedSsmClient ??= new SSMClient({});
  try {
    const output = await cachedSsmClient.send(
      new GetParameterCommand({
        Name: config.expoAccessTokenParam,
        WithDecryption: true,
      }),
    );
    const value = output.Parameter?.Value;
    if (value === undefined || value.length === 0) {
      logger.warn('expo access token parameter is empty; running degraded (unauthenticated relay)', {
        parameter: config.expoAccessTokenParam,
      });
      return undefined;
    }
    cachedAccessToken = value;
    return value;
  } catch (error) {
    logger.warn('expo access token unavailable; running degraded (unauthenticated relay)', {
      parameter: config.expoAccessTokenParam,
      error,
    });
    return undefined;
  }
}

/** Builds the production dependency set for both Lambda handlers. */
export async function getRuntimeDeps(logger: Logger): Promise<RuntimeDeps> {
  const config = getConfigFromEnv();
  const accessToken = await getExpoAccessToken(config, logger);
  return {
    store: createDynamoStore({
      client: getDocumentClient(),
      commands: { QueryCommand, PutCommand, DeleteCommand },
      tableName: config.tableName,
      household: config.household,
    }),
    expo: createExpoClient(accessToken !== undefined ? { accessToken } : {}),
    household: config.household,
    logger,
    degraded: accessToken === undefined,
  };
}
