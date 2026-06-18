/**
 * GET/POST /categories, PATCH/DELETE /categories/{categoryId} (master plan
 * section 15, normalized to the shared DTO contract).
 *
 * - Category ids are stable slugs derived server-side from the name on create;
 *   they key both GSI2PK and BUDGET#<categoryId>, so they never change.
 * - DELETE is a soft delete (archived: true) — archived categories must stay
 *   resolvable for historical transactions. Default categories cannot change
 *   type and cannot be hard-deleted (there is no hard delete at all).
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SCHEMA_VERSION } from '@goldfinch/shared/constants';
import { KEY_PREFIX, categorySk, userPk } from '@goldfinch/shared/keys';
import type {
  ArchiveCategoryResponse,
  CategoryDto,
  CategoryItem,
  CategoryType,
  ListCategoriesResponse,
} from '@goldfinch/shared/types';
import { DEFAULT_CATEGORY_SORT_ORDER } from '../config.js';
import { getIdentity } from '../context.js';
import { ddb, isConditionalCheckFailure, queryAll } from '../ddb.js';
import { nowIso } from '../dates.js';
import { getEnv } from '../env.js';
import { ApiError, json, parseJsonBody, requirePathParam } from '../http.js';
import { toCategoryDto } from '../mapping.js';
import {
  assertMaxLength,
  optBool,
  optCategoryColorKey,
  optGlyphKey,
  optInt,
  optNullableString,
  optString,
  reqString,
} from '../validate.js';

const CATEGORY_TYPES: readonly CategoryType[] = ['INCOME', 'EXPENSE', 'TRANSFER'];

function requireCategoryType(value: unknown): CategoryType {
  if (typeof value !== 'string' || !CATEGORY_TYPES.includes(value as CategoryType)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `type must be one of ${CATEGORY_TYPES.join(', ')}`,
    );
  }
  return value as CategoryType;
}

/** Derive a stable slug id from a display name, e.g. "Coffee Shops" -> "coffee-shops". */
export function slugifyCategoryName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'name does not produce a usable id');
  }
  return slug;
}

export async function listCategories(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const categories = await queryAll<CategoryItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': userPk(household),
      ':prefix': KEY_PREFIX.category,
    },
  });
  const items: CategoryDto[] = categories
    .map(toCategoryDto)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const body: ListCategoriesResponse = { items };
  return json(200, body);
}

export async function createCategory(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const body = parseJsonBody(event);
  const name = assertMaxLength(reqString(body, 'name').trim(), 'name', 'categoryName');
  const type = requireCategoryType(body['type']);
  const groupId = optString(body, 'groupId');
  const sortOrder = optInt(body, 'sortOrder') ?? DEFAULT_CATEGORY_SORT_ORDER;
  // P10-1: optional USER-OWNED icon/color keys, validated against the shared
  // GLYPH_KEYS / CATEGORY_COLOR_KEYS sets (unknown -> 400). Absent leaves the
  // attribute off the item entirely, preserving the auto keyword/hash behavior.
  const iconKey = optGlyphKey(body, 'iconKey');
  const color = optCategoryColorKey(body, 'color');
  const categoryId = slugifyCategoryName(name);

  const item: CategoryItem = {
    PK: userPk(household),
    SK: categorySk(categoryId),
    entityType: 'CATEGORY',
    schemaVersion: SCHEMA_VERSION,
    categoryId,
    name,
    type,
    groupId: groupId ?? null,
    sortOrder,
    archived: false,
    isDefault: false,
    createdAt: nowIso(),
  };
  if (iconKey !== undefined) {
    item.iconKey = iconKey;
  }
  if (color !== undefined) {
    item.color = color;
  }

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
      throw new ApiError(
        409,
        'ALREADY_EXISTS',
        `a category with id "${categoryId}" already exists`,
      );
    }
    throw err;
  }
  return json(201, toCategoryDto(item));
}

export async function patchCategory(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const categoryId = requirePathParam(event, 'categoryId');
  const body = parseJsonBody(event);
  const name = optString(body, 'name')?.trim();
  const groupId = optNullableString(body, 'groupId');
  const sortOrder = optInt(body, 'sortOrder');
  const archived = optBool(body, 'archived');
  // P10-1: optional USER-OWNED icon/color keys, validated against the shared
  // sets (unknown -> 400). A present key is stored verbatim; absent leaves the
  // stored value untouched (no write), preserving today's behavior.
  const iconKey = optGlyphKey(body, 'iconKey');
  const color = optCategoryColorKey(body, 'color');
  if (
    name === undefined &&
    groupId === undefined &&
    sortOrder === undefined &&
    archived === undefined &&
    iconKey === undefined &&
    color === undefined
  ) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'no fields to update');
  }
  if (name !== undefined && name.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'name must not be empty');
  }
  if (name !== undefined) {
    assertMaxLength(name, 'name', 'categoryName');
  }

  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':updatedAt': nowIso() };
  const sets = ['#updatedAt = :updatedAt'];
  if (name !== undefined) {
    names['#name'] = 'name';
    values[':name'] = name;
    sets.push('#name = :name');
  }
  if (groupId !== undefined) {
    names['#groupId'] = 'groupId';
    values[':groupId'] = groupId;
    sets.push('#groupId = :groupId');
  }
  if (sortOrder !== undefined) {
    names['#sortOrder'] = 'sortOrder';
    values[':sortOrder'] = sortOrder;
    sets.push('#sortOrder = :sortOrder');
  }
  if (archived !== undefined) {
    names['#archived'] = 'archived';
    values[':archived'] = archived;
    sets.push('#archived = :archived');
  }
  if (iconKey !== undefined) {
    names['#iconKey'] = 'iconKey';
    values[':iconKey'] = iconKey;
    sets.push('#iconKey = :iconKey');
  }
  if (color !== undefined) {
    names['#color'] = 'color';
    values[':color'] = color;
    sets.push('#color = :color');
  }

  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: env.tableName,
        Key: { PK: userPk(household), SK: categorySk(categoryId) },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return json(200, toCategoryDto(res.Attributes as CategoryItem));
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      throw new ApiError(404, 'NOT_FOUND', `category "${categoryId}" not found`);
    }
    throw err;
  }
}

/** DELETE /categories/{categoryId} — soft delete: sets archived true. */
export async function archiveCategory(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const categoryId = requirePathParam(event, 'categoryId');
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.tableName,
        Key: { PK: userPk(household), SK: categorySk(categoryId) },
        UpdateExpression: 'SET #archived = :true, #updatedAt = :now',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: {
          '#archived': 'archived',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: { ':true': true, ':now': nowIso() },
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      throw new ApiError(404, 'NOT_FOUND', `category "${categoryId}" not found`);
    }
    throw err;
  }
  const body: ArchiveCategoryResponse = { categoryId, archived: true };
  return json(200, body);
}
