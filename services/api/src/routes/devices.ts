/**
 * POST /devices/push-token, DELETE /devices/push-token/{deviceId} (P7-8).
 *
 * Registration is an upsert keyed by deviceId: re-registering refreshes the
 * token/platform, re-enables a token the relay had marked dead (disabledAt is
 * cleared), and preserves the original createdAt. DELETE is idempotent (204
 * whether or not the registration existed) — the deviceId travels in the
 * path because HTTP DELETE bodies are unreliable.
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SCHEMA_VERSION } from '@goldfinch/shared/constants';
import { pushTokenSk, userPk } from '@goldfinch/shared/keys';
import type { PushPlatform, RegisterPushTokenResponse } from '@goldfinch/shared/types';
import { getIdentity } from '../context.js';
import { ddb } from '../ddb.js';
import { nowIso } from '../dates.js';
import { getEnv } from '../env.js';
import { ApiError, json, noContent, parseJsonBody, requirePathParam } from '../http.js';
import { reqString } from '../validate.js';

const PLATFORMS: readonly PushPlatform[] = ['ios', 'android', 'web'];

export async function registerPushToken(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household, sub } = getIdentity(event);
  const env = getEnv();
  const body = parseJsonBody(event);

  const deviceId = reqString(body, 'deviceId');
  const expoPushToken = reqString(body, 'expoPushToken');
  const platform = body['platform'];
  if (typeof platform !== 'string' || !PLATFORMS.includes(platform as PushPlatform)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'platform must be "ios", "android", or "web"',
    );
  }

  const now = nowIso();
  await ddb.send(
    new UpdateCommand({
      TableName: env.tableName,
      Key: { PK: userPk(household), SK: pushTokenSk(deviceId) },
      UpdateExpression:
        'SET #entityType = :entityType, #schemaVersion = :schemaVersion, ' +
        '#deviceId = :deviceId, #expoPushToken = :expoPushToken, ' +
        '#platform = :platform, #ownerSub = :ownerSub, #updatedAt = :now, ' +
        '#disabledAt = :null, #createdAt = if_not_exists(#createdAt, :now)',
      ExpressionAttributeNames: {
        '#entityType': 'entityType',
        '#schemaVersion': 'schemaVersion',
        '#deviceId': 'deviceId',
        '#expoPushToken': 'expoPushToken',
        '#platform': 'platform',
        '#ownerSub': 'ownerSub',
        '#updatedAt': 'updatedAt',
        '#disabledAt': 'disabledAt',
        '#createdAt': 'createdAt',
      },
      ExpressionAttributeValues: {
        ':entityType': 'PUSH_TOKEN',
        ':schemaVersion': SCHEMA_VERSION,
        ':deviceId': deviceId,
        ':expoPushToken': expoPushToken,
        ':platform': platform,
        ':ownerSub': sub,
        ':now': now,
        ':null': null,
      },
    }),
  );

  const responseBody: RegisterPushTokenResponse = { deviceId };
  return json(200, responseBody);
}

export async function deletePushToken(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const deviceId = requirePathParam(event, 'deviceId');
  // Idempotent: deleting an unknown registration is a success, not a 404.
  await ddb.send(
    new DeleteCommand({
      TableName: env.tableName,
      Key: { PK: userPk(household), SK: pushTokenSk(deviceId) },
    }),
  );
  return noContent();
}
