/**
 * GET/POST /rules, PATCH/DELETE /rules/{ruleId}, POST /rules/{ruleId}/apply
 * (P7-5).
 *
 * These routes edit the SAME RULE#<ruleId> items the services/ai daily rules
 * pass consumes; matching semantics live solely in @goldfinch/shared/rules.
 * Legacy services/ai items (RULE#<matchType>#<pattern>, entityType
 * 'CATEGORY_RULE') share the SK namespace until migrated, so every reader
 * here discriminates on entityType === 'RULE'.
 *
 * Apply-now runs the rule retroactively over UNCATEGORIZED transactions only:
 * rows with a category, and rows a user categorized (userCategorized), are
 * never touched. Each recategorization rewrites the sparse GSI2 keys through
 * the shared computeGsi2Keys rule and is guarded by a conditional update so a
 * concurrent user edit always wins (the row is then counted as matched but
 * not updated).
 */

import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SCHEMA_VERSION } from '@goldfinch/shared/constants';
import {
  KEY_PREFIX,
  categorySk,
  computeGsi2Keys,
  parseTxnSk,
  ruleSk,
  txnDateRangeBounds,
  userPk,
} from '@goldfinch/shared/keys';
import { parseDecimalString } from '@goldfinch/shared/money';
import {
  compareRulePrecedence,
  ruleMarksTransfer,
  ruleMatches,
} from '@goldfinch/shared/rules';
import type {
  ApplyRuleResponse,
  CategoryItem,
  IsoDate,
  ListRulesResponse,
  MinorUnits,
  RuleItem,
  RuleMatchType,
  RuleResponse,
  TransactionItem,
} from '@goldfinch/shared/types';
import { APPLY_RULE_DEFAULT_DAYS, DEFAULT_RULE_PRIORITY } from '../config.js';
import { getIdentity } from '../context.js';
import { ddb, isConditionalCheckFailure, queryAll } from '../ddb.js';
import { nowIso, todayInTz } from '../dates.js';
import { type ApiEnv, getEnv } from '../env.js';
import { ApiError, json, noContent, parseJsonBody, requirePathParam } from '../http.js';
import { logger } from '../logger.js';
import { toRuleDto } from '../mapping.js';
import {
  assertMaxLength,
  optBool,
  optInt,
  reqInt,
  reqString,
  requireIsoDate,
} from '../validate.js';

const MATCH_TYPES: readonly RuleMatchType[] = ['exact', 'prefix', 'contains'];

function requireMatchType(value: unknown): RuleMatchType {
  if (typeof value !== 'string' || !MATCH_TYPES.includes(value as RuleMatchType)) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'matchType must be "exact", "prefix", or "contains"',
    );
  }
  return value as RuleMatchType;
}

/** Patterns are stored lowercased and trimmed; empty patterns never match. */
function normalizePattern(value: string): string {
  const pattern = value.trim().toLowerCase();
  if (pattern.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'pattern must not be blank');
  }
  // Length-capped server-side on the stored (normalized) value.
  return assertMaxLength(pattern, 'pattern', 'rulePattern');
}

/**
 * Parse one optional amount bound. Bounds compare against abs(amountMinor)
 * and use the household base-currency 2-digit scale (same as budgets).
 * Returns undefined (absent), null (explicit clear), or the parsed value.
 */
function parseBound(
  body: Record<string, unknown>,
  field: 'amountMin' | 'amountMax',
): MinorUnits | null | undefined {
  const raw = body[field];
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be a decimal string or null`);
  }
  const minor = parseDecimalString(raw, 2);
  if (minor < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', `${field} must not be negative`);
  }
  return minor;
}

function assertBoundOrder(
  min: MinorUnits | null | undefined,
  max: MinorUnits | null | undefined,
): void {
  if (min !== null && min !== undefined && max !== null && max !== undefined && min > max) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'amountMin must not exceed amountMax');
  }
}

async function requireActiveCategory(
  env: ApiEnv,
  household: string,
  categoryId: string,
): Promise<CategoryItem> {
  const res = await ddb.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { PK: userPk(household), SK: categorySk(categoryId) },
    }),
  );
  const category = res.Item as CategoryItem | undefined;
  if (category === undefined || category.archived) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `categoryId "${categoryId}" is not a known active category`,
    );
  }
  return category;
}

async function loadRules(env: ApiEnv, household: string): Promise<RuleItem[]> {
  const items = await queryAll<RuleItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': userPk(household),
      ':prefix': KEY_PREFIX.rule,
    },
  });
  // Legacy CATEGORY_RULE items share the RULE# namespace — exclude them.
  return items.filter((item) => item.entityType === 'RULE');
}

export async function listRules(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const rules = await loadRules(env, household);
  rules.sort(compareRulePrecedence);
  const body: ListRulesResponse = { items: rules.map(toRuleDto) };
  return json(200, body);
}

export async function createRule(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household, sub } = getIdentity(event);
  const env = getEnv();
  const body = parseJsonBody(event);

  const matchType = requireMatchType(body['matchType']);
  const pattern = normalizePattern(reqString(body, 'pattern'));
  const categoryId = reqString(body, 'categoryId');
  await requireActiveCategory(env, household, categoryId);
  const amountMinMinor = parseBound(body, 'amountMin');
  const amountMaxMinor = parseBound(body, 'amountMax');
  assertBoundOrder(amountMinMinor, amountMaxMinor);
  const priority = optInt(body, 'priority') ?? DEFAULT_RULE_PRIORITY;
  const enabled = optBool(body, 'enabled') ?? true;
  const markTransfer = optBool(body, 'markTransfer');

  const ruleId = randomUUID();
  const item: RuleItem = {
    PK: userPk(household),
    SK: ruleSk(ruleId),
    entityType: 'RULE',
    schemaVersion: SCHEMA_VERSION,
    ruleId,
    matchType,
    pattern,
    ...(amountMinMinor !== undefined ? { amountMinMinor } : {}),
    ...(amountMaxMinor !== undefined ? { amountMaxMinor } : {}),
    categoryId,
    priority,
    enabled,
    // Only SET when provided; absent stays absent (read as false), back-compat.
    ...(markTransfer !== undefined ? { markTransfer } : {}),
    version: 1,
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
      throw new ApiError(409, 'ALREADY_EXISTS', `rule "${ruleId}" already exists`);
    }
    throw err;
  }

  const responseBody: RuleResponse = toRuleDto(item);
  return json(201, responseBody);
}

export async function patchRule(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const ruleId = requirePathParam(event, 'ruleId');
  const body = parseJsonBody(event);
  const version = reqInt(body, 'version');

  const existingRes = await ddb.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { PK: userPk(household), SK: ruleSk(ruleId) },
    }),
  );
  const existing = existingRes.Item as RuleItem | undefined;
  if (existing === undefined || existing.entityType !== 'RULE') {
    throw new ApiError(404, 'NOT_FOUND', `rule "${ruleId}" not found`);
  }

  const names: Record<string, string> = {
    '#version': 'version',
    '#updatedAt': 'updatedAt',
  };
  const values: Record<string, unknown> = {
    ':version': version,
    ':nextVersion': version + 1,
    ':now': nowIso(),
  };
  const sets = ['#version = :nextVersion', '#updatedAt = :now'];

  if (body['matchType'] !== undefined) {
    names['#matchType'] = 'matchType';
    values[':matchType'] = requireMatchType(body['matchType']);
    sets.push('#matchType = :matchType');
  }
  if (body['pattern'] !== undefined) {
    names['#pattern'] = 'pattern';
    values[':pattern'] = normalizePattern(reqString(body, 'pattern'));
    sets.push('#pattern = :pattern');
  }
  if (body['categoryId'] !== undefined) {
    const categoryId = reqString(body, 'categoryId');
    await requireActiveCategory(env, household, categoryId);
    names['#categoryId'] = 'categoryId';
    values[':categoryId'] = categoryId;
    sets.push('#categoryId = :categoryId');
  }
  const amountMinMinor = parseBound(body, 'amountMin');
  const amountMaxMinor = parseBound(body, 'amountMax');
  // Validate the POST-patch bound pairing (patched value, else stored value).
  assertBoundOrder(
    amountMinMinor !== undefined ? amountMinMinor : (existing.amountMinMinor ?? null),
    amountMaxMinor !== undefined ? amountMaxMinor : (existing.amountMaxMinor ?? null),
  );
  if (amountMinMinor !== undefined) {
    names['#amountMinMinor'] = 'amountMinMinor';
    values[':amountMinMinor'] = amountMinMinor;
    sets.push('#amountMinMinor = :amountMinMinor');
  }
  if (amountMaxMinor !== undefined) {
    names['#amountMaxMinor'] = 'amountMaxMinor';
    values[':amountMaxMinor'] = amountMaxMinor;
    sets.push('#amountMaxMinor = :amountMaxMinor');
  }
  const priority = optInt(body, 'priority');
  if (priority !== undefined) {
    names['#priority'] = 'priority';
    values[':priority'] = priority;
    sets.push('#priority = :priority');
  }
  const enabled = optBool(body, 'enabled');
  if (enabled !== undefined) {
    names['#enabled'] = 'enabled';
    values[':enabled'] = enabled;
    sets.push('#enabled = :enabled');
  }
  const markTransfer = optBool(body, 'markTransfer');
  if (markTransfer !== undefined) {
    names['#markTransfer'] = 'markTransfer';
    values[':markTransfer'] = markTransfer;
    sets.push('#markTransfer = :markTransfer');
  }

  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: env.tableName,
        Key: { PK: userPk(household), SK: ruleSk(ruleId) },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'attribute_exists(PK) AND #version = :version',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      }),
    );
    const responseBody: RuleResponse = toRuleDto(res.Attributes as RuleItem);
    return json(200, responseBody);
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      if (err.Item !== undefined) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'rule version does not match');
      }
      throw new ApiError(404, 'NOT_FOUND', `rule "${ruleId}" not found`);
    }
    throw err;
  }
}

export async function deleteRule(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const ruleId = requirePathParam(event, 'ruleId');
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: env.tableName,
        Key: { PK: userPk(household), SK: ruleSk(ruleId) },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      throw new ApiError(404, 'NOT_FOUND', `rule "${ruleId}" not found`);
    }
    throw err;
  }
  return noContent();
}

/** Projection of the fields apply-now needs from each candidate transaction. */
interface ApplyCandidateRow {
  SK: string;
  entityType?: string;
  amountMinor: MinorUnits;
  payee?: string;
  payeeLower?: string;
  categoryId?: string | null;
  userCategorized?: boolean;
  isTransfer?: boolean;
}

export async function applyRule(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const ruleId = requirePathParam(event, 'ruleId');
  // The body is optional: {} means "use the default retroactive window".
  const body =
    event.body === undefined || event.body === null || event.body.length === 0
      ? {}
      : parseJsonBody(event);

  const today = todayInTz(env.defaultTz);
  const to: IsoDate = body['to'] !== undefined ? requireIsoDate(body['to'], 'to') : today;
  let from: IsoDate;
  if (body['from'] !== undefined) {
    from = requireIsoDate(body['from'], 'from');
  } else {
    const start = new Date(`${to}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - APPLY_RULE_DEFAULT_DAYS);
    from = start.toISOString().slice(0, 10);
  }
  if (from > to) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'from must not be after to');
  }

  const pk = userPk(household);
  const ruleRes = await ddb.send(
    new GetCommand({ TableName: env.tableName, Key: { PK: pk, SK: ruleSk(ruleId) } }),
  );
  const rule = ruleRes.Item as RuleItem | undefined;
  if (rule === undefined || rule.entityType !== 'RULE') {
    throw new ApiError(404, 'NOT_FOUND', `rule "${ruleId}" not found`);
  }
  if (rule.enabled === false) {
    // Explicit failure beats a silent zero-match no-op.
    throw new ApiError(400, 'VALIDATION_ERROR', 'rule is disabled; enable it before applying');
  }
  const category = await requireActiveCategory(env, household, rule.categoryId);

  const bounds = txnDateRangeBounds(from, to);
  const rows = await queryAll<ApplyCandidateRow>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
    ExpressionAttributeValues: { ':pk': pk, ':start': bounds.start, ':end': bounds.end },
    ProjectionExpression:
      '#sk, #entityType, #amountMinor, #payee, #payeeLower, #categoryId, #userCategorized, #isTransfer',
    ExpressionAttributeNames: {
      '#sk': 'SK',
      '#entityType': 'entityType',
      '#amountMinor': 'amountMinor',
      '#payee': 'payee',
      '#payeeLower': 'payeeLower',
      '#categoryId': 'categoryId',
      '#userCategorized': 'userCategorized',
      '#isTransfer': 'isTransfer',
    },
  });

  const matches = rows.filter((row) => {
    if (row.entityType !== undefined && row.entityType !== 'TRANSACTION') return false;
    // Only uncategorized rows are eligible; user-categorized rows are sacred.
    if (row.categoryId !== null && row.categoryId !== undefined) return false;
    if (row.userCategorized === true) return false;
    const payeeLower = row.payeeLower ?? row.payee?.toLowerCase() ?? '';
    return ruleMatches(rule, { payeeLower, amountMinor: row.amountMinor });
  });

  // A markTransfer rule makes the row a transfer (durable mechanism): the same
  // value feeds computeGsi2Keys (-> null -> the REMOVE GSI2 branch) AND the
  // SET #isTransfer below, so both transfer signals are written in one update.
  const marksTransfer = ruleMarksTransfer(rule);

  let updatedCount = 0;
  const now = nowIso();
  for (const row of matches) {
    const { date, txnId } = parseTxnSk(row.SK);
    // Effective transfer status: the rule's action OR a pre-existing flag.
    const effectiveIsTransfer = marksTransfer || row.isTransfer === true;
    const gsi2Keys = computeGsi2Keys({
      household,
      categoryId: rule.categoryId,
      categoryType: category.type,
      isTransfer: effectiveIsTransfer,
      date,
      txnId,
    });

    const names: Record<string, string> = {
      '#categoryId': 'categoryId',
      '#categorizedBy': 'categorizedBy',
      '#userCategorized': 'userCategorized',
      '#updatedAt': 'updatedAt',
      '#version': 'version',
      '#gsi2pk': 'GSI2PK',
      '#gsi2sk': 'GSI2SK',
    };
    const values: Record<string, unknown> = {
      ':categoryId': rule.categoryId,
      ':rule': 'rule',
      ':now': now,
      ':zero': 0,
      ':one': 1,
      ':null': null,
      ':false': false,
    };
    const sets = [
      '#categoryId = :categoryId',
      '#categorizedBy = :rule',
      '#updatedAt = :now',
      '#version = if_not_exists(#version, :zero) + :one',
    ];
    if (marksTransfer) {
      // Durable per-row transfer signal honored by the client donut + GSI2.
      names['#isTransfer'] = 'isTransfer';
      values[':true'] = true;
      sets.push('#isTransfer = :true');
    }
    let updateExpression: string;
    if (gsi2Keys !== null) {
      values[':gsi2pk'] = gsi2Keys.GSI2PK;
      values[':gsi2sk'] = gsi2Keys.GSI2SK;
      sets.push('#gsi2pk = :gsi2pk', '#gsi2sk = :gsi2sk');
      updateExpression = `SET ${sets.join(', ')}`;
    } else {
      updateExpression = `SET ${sets.join(', ')} REMOVE #gsi2pk, #gsi2sk`;
    }

    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.tableName,
          Key: { PK: pk, SK: row.SK },
          UpdateExpression: updateExpression,
          // Guards the read-then-write race: a row that got categorized (or
          // user-touched) since the query was taken is skipped, never stomped.
          ConditionExpression:
            'attribute_exists(PK) AND #categoryId = :null AND ' +
            '(attribute_not_exists(#userCategorized) OR #userCategorized = :false)',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
      updatedCount += 1;
    } catch (err) {
      if (isConditionalCheckFailure(err)) {
        logger.warn('apply-rule skipped a transaction that changed concurrently', {
          ruleId,
          sk: row.SK,
        });
        continue;
      }
      throw err;
    }
  }

  const responseBody: ApplyRuleResponse = {
    ruleId,
    matchedCount: matches.length,
    updatedCount,
  };
  return json(200, responseBody);
}
