/**
 * GET/POST /budgets, PUT/PATCH/DELETE /budgets/{categoryId} (master plan
 * sections 8 and 15).
 *
 * - `spent` for the current calendar month (DEFAULT_TZ) is computed per request
 *   from the sparse GSI2 spend index (read-time aggregation, decision 15.1).
 *   GSI2 holds only categorized non-transfer EXPENSE rows whose amounts are
 *   negative (SimpleFIN sign convention), so spent = -(sum of amountMinor).
 * - POST uses ConditionExpression attribute_not_exists(SK) -> 409 ALREADY_EXISTS.
 * - PUT/PATCH use optimistic locking on `version` -> 409 VERSION_CONFLICT on
 *   mismatch, 404 when the budget does not exist.
 * - Request bodies carry money as decimal strings; items store integer minor units.
 */

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
  budgetSk,
  categorySk,
  gsi2Pk,
  gsiDateRangeBounds,
  userPk,
} from '@goldfinch/shared/keys';
import { addMinor, negateMinor, parseDecimalString } from '@goldfinch/shared/money';
import { type PeriodWindow, periodWindow } from '@goldfinch/shared/periodWindow';
import type {
  BudgetItem,
  BudgetResponse,
  CategoryItem,
  ListBudgetsResponse,
  MinorUnits,
} from '@goldfinch/shared/types';
import { getIdentity } from '../context.js';
import { ddb, isConditionalCheckFailure, queryAll } from '../ddb.js';
import { nowIso } from '../dates.js';
import { type ApiEnv, getEnv } from '../env.js';
import { ApiError, json, noContent, parseJsonBody, requirePathParam } from '../http.js';
import { budgetPeriod, toBudgetDto } from '../mapping.js';
import { optBool, optBudgetPeriod, optString, reqInt, reqString } from '../validate.js';

interface Gsi2SpendRow {
  amountMinor: MinorUnits;
}

/**
 * Sum the GSI2 spend partition for one category over an arbitrary inclusive
 * date window (P11-3) — the window is `periodWindow(budget.period)`, so monthly
 * is the prior current-month behavior and weekly/yearly use the new ranges. The
 * GSI2 query already takes a date BETWEEN range (GSI2SK = date); we pass the
 * period window's from/to. Note: GSI2's INCLUDE projection does not carry
 * `pending`, so pending rows that were explicitly categorized are included; the
 * sync pipeline keeps the index to posted expense rows in the normal path.
 */
export async function windowSpendMinor(
  env: ApiEnv,
  household: string,
  categoryId: string,
  window: PeriodWindow,
): Promise<MinorUnits> {
  const bounds = gsiDateRangeBounds(window.from, window.to);
  const rows = await queryAll<Gsi2SpendRow>({
    TableName: env.tableName,
    IndexName: env.gsi2Name,
    KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':pk': gsi2Pk(household, categoryId),
      ':start': bounds.start,
      ':end': bounds.end,
    },
  });
  // Expense amounts are negative; spent is the positive magnitude.
  return negateMinor(addMinor(0, ...rows.map((row) => row.amountMinor)));
}

async function loadCategoryNames(
  env: ApiEnv,
  household: string,
): Promise<Map<string, string>> {
  const categories = await queryAll<CategoryItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': userPk(household),
      ':prefix': KEY_PREFIX.category,
    },
  });
  return new Map(categories.map((category) => [category.categoryId, category.name]));
}

async function getCategory(
  env: ApiEnv,
  household: string,
  categoryId: string,
): Promise<CategoryItem | undefined> {
  const res = await ddb.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { PK: userPk(household), SK: categorySk(categoryId) },
    }),
  );
  return res.Item as CategoryItem | undefined;
}

export async function listBudgets(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  // One `now` for the whole response so every budget's window is computed
  // against the same instant (a budget can't straddle a second boundary).
  const now = new Date();

  const [budgets, categoryNames] = await Promise.all([
    queryAll<BudgetItem>({
      TableName: env.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': userPk(household),
        ':prefix': KEY_PREFIX.budget,
      },
    }),
    loadCategoryNames(env, household),
  ]);

  // Each budget is summed over ITS OWN period window (P11-3): weekly budgets
  // over this calendar week, monthly over this month, yearly over this year.
  const windows = budgets.map((budget) =>
    periodWindow(budgetPeriod(budget), now, env.defaultTz),
  );
  const spends = await Promise.all(
    budgets.map((budget, i) =>
      windowSpendMinor(env, household, budget.categoryId, windows[i] as PeriodWindow),
    ),
  );
  const items = budgets.map((budget, i) =>
    toBudgetDto(
      budget,
      spends[i] as MinorUnits,
      windows[i] as PeriodWindow,
      categoryNames.get(budget.categoryId),
    ),
  );
  const body: ListBudgetsResponse = { items };
  return json(200, body);
}

export async function createBudget(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const body = parseJsonBody(event);
  const categoryId = reqString(body, 'categoryId');
  const limitMinor = parseDecimalString(reqString(body, 'limit'), 2);
  const rollover = optBool(body, 'rollover') ?? false;
  // P11-3: optional period, validated against the shared BUDGET_PERIODS set
  // (400 on an unknown value). Absent defaults to 'monthly' so existing clients
  // keep creating monthly budgets unchanged.
  const period = optBudgetPeriod(body, 'period') ?? 'monthly';

  const category = await getCategory(env, household, categoryId);
  if (category === undefined || category.archived) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `categoryId "${categoryId}" is not a known active category`,
    );
  }

  const item: BudgetItem = {
    PK: userPk(household),
    SK: budgetSk(categoryId),
    entityType: 'BUDGET',
    schemaVersion: SCHEMA_VERSION,
    categoryId,
    period,
    limitMinor,
    rollover,
    version: 1,
    createdAt: nowIso(),
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
      throw new ApiError(
        409,
        'ALREADY_EXISTS',
        `a budget for category "${categoryId}" already exists`,
      );
    }
    throw err;
  }

  const window = periodWindow(budgetPeriod(item), new Date(), env.defaultTz);
  const spent = await windowSpendMinor(env, household, categoryId, window);
  const responseBody: BudgetResponse = toBudgetDto(item, spent, window, category.name);
  return json(201, responseBody);
}

/** Shared by PATCH and PUT /budgets/{categoryId} (same optimistic-lock update). */
export async function updateBudget(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const categoryId = requirePathParam(event, 'categoryId');
  const body = parseJsonBody(event);
  const version = reqInt(body, 'version');
  const limit = optString(body, 'limit');
  const rollover = optBool(body, 'rollover');
  // P11-3: optional period, validated against the shared BUDGET_PERIODS set
  // (400 on unknown). Absent leaves the stored period unchanged.
  const period = optBudgetPeriod(body, 'period');
  if (limit === undefined && rollover === undefined && period === undefined) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'at least one of limit, rollover, or period is required',
    );
  }

  const names: Record<string, string> = {
    '#version': 'version',
    '#updatedAt': 'updatedAt',
  };
  const values: Record<string, unknown> = {
    ':version': version,
    ':nextVersion': version + 1,
    ':updatedAt': nowIso(),
  };
  const sets = ['#version = :nextVersion', '#updatedAt = :updatedAt'];
  if (limit !== undefined) {
    names['#limitMinor'] = 'limitMinor';
    values[':limitMinor'] = parseDecimalString(limit, 2);
    sets.push('#limitMinor = :limitMinor');
  }
  if (rollover !== undefined) {
    names['#rollover'] = 'rollover';
    values[':rollover'] = rollover;
    sets.push('#rollover = :rollover');
  }
  if (period !== undefined) {
    names['#period'] = 'period';
    values[':period'] = period;
    sets.push('#period = :period');
  }

  let updated: BudgetItem;
  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: env.tableName,
        Key: { PK: userPk(household), SK: budgetSk(categoryId) },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'attribute_exists(PK) AND #version = :version',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      }),
    );
    updated = res.Attributes as BudgetItem;
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      if (err.Item !== undefined) {
        throw new ApiError(409, 'VERSION_CONFLICT', 'budget version does not match');
      }
      throw new ApiError(404, 'NOT_FOUND', `no budget for category "${categoryId}"`);
    }
    throw err;
  }

  // ALL_NEW reflects any period change, so the window covers the budget's
  // current period (P11-3).
  const window = periodWindow(budgetPeriod(updated), new Date(), env.defaultTz);
  const [spent, category] = await Promise.all([
    windowSpendMinor(env, household, categoryId, window),
    getCategory(env, household, categoryId),
  ]);
  const responseBody: BudgetResponse = toBudgetDto(updated, spent, window, category?.name);
  return json(200, responseBody);
}

/**
 * DELETE /budgets/{categoryId} -> 204. Backed by dynamodb:DeleteItem on the
 * table (the GoldFinchTableAccess grant in infra/lib/api-stack.ts; covered by
 * the route<->IAM parity test).
 */
export async function deleteBudget(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const categoryId = requirePathParam(event, 'categoryId');
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: env.tableName,
        Key: { PK: userPk(household), SK: budgetSk(categoryId) },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      throw new ApiError(404, 'NOT_FOUND', `no budget for category "${categoryId}"`);
    }
    throw err;
  }
  return noContent();
}
