/**
 * GET/POST /goals, PATCH/DELETE /goals/{goalId},
 * POST /goals/{goalId}/contributions (P7-2).
 *
 * Progress semantics:
 * - fundingMode 'linked-account': progress == the linked account's current
 *   balanceMinor (a missing/deleted account logs a warning and reads as 0,
 *   never a silent crash).
 * - fundingMode 'manual': progress == sum of the goal's CONTRIB# items.
 *
 * Optimistic locking on `version` mirrors budgets: PATCH requires the current
 * version (409 VERSION_CONFLICT on mismatch, 404 when absent). DELETE removes
 * the goal AND its contribution items (BatchWrite, retried; persistent
 * unprocessed keys fail the request loudly so a retry can finish the job).
 */

import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SCHEMA_VERSION } from '@goldfinch/shared/constants';
import {
  KEY_PREFIX,
  acctSk,
  contribPrefix,
  contribSk,
  goalSk,
  userPk,
} from '@goldfinch/shared/keys';
import { addMinor, parseCurrencyAmount } from '@goldfinch/shared/money';
import type {
  AccountItem,
  CreateGoalContributionResponse,
  GoalContributionItem,
  GoalFundingMode,
  GoalItem,
  GoalResponse,
  IsoTimestamp,
  ListGoalsResponse,
  MinorUnits,
} from '@goldfinch/shared/types';
import { BATCH_DELETE_MAX_RETRIES } from '../config.js';
import { getIdentity } from '../context.js';
import { ddb, isConditionalCheckFailure, queryAll } from '../ddb.js';
import { nowIso } from '../dates.js';
import { type ApiEnv, getEnv } from '../env.js';
import { ApiError, json, noContent, parseJsonBody, requirePathParam } from '../http.js';
import { logger } from '../logger.js';
import { toGoalContributionDto, toGoalDto } from '../mapping.js';
import { optString, reqInt, reqString, requireIsoDate } from '../validate.js';

const FUNDING_MODES: readonly GoalFundingMode[] = ['linked-account', 'manual'];

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function requireFundingMode(value: unknown): GoalFundingMode {
  if (typeof value !== 'string' || !FUNDING_MODES.includes(value as GoalFundingMode)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'fundingMode must be "linked-account" or "manual"',
    );
  }
  return value as GoalFundingMode;
}

async function getAccount(
  env: ApiEnv,
  household: string,
  accountId: string,
): Promise<AccountItem | undefined> {
  const res = await ddb.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { PK: userPk(household), SK: acctSk(accountId) },
    }),
  );
  return res.Item as AccountItem | undefined;
}

async function contributionSumMinor(
  env: ApiEnv,
  household: string,
  goalId: string,
): Promise<MinorUnits> {
  const rows = await queryAll<GoalContributionItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': userPk(household),
      ':prefix': contribPrefix(goalId),
    },
  });
  return addMinor(0, ...rows.map((row) => row.amountMinor));
}

async function goalProgressMinor(
  env: ApiEnv,
  household: string,
  goal: GoalItem,
): Promise<MinorUnits> {
  if (goal.fundingMode === 'linked-account') {
    const accountId = goal.linkedAccountId;
    if (accountId === undefined || accountId === null) {
      // Invariant violation (create/patch enforce the pairing); read as 0 loudly.
      logger.warn('linked-account goal has no linkedAccountId', { goalId: goal.goalId });
      return 0;
    }
    const account = await getAccount(env, household, accountId);
    if (account === undefined) {
      logger.warn('linked account for goal no longer exists', {
        goalId: goal.goalId,
        accountId,
      });
      return 0;
    }
    return account.balanceMinor;
  }
  return contributionSumMinor(env, household, goal.goalId);
}

export async function listGoals(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const goals = await queryAll<GoalItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': userPk(household),
      ':prefix': KEY_PREFIX.goal,
    },
  });
  const goalItems = goals.filter((item) => item.entityType === 'GOAL');
  const progress = await Promise.all(
    goalItems.map((goal) => goalProgressMinor(env, household, goal)),
  );
  const body: ListGoalsResponse = {
    items: goalItems.map((goal, i) => toGoalDto(goal, progress[i] as MinorUnits)),
  };
  return json(200, body);
}

export async function createGoal(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const body = parseJsonBody(event);
  const name = reqString(body, 'name');
  const fundingMode = requireFundingMode(body['fundingMode']);
  const targetDate =
    body['targetDate'] !== undefined
      ? requireIsoDate(body['targetDate'], 'targetDate')
      : undefined;

  let linkedAccountId: string | undefined;
  let linkedAccount: AccountItem | undefined;
  if (fundingMode === 'linked-account') {
    linkedAccountId = reqString(body, 'linkedAccountId');
    linkedAccount = await getAccount(env, household, linkedAccountId);
    if (linkedAccount === undefined) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `linkedAccountId "${linkedAccountId}" is not a known account`,
      );
    }
  } else if (body['linkedAccountId'] !== undefined && body['linkedAccountId'] !== null) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'linkedAccountId is only valid with fundingMode "linked-account"',
    );
  }

  const currency =
    optString(body, 'currency') ?? linkedAccount?.currency ?? 'USD';
  const targetMinor = parseCurrencyAmount(reqString(body, 'target'), currency);
  if (targetMinor <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'target must be greater than zero');
  }

  const goalId = randomUUID();
  const item: GoalItem = {
    PK: userPk(household),
    SK: goalSk(goalId),
    entityType: 'GOAL',
    schemaVersion: SCHEMA_VERSION,
    goalId,
    name,
    targetMinor,
    currency,
    targetDate: targetDate ?? null,
    fundingMode,
    linkedAccountId: linkedAccountId ?? null,
    version: 1,
    createdAt: nowIso(),
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: env.tableName,
        Item: { ...item },
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      throw new ApiError(409, 'ALREADY_EXISTS', `goal "${goalId}" already exists`);
    }
    throw err;
  }

  const progressMinor =
    fundingMode === 'linked-account' && linkedAccount !== undefined
      ? linkedAccount.balanceMinor
      : 0;
  const responseBody: GoalResponse = toGoalDto(item, progressMinor);
  return json(201, responseBody);
}

export async function patchGoal(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const goalId = requirePathParam(event, 'goalId');
  const body = parseJsonBody(event);
  const version = reqInt(body, 'version');

  const existingRes = await ddb.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { PK: userPk(household), SK: goalSk(goalId) },
    }),
  );
  const existing = existingRes.Item as GoalItem | undefined;
  if (existing === undefined || existing.entityType !== 'GOAL') {
    throw new ApiError(404, 'NOT_FOUND', `goal "${goalId}" not found`);
  }

  // Resolve the post-patch fundingMode/linkedAccountId pairing before writing.
  const fundingMode =
    body['fundingMode'] !== undefined
      ? requireFundingMode(body['fundingMode'])
      : existing.fundingMode;
  let linkedAccountId: string | null;
  if (body['linkedAccountId'] !== undefined) {
    const raw = body['linkedAccountId'];
    if (raw !== null && typeof raw !== 'string') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'linkedAccountId must be a string or null');
    }
    linkedAccountId = raw === null || raw.length === 0 ? null : raw;
  } else {
    linkedAccountId = existing.linkedAccountId ?? null;
  }
  if (fundingMode === 'linked-account') {
    if (linkedAccountId === null) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'a linked-account goal requires a non-null linkedAccountId',
      );
    }
    const account = await getAccount(env, household, linkedAccountId);
    if (account === undefined) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `linkedAccountId "${linkedAccountId}" is not a known account`,
      );
    }
  } else {
    linkedAccountId = null;
  }

  const names: Record<string, string> = {
    '#version': 'version',
    '#updatedAt': 'updatedAt',
    '#fundingMode': 'fundingMode',
    '#linkedAccountId': 'linkedAccountId',
  };
  const values: Record<string, unknown> = {
    ':version': version,
    ':nextVersion': version + 1,
    ':now': nowIso(),
    ':fundingMode': fundingMode,
    ':linkedAccountId': linkedAccountId,
  };
  const sets = [
    '#version = :nextVersion',
    '#updatedAt = :now',
    '#fundingMode = :fundingMode',
    '#linkedAccountId = :linkedAccountId',
  ];
  const name = optString(body, 'name');
  if (name !== undefined) {
    names['#name'] = 'name';
    values[':name'] = name;
    sets.push('#name = :name');
  }
  const target = optString(body, 'target');
  if (target !== undefined) {
    const targetMinor = parseCurrencyAmount(target, existing.currency);
    if (targetMinor <= 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'target must be greater than zero');
    }
    names['#targetMinor'] = 'targetMinor';
    values[':targetMinor'] = targetMinor;
    sets.push('#targetMinor = :targetMinor');
  }
  if (body['targetDate'] !== undefined) {
    const rawTargetDate = body['targetDate'];
    const targetDate =
      rawTargetDate === null ? null : requireIsoDate(rawTargetDate, 'targetDate');
    names['#targetDate'] = 'targetDate';
    values[':targetDate'] = targetDate;
    sets.push('#targetDate = :targetDate');
  }

  let updated: GoalItem;
  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: env.tableName,
        Key: { PK: userPk(household), SK: goalSk(goalId) },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'attribute_exists(PK) AND #version = :version',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      }),
    );
    updated = res.Attributes as GoalItem;
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      if (err.Item !== undefined) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'goal version does not match');
      }
      throw new ApiError(404, 'NOT_FOUND', `goal "${goalId}" not found`);
    }
    throw err;
  }

  const progressMinor = await goalProgressMinor(env, household, updated);
  const responseBody: GoalResponse = toGoalDto(updated, progressMinor);
  return json(200, responseBody);
}

/**
 * DELETE /goals/{goalId} -> 204. Also removes the goal's CONTRIB# items so no
 * orphans accumulate. NOTE: requires dynamodb:DeleteItem and
 * dynamodb:BatchWriteItem — flagged for the infra owner.
 */
export async function deleteGoal(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const goalId = requirePathParam(event, 'goalId');
  const pk = userPk(household);

  try {
    await ddb.send(
      new DeleteCommand({
        TableName: env.tableName,
        Key: { PK: pk, SK: goalSk(goalId) },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      throw new ApiError(404, 'NOT_FOUND', `goal "${goalId}" not found`);
    }
    throw err;
  }

  const contributions = await queryAll<GoalContributionItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk, ':prefix': contribPrefix(goalId) },
    ProjectionExpression: 'PK, SK',
  });
  let pendingKeys: Array<{ PK: string; SK: string }> = contributions.map((item) => ({
    PK: item.PK,
    SK: item.SK,
  }));
  let attempt = 0;
  while (pendingKeys.length > 0) {
    const chunk = pendingKeys.slice(0, 25);
    const rest = pendingKeys.slice(25);
    const res = await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [env.tableName]: chunk.map((key) => ({ DeleteRequest: { Key: key } })),
        },
      }),
    );
    const unprocessed = (res.UnprocessedItems?.[env.tableName] ?? [])
      .map((req) => req.DeleteRequest?.Key as { PK: string; SK: string } | undefined)
      .filter((key): key is { PK: string; SK: string } => key !== undefined);
    if (unprocessed.length > 0) {
      attempt += 1;
      if (attempt > BATCH_DELETE_MAX_RETRIES) {
        logger.error('goal contribution cleanup left unprocessed deletes', {
          goalId,
          unprocessedCount: unprocessed.length,
        });
        throw new Error(
          `failed to delete ${unprocessed.length} contribution item(s) for goal "${goalId}"`,
        );
      }
      logger.warn('retrying unprocessed contribution deletes', {
        goalId,
        attempt,
        unprocessedCount: unprocessed.length,
      });
    }
    pendingKeys = [...unprocessed, ...rest];
  }
  return noContent();
}

export async function createGoalContribution(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household, sub } = getIdentity(event);
  const env = getEnv();
  const goalId = requirePathParam(event, 'goalId');
  const body = parseJsonBody(event);

  const goalRes = await ddb.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { PK: userPk(household), SK: goalSk(goalId) },
    }),
  );
  const goal = goalRes.Item as GoalItem | undefined;
  if (goal === undefined || goal.entityType !== 'GOAL') {
    throw new ApiError(404, 'NOT_FOUND', `goal "${goalId}" not found`);
  }
  if (goal.fundingMode !== 'manual') {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'contributions are only valid for goals with fundingMode "manual"',
    );
  }

  const amountMinor = parseCurrencyAmount(reqString(body, 'amount'), goal.currency);
  if (amountMinor === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'amount must not be zero');
  }
  const note = optString(body, 'note');
  let contributedAt: IsoTimestamp;
  const rawContributedAt = body['contributedAt'];
  if (rawContributedAt !== undefined) {
    if (
      typeof rawContributedAt !== 'string' ||
      !ISO_TIMESTAMP_PATTERN.test(rawContributedAt)
    ) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'contributedAt must be an ISO-8601 UTC timestamp (e.g. 2026-06-09T12:00:00.000Z)',
      );
    }
    contributedAt = rawContributedAt;
  } else {
    contributedAt = nowIso();
  }

  const item: GoalContributionItem = {
    PK: userPk(household),
    SK: contribSk(goalId, contributedAt),
    entityType: 'GOAL_CONTRIBUTION',
    schemaVersion: SCHEMA_VERSION,
    goalId,
    contributedAt,
    amountMinor,
    currency: goal.currency,
    ...(note !== undefined ? { note } : {}),
    createdBy: sub,
    createdAt: nowIso(),
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: env.tableName,
        Item: { ...item },
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      throw new ApiError(
        409,
        'ALREADY_EXISTS',
        `a contribution at "${contributedAt}" already exists for goal "${goalId}"`,
      );
    }
    throw err;
  }

  const progressMinor = await contributionSumMinor(env, household, goalId);
  const responseBody: CreateGoalContributionResponse = {
    item: toGoalContributionDto(item),
    goal: toGoalDto(goal, progressMinor),
  };
  return json(201, responseBody);
}
