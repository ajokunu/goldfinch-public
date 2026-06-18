/**
 * GET /profile, PATCH /profile — the caller's user profile (display name).
 *
 * Per-USER within the household: identity (household AND Cognito sub) is
 * always re-derived server-side from the JWT claims (decision KEY), never
 * from client input. Items live at PK = USER#<household>,
 * SK = PROFILE#<sub>, so each spouse has their own display name.
 *
 * - GET returns the stored profile; 404 NOT_FOUND when the caller has no
 *   profile item yet (clients treat that exactly like displayName null).
 * - PATCH validates the display name (trimmed, PROFILE_DISPLAY_NAME_MIN/
 *   MAX_LENGTH from the shared constants) and upserts the caller's item
 *   version-conditionally: creation requires the item to still be absent and
 *   an update requires the stored version to be unchanged since it was read,
 *   so a concurrent edit surfaces as 409 VERSION_CONFLICT instead of a
 *   silent lost update. Other profile attributes (e.g. notification
 *   preferences in `settings`, read by services/notifications) are never
 *   touched.
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_DISPLAY_NAME_MIN_LENGTH,
  SCHEMA_VERSION,
} from '@goldfinch/shared/constants';
import { profileSk, userPk } from '@goldfinch/shared/keys';
import type {
  GetProfileResponse,
  PatchProfileResponse,
  ProfileDto,
  UserProfileItem,
} from '@goldfinch/shared/types';
import { getIdentity } from '../context.js';
import { ddb, isConditionalCheckFailure } from '../ddb.js';
import { nowIso } from '../dates.js';
import { type ApiEnv, getEnv } from '../env.js';
import { ApiError, json, parseJsonBody } from '../http.js';
import { reqString } from '../validate.js';

/**
 * Email is DISPLAY data carried only when the access token happens to carry
 * an email claim (it is optional in the DTO; standard Cognito access tokens
 * do not include one unless token customization adds it). Never an identity
 * input — identity is getIdentity()'s household + sub, full stop.
 */
function emailClaim(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): string | undefined {
  const value = event.requestContext.authorizer?.jwt?.claims?.['email'];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function toProfileDto(item: UserProfileItem, email: string | undefined): ProfileDto {
  const displayName =
    typeof item.displayName === 'string' && item.displayName.trim() !== ''
      ? item.displayName
      : null;
  return email === undefined ? { displayName } : { displayName, email };
}

async function getProfileItem(
  env: ApiEnv,
  household: string,
  sub: string,
): Promise<UserProfileItem | undefined> {
  const res = await ddb.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { PK: userPk(household), SK: profileSk(sub) },
    }),
  );
  const item = res.Item as UserProfileItem | undefined;
  // PROFILE#<sub> is exclusively entityType USER; anything else is corrupt
  // data this route must not serve.
  return item !== undefined && item.entityType === 'USER' ? item : undefined;
}

export async function getProfile(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household, sub } = getIdentity(event);
  const env = getEnv();
  const item = await getProfileItem(env, household, sub);
  if (item === undefined) {
    throw new ApiError(404, 'NOT_FOUND', 'no profile exists for this user yet');
  }
  const body: GetProfileResponse = toProfileDto(item, emailClaim(event));
  return json(200, body);
}

export async function patchProfile(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household, sub } = getIdentity(event);
  const env = getEnv();
  const body = parseJsonBody(event);
  const displayName = reqString(body, 'displayName').trim();
  if (
    displayName.length < PROFILE_DISPLAY_NAME_MIN_LENGTH ||
    displayName.length > PROFILE_DISPLAY_NAME_MAX_LENGTH
  ) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `displayName must be ${PROFILE_DISPLAY_NAME_MIN_LENGTH}-${PROFILE_DISPLAY_NAME_MAX_LENGTH} characters after trimming`,
    );
  }

  const current = await getProfileItem(env, household, sub);
  const now = nowIso();
  const updated =
    current === undefined
      ? await createProfile(env, household, sub, displayName, now)
      : await updateDisplayName(env, household, sub, displayName, now, current);

  const responseBody: PatchProfileResponse = toProfileDto(updated, emailClaim(event));
  return json(200, responseBody);
}

/** First write self-provisions the caller's profile item (version 1). */
async function createProfile(
  env: ApiEnv,
  household: string,
  sub: string,
  displayName: string,
  now: string,
): Promise<UserProfileItem> {
  const item: UserProfileItem = {
    PK: userPk(household),
    SK: profileSk(sub),
    entityType: 'USER',
    schemaVersion: SCHEMA_VERSION,
    cognitoSub: sub,
    displayName,
    baseCurrency: env.baseCurrency,
    householdId: household,
    createdAt: now,
    version: 1,
  };
  try {
    await ddb.send(
      new PutCommand({
        TableName: env.tableName,
        // Spread: interfaces lack the implicit index signature Item requires.
        Item: { ...item },
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      // Another device created the profile between our read and this write.
      throw new ApiError(
        409,
        'VERSION_CONFLICT',
        'profile was modified concurrently; refresh and retry',
      );
    }
    throw err;
  }
  return item;
}

/**
 * Version-conditional displayName update: the write succeeds only if the
 * stored version is still the one we read (or, for pre-feature items that
 * never carried a version, only if it is still absent), so concurrent edits
 * can never silently overwrite each other.
 */
async function updateDisplayName(
  env: ApiEnv,
  household: string,
  sub: string,
  displayName: string,
  now: string,
  current: UserProfileItem,
): Promise<UserProfileItem> {
  const values: Record<string, unknown> = {
    ':displayName': displayName,
    ':updatedAt': now,
    ':nextVersion': (current.version ?? 0) + 1,
  };
  let versionCondition = 'attribute_not_exists(#version)';
  if (current.version !== undefined) {
    versionCondition = '#version = :version';
    values[':version'] = current.version;
  }
  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: env.tableName,
        Key: { PK: userPk(household), SK: profileSk(sub) },
        UpdateExpression:
          'SET #displayName = :displayName, #updatedAt = :updatedAt, #version = :nextVersion',
        ConditionExpression: `attribute_exists(PK) AND ${versionCondition}`,
        ExpressionAttributeNames: {
          '#displayName': 'displayName',
          '#updatedAt': 'updatedAt',
          '#version': 'version',
        },
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return res.Attributes as UserProfileItem;
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      throw new ApiError(
        409,
        'VERSION_CONFLICT',
        'profile was modified concurrently; refresh and retry',
      );
    }
    throw err;
  }
}
