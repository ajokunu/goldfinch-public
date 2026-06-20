/**
 * GET /transactions, GET /accounts/{accountId}/transactions,
 * PATCH /transactions/{txnId} (master plan sections 8 and 14).
 *
 * List behavior:
 * - Date range [from, to]; defaults to the current calendar month in DEFAULT_TZ;
 *   capped at MAX_RANGE_DAYS (400 RANGE_TOO_LARGE beyond).
 * - No account filter: base-table Query, SK BETWEEN TXN#<from> AND TXN#<to>~
 *   (the trailing sentinel keeps the last day's #<txnId> suffixes in range).
 * - accountId filter: GSI1 Query. GSI1 uses an INCLUDE projection that lacks
 *   payeeLower/noteLower/version/userCategorized/etc., so each GSI page is
 *   hydrated with per-item GetItem reads (page <= 100 items, trivial at this
 *   volume and within the Query/GetItem-only IAM grant), then q/pendingOnly
 *   filters are applied in-code.
 * - categoryId filter (P8-3): validated against the stored category (400
 *   VALIDATION_ERROR for an unknown id; archived categories stay filterable —
 *   their historical transactions still reference them). EXPENSE categories
 *   are served from the sparse GSI2 spend index (Query on
 *   GSI2PK = USER#<household>#CAT#<categoryId>, hydrated like GSI1 — its
 *   INCLUDE projection carries only amountMinor/payee/accountId), which by
 *   the shared computeGsi2Keys rule contains exactly the categorized,
 *   non-transfer expense rows — matching the spending drill-down semantics.
 *   Income/transfer categories never appear in GSI2, so they fall back to the
 *   base-table (or GSI1, when combined with accountId) query with a
 *   categoryId filter. Combinable with accountId/q/pendingOnly: on the GSI2
 *   path accountId is applied in-code after hydration.
 * - Cursor pagination: opaque base64url LastEvaluatedKey. Done is signalled
 *   ONLY by an absent nextCursor. Cursors are validated to belong to this
 *   household/query AND to fall inside the queried key range before use
 *   (400 BAD_CURSOR otherwise — an out-of-range ExclusiveStartKey would make
 *   DynamoDB throw ValidationException, which must never surface as a 500;
 *   the query path also re-maps that SDK error to BAD_CURSOR as defense in
 *   depth).
 * - Autofill: with a filter active, near-empty pages are refilled by re-querying
 *   up to AUTOFILL_MAX_ITERATIONS times; when the fill overshoots the limit the
 *   next cursor is synthesized from the last returned item's keys.
 *
 * PATCH behavior (category reassign):
 * - Body carries the txn's current date so SK is built directly; the existing
 *   item is then read with GetItem (404 NOT_FOUND when absent) because the
 *   sparse-GSI2 rule needs its isTransfer flag and the optional body `version`
 *   is validated against the stored version (409 VERSION_CONFLICT).
 * - Single UpdateItem atomically rewrites categoryId + GSI2PK/GSI2SK via the
 *   shared computeGsi2Keys rule (SET only for non-transfer EXPENSE rows — the
 *   spend index stays sparse; REMOVE otherwise), sets userCategorized (the
 *   user-override flag), categorizedBy='user', lastEditedBy=<sub>, bumps
 *   version.
 * - ConditionExpression attribute_exists(PK) (+ version when supplied) guards
 *   the read-then-write race: 404 / 409 mapping is preserved on failure.
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  MAX_RANGE_DAYS,
} from '@goldfinch/shared/constants';
import { CursorError, decodeCursor, encodeCursor } from '@goldfinch/shared/cursor';
import {
  categorySk,
  computeGsi2Keys,
  gsi1Pk,
  gsi2Pk,
  gsiDateRangeBounds,
  txnDateRangeBounds,
  txnSk,
  userPk,
} from '@goldfinch/shared/keys';
import type { KeyRangeBounds } from '@goldfinch/shared/keys';
import type {
  CategoryItem,
  IsoDate,
  ListTransactionsResponse,
  PatchTransactionCategoryResponse,
  TransactionItem,
} from '@goldfinch/shared/types';
import { AUTOFILL_MAX_ITERATIONS } from '../config.js';
import { getIdentity } from '../context.js';
import { type DdbKey, ddb, isConditionalCheckFailure } from '../ddb.js';
import { nowIso, rangeDays, todayInTz } from '../dates.js';
import { type ApiEnv, getEnv } from '../env.js';
import { ApiError, json, parseJsonBody, requirePathParam } from '../http.js';
import { logger } from '../logger.js';
import { toTransactionDto } from '../mapping.js';
import { optInt, optString, optText, requireIsoDate } from '../validate.js';

type QueryMode = 'base' | 'gsi1' | 'gsi2';

interface ListParams {
  from: IsoDate;
  to: IsoDate;
  accountId?: string;
  /** P8-3: category filter; expense categories route the query to GSI2. */
  categoryId?: string;
  q?: string;
  pendingOnly: boolean;
  limit: number;
  cursor?: string;
}

function parseListParams(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  tz: string,
  accountIdFromPath?: string,
): ListParams {
  const qs = event.queryStringParameters ?? {};
  const today = todayInTz(tz);
  const to = qs['to'] !== undefined ? requireIsoDate(qs['to'], 'to') : today;
  const from =
    qs['from'] !== undefined ? requireIsoDate(qs['from'], 'from') : `${to.slice(0, 7)}-01`;
  if (from > to) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'from must not be after to');
  }
  if (rangeDays(from, to) > MAX_RANGE_DAYS) {
    throw new ApiError(
      400,
      'RANGE_TOO_LARGE',
      `date range must not exceed ${MAX_RANGE_DAYS} days`,
    );
  }

  let limit = DEFAULT_PAGE_LIMIT;
  const rawLimit = qs['limit'];
  if (rawLimit !== undefined) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'limit must be a positive integer');
    }
    limit = Math.min(parsed, MAX_PAGE_LIMIT);
  }

  const rawQ = qs['q']?.trim().toLowerCase();
  const params: ListParams = {
    from,
    to,
    pendingOnly: qs['pendingOnly'] === 'true' || qs['pendingOnly'] === '1',
    limit,
  };
  if (rawQ !== undefined && rawQ.length > 0) params.q = rawQ;
  const accountId = accountIdFromPath ?? qs['accountId'];
  if (accountId !== undefined && accountId.length > 0) params.accountId = accountId;
  const categoryId = qs['categoryId'];
  if (categoryId !== undefined && categoryId.length > 0) params.categoryId = categoryId;
  const cursor = qs['cursor'];
  if (cursor !== undefined && cursor.length > 0) params.cursor = cursor;
  return params;
}

/** Per-mode cursor shape: the key attributes a LastEvaluatedKey carries. */
const CURSOR_FIELDS: Record<
  QueryMode,
  { required: readonly string[]; indexPkField?: string; sortField: string }
> = {
  base: { required: ['PK', 'SK'], sortField: 'SK' },
  gsi1: {
    required: ['PK', 'SK', 'GSI1PK', 'GSI1SK'],
    indexPkField: 'GSI1PK',
    sortField: 'GSI1SK',
  },
  gsi2: {
    required: ['PK', 'SK', 'GSI2PK', 'GSI2SK'],
    indexPkField: 'GSI2PK',
    sortField: 'GSI2SK',
  },
};

function parseCursorKey(
  cursor: string,
  mode: QueryMode,
  pk: string,
  indexPk: string | undefined,
  bounds: KeyRangeBounds,
): DdbKey {
  let decoded: Record<string, unknown>;
  try {
    decoded = decodeCursor(cursor);
  } catch (err) {
    if (err instanceof CursorError) {
      throw new ApiError(400, 'BAD_CURSOR', err.message);
    }
    throw err;
  }
  const shape = CURSOR_FIELDS[mode];
  for (const field of shape.required) {
    const value = decoded[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new ApiError(400, 'BAD_CURSOR', `cursor is missing ${field}`);
    }
  }
  if (
    decoded['PK'] !== pk ||
    (shape.indexPkField !== undefined && decoded[shape.indexPkField] !== indexPk)
  ) {
    throw new ApiError(400, 'BAD_CURSOR', 'cursor does not match this query');
  }
  // A well-formed cursor replayed against a different date window has a sort
  // key outside the BETWEEN range; DynamoDB rejects such an ExclusiveStartKey
  // with ValidationException, so refuse it here as 400 BAD_CURSOR, not 500.
  const sortValue = decoded[shape.sortField] as string;
  if (sortValue < bounds.start || sortValue > bounds.end) {
    throw new ApiError(400, 'BAD_CURSOR', 'cursor is outside the queried date range');
  }
  return decoded as DdbKey;
}

/**
 * Defense in depth behind parseCursorKey's range check: DynamoDB rejects an
 * ExclusiveStartKey outside the key condition with ValidationException
 * ("The provided starting key is invalid/does not match the input criteria").
 * Map exactly that error to CursorError (-> 400 BAD_CURSOR); everything else
 * propagates untouched.
 */
function isStartingKeyValidationError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const { name, message } = err as { name?: unknown; message?: unknown };
  return name === 'ValidationException' &&
    typeof message === 'string' &&
    /starting key/i.test(message);
}

async function sendQuery(command: QueryCommand): Promise<QueryCommandOutput> {
  try {
    return await ddb.send(command);
  } catch (err) {
    if (isStartingKeyValidationError(err)) {
      throw new CursorError('cursor does not match the queried key range');
    }
    throw err;
  }
}

function keyFromItem(item: TransactionItem, mode: QueryMode): DdbKey {
  switch (mode) {
    case 'base':
      return { PK: item.PK, SK: item.SK };
    case 'gsi1':
      return { PK: item.PK, SK: item.SK, GSI1PK: item.GSI1PK, GSI1SK: item.GSI1SK };
    case 'gsi2':
      // Items on this path were found via the sparse GSI2, so the keys exist.
      return {
        PK: item.PK,
        SK: item.SK,
        GSI2PK: item.GSI2PK as string,
        GSI2SK: item.GSI2SK as string,
      };
  }
}

/**
 * In-code filters applied after an index page is hydrated (the GSI INCLUDE
 * projections lack payeeLower/noteLower/pending). On the GSI2 path accountId
 * is also in-code (the key carries only the category); on the GSI1 path a
 * non-expense categoryId is in-code (those rows are absent from GSI2 by the
 * sparse-index rule).
 */
function applyHydratedFilters(
  items: TransactionItem[],
  params: ListParams,
  mode: QueryMode,
): TransactionItem[] {
  let out = items;
  if (mode === 'gsi2' && params.accountId !== undefined) {
    const accountId = params.accountId;
    out = out.filter((item) => item.accountId === accountId);
  }
  if (mode === 'gsi1' && params.categoryId !== undefined) {
    const categoryId = params.categoryId;
    out = out.filter((item) => item.categoryId === categoryId);
  }
  if (params.q !== undefined) {
    const q = params.q;
    out = out.filter(
      (item) =>
        (item.payeeLower ?? item.payee?.toLowerCase() ?? '').includes(q) ||
        (item.noteLower ?? '').includes(q),
    );
  }
  if (params.pendingOnly) {
    out = out.filter((item) => item.pending === true);
  }
  return out;
}

/** Hydrate index-projected rows into full base-table items (INCLUDE projections). */
async function hydrateItems(
  env: ApiEnv,
  projected: Array<{ PK: string; SK: string }>,
): Promise<TransactionItem[]> {
  const hydrated = await Promise.all(
    projected.map(async (row) => {
      const got = await ddb.send(
        new GetCommand({ TableName: env.tableName, Key: { PK: row.PK, SK: row.SK } }),
      );
      return got.Item as TransactionItem | undefined;
    }),
  );
  return hydrated.filter((item): item is TransactionItem => item !== undefined);
}

interface Page {
  items: TransactionItem[];
  lastEvaluatedKey: DdbKey | undefined;
}

async function queryBasePage(
  env: ApiEnv,
  pk: string,
  params: ListParams,
  exclusiveStartKey: DdbKey | undefined,
): Promise<Page> {
  const bounds = txnDateRangeBounds(params.from, params.to);
  const values: Record<string, unknown> = {
    ':pk': pk,
    ':start': bounds.start,
    ':end': bounds.end,
  };
  const names: Record<string, string> = {};
  const filters: string[] = [];
  if (params.q !== undefined) {
    filters.push('(contains(#payeeLower, :q) OR contains(#noteLower, :q))');
    names['#payeeLower'] = 'payeeLower';
    names['#noteLower'] = 'noteLower';
    values[':q'] = params.q;
  }
  if (params.pendingOnly) {
    filters.push('#pending = :pendingTrue');
    names['#pending'] = 'pending';
    values[':pendingTrue'] = true;
  }
  // P8-3: non-expense category filter (expense categories never reach the
  // base path — they are served from GSI2 in runList).
  if (params.categoryId !== undefined) {
    filters.push('#categoryId = :categoryId');
    names['#categoryId'] = 'categoryId';
    values[':categoryId'] = params.categoryId;
  }
  const res = await sendQuery(
    new QueryCommand({
      TableName: env.tableName,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
      ExpressionAttributeValues: values,
      ...(filters.length > 0
        ? { FilterExpression: filters.join(' AND '), ExpressionAttributeNames: names }
        : {}),
      ScanIndexForward: false,
      Limit: params.limit,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );
  return {
    items: (res.Items ?? []) as TransactionItem[],
    lastEvaluatedKey: res.LastEvaluatedKey,
  };
}

async function queryGsi1Page(
  env: ApiEnv,
  indexPk: string,
  params: ListParams,
  exclusiveStartKey: DdbKey | undefined,
): Promise<Page> {
  const bounds = gsiDateRangeBounds(params.from, params.to);
  const res = await sendQuery(
    new QueryCommand({
      TableName: env.tableName,
      IndexName: env.gsi1Name,
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': indexPk,
        ':start': bounds.start,
        ':end': bounds.end,
      },
      ScanIndexForward: false,
      Limit: params.limit,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );
  const projected = (res.Items ?? []) as Array<{ PK: string; SK: string }>;
  const hydrated = await hydrateItems(env, projected);
  const items = applyHydratedFilters(hydrated, params, 'gsi1');
  return { items, lastEvaluatedKey: res.LastEvaluatedKey };
}

/**
 * P8-3 expense-category page: Query the sparse GSI2 spend index. Same INCLUDE
 * projection treatment as GSI1 — hydrate, then filter in-code.
 */
async function queryGsi2Page(
  env: ApiEnv,
  indexPk: string,
  params: ListParams,
  exclusiveStartKey: DdbKey | undefined,
): Promise<Page> {
  const bounds = gsiDateRangeBounds(params.from, params.to);
  const res = await sendQuery(
    new QueryCommand({
      TableName: env.tableName,
      IndexName: env.gsi2Name,
      KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': indexPk,
        ':start': bounds.start,
        ':end': bounds.end,
      },
      ScanIndexForward: false,
      Limit: params.limit,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );
  const projected = (res.Items ?? []) as Array<{ PK: string; SK: string }>;
  const hydrated = await hydrateItems(env, projected);
  const items = applyHydratedFilters(hydrated, params, 'gsi2');
  return { items, lastEvaluatedKey: res.LastEvaluatedKey };
}

/**
 * P8-3: resolve the category filter's query mode. EXPENSE categories are
 * served from the sparse GSI2 spend index; income/transfer categories never
 * carry GSI2 keys (shared computeGsi2Keys rule), so they keep the base/GSI1
 * mode and filter on categoryId there. Unknown ids are a 400, not an empty
 * 200 — a typo'd filter must be loud.
 */
async function resolveCategoryMode(
  env: ApiEnv,
  pk: string,
  categoryId: string,
): Promise<'gsi2' | undefined> {
  const res = await ddb.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { PK: pk, SK: categorySk(categoryId) },
    }),
  );
  const category = res.Item as CategoryItem | undefined;
  if (category === undefined) {
    logger.warn('transactions list rejected unknown categoryId filter', {
      categoryId,
    });
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `categoryId "${categoryId}" is not a known category`,
    );
  }
  return category.type === 'EXPENSE' ? 'gsi2' : undefined;
}

async function runList(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  accountIdFromPath?: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const params = parseListParams(event, env.defaultTz, accountIdFromPath);
  const pk = userPk(household);

  let mode: QueryMode = params.accountId !== undefined ? 'gsi1' : 'base';
  if (params.categoryId !== undefined) {
    mode = (await resolveCategoryMode(env, pk, params.categoryId)) ?? mode;
  }
  const indexPk =
    mode === 'gsi2'
      ? gsi2Pk(household, params.categoryId as string)
      : mode === 'gsi1'
        ? gsi1Pk(household, params.accountId as string)
        : undefined;

  const filterActive =
    params.q !== undefined || params.pendingOnly || params.categoryId !== undefined;
  const maxIterations = filterActive ? AUTOFILL_MAX_ITERATIONS : 1;

  let exclusiveStartKey: DdbKey | undefined;
  if (params.cursor !== undefined) {
    const bounds =
      mode === 'base'
        ? txnDateRangeBounds(params.from, params.to)
        : gsiDateRangeBounds(params.from, params.to);
    exclusiveStartKey = parseCursorKey(params.cursor, mode, pk, indexPk, bounds);
  }

  const collected: TransactionItem[] = [];
  let lastEvaluatedKey: DdbKey | undefined;
  let iterations = 0;
  do {
    const page =
      mode === 'base'
        ? await queryBasePage(env, pk, params, exclusiveStartKey)
        : mode === 'gsi1'
          ? await queryGsi1Page(env, indexPk as string, params, exclusiveStartKey)
          : await queryGsi2Page(env, indexPk as string, params, exclusiveStartKey);
    collected.push(...page.items);
    lastEvaluatedKey = page.lastEvaluatedKey;
    exclusiveStartKey = page.lastEvaluatedKey;
    iterations += 1;
  } while (
    filterActive &&
    collected.length < params.limit &&
    lastEvaluatedKey !== undefined &&
    iterations < maxIterations
  );

  let items = collected;
  let nextCursor: string | undefined;
  if (collected.length > params.limit) {
    // Overshot while refilling a filtered page: trim and synthesize the cursor
    // from the last returned item (its keys are a valid ExclusiveStartKey).
    items = collected.slice(0, params.limit);
    const last = items[items.length - 1] as TransactionItem;
    nextCursor = encodeCursor(keyFromItem(last, mode));
  } else if (lastEvaluatedKey !== undefined) {
    nextCursor = encodeCursor(lastEvaluatedKey);
  }

  const body: ListTransactionsResponse = {
    items: items.map(toTransactionDto),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
  return json(200, body);
}

export async function listTransactions(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  return runList(event);
}

export async function listAccountTransactions(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const accountId = requirePathParam(event, 'accountId');
  return runList(event, accountId);
}

export async function patchTransaction(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household, sub } = getIdentity(event);
  const env = getEnv();
  const txnId = requirePathParam(event, 'txnId');
  const body = parseJsonBody(event);
  const date = requireIsoDate(body['date'], 'date');
  // categoryId is OPTIONAL: present = (re)assign a category; absent = a
  // note-only edit that leaves the category, userCategorized flag, and GSI2
  // spend index untouched. This is what lets a note be added to an
  // UNcategorized transaction (the whole point of decoupling notes from
  // categorization).
  const categoryId = optString(body, 'categoryId');
  // Length-capped server-side (MAX_TEXT_LENGTHS.transactionNote); stored as
  // typed (no trim) so search/display match what the user entered. Absent =
  // leave the stored note unchanged; empty string = clear it.
  const note = optText(body, 'note', 'transactionNote', { trim: false });
  const expectedVersion = optInt(body, 'version');

  if (categoryId === undefined && note === undefined) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'at least one of categoryId or note must be provided',
    );
  }
  if (categoryId !== undefined && categoryId.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'categoryId must be a non-empty string');
  }

  const pk = userPk(household);
  const sk = txnSk(date, txnId);
  // Always read the transaction (for the optimistic-lock version and, when
  // assigning a category, the isTransfer flag the sparse-GSI2 rule needs).
  // Read the category ONLY when one is being assigned — a note-only edit must
  // not require (or fail on) a category.
  const [txnRes, categoryRes] = await Promise.all([
    ddb.send(new GetCommand({ TableName: env.tableName, Key: { PK: pk, SK: sk } })),
    categoryId !== undefined
      ? ddb.send(
          new GetCommand({
            TableName: env.tableName,
            Key: { PK: pk, SK: categorySk(categoryId) },
          }),
        )
      : Promise.resolve(undefined),
  ]);

  const existing = txnRes.Item as TransactionItem | undefined;
  if (existing === undefined) {
    throw new ApiError(404, 'NOT_FOUND', `transaction "${txnId}" not found on ${date}`);
  }
  if (expectedVersion !== undefined && existing.version !== expectedVersion) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'transaction version does not match');
  }

  let category: CategoryItem | undefined;
  if (categoryId !== undefined) {
    category = categoryRes?.Item as CategoryItem | undefined;
    if (category === undefined || category.archived) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `categoryId "${categoryId}" is not a known active category`,
      );
    }
  }

  const now = nowIso();
  // Always-updated provenance fields (a note-only edit is still an edit).
  const names: Record<string, string> = {
    '#lastEditedBy': 'lastEditedBy',
    '#updatedAt': 'updatedAt',
    '#version': 'version',
  };
  const values: Record<string, unknown> = {
    ':sub': sub,
    ':now': now,
    ':zero': 0,
    ':one': 1,
  };
  const sets = [
    '#lastEditedBy = :sub',
    '#updatedAt = :now',
    '#version = if_not_exists(#version, :zero) + :one',
  ];
  const removes: string[] = [];

  // Category (re)assignment ONLY when a categoryId was supplied: stamp the
  // user-categorized flags and rewrite the sparse GSI2 (per-category spend)
  // index, shared with the AI categorizer — only categorized, NON-TRANSFER
  // EXPENSE transactions get GSI2 keys, so transfers (e.g. credit-card
  // payments) never inflate budget spend. A note-only edit skips ALL of this
  // so the category and spend bucket are left exactly as they were.
  if (categoryId !== undefined) {
    names['#categoryId'] = 'categoryId';
    names['#userCategorized'] = 'userCategorized';
    names['#categorizedBy'] = 'categorizedBy';
    names['#isTransfer'] = 'isTransfer';
    names['#gsi2pk'] = 'GSI2PK';
    names['#gsi2sk'] = 'GSI2SK';
    values[':categoryId'] = categoryId;
    values[':true'] = true;
    values[':user'] = 'user';
    sets.push(
      '#categoryId = :categoryId',
      '#userCategorized = :true',
      '#categorizedBy = :user',
    );
    // Keep isTransfer coherent with the category type: assigning a TRANSFER
    // category marks the row a transfer so EVERY consumer (the client weekly
    // donut, server flow/cashflow) excludes it from spend without relying on a
    // category-type lookup that can race category loading. Monotonic-OR: a row
    // already flagged isTransfer (e.g. a markTransfer rule) stays a transfer.
    const effectiveIsTransfer = category!.type === 'TRANSFER' || existing.isTransfer === true;
    values[':isTransfer'] = effectiveIsTransfer;
    sets.push('#isTransfer = :isTransfer');
    const gsi2Keys = computeGsi2Keys({
      household,
      categoryId,
      categoryType: category!.type,
      isTransfer: effectiveIsTransfer,
      date,
      txnId,
    });
    if (gsi2Keys !== null) {
      values[':gsi2pk'] = gsi2Keys.GSI2PK;
      values[':gsi2sk'] = gsi2Keys.GSI2SK;
      sets.push('#gsi2pk = :gsi2pk', '#gsi2sk = :gsi2sk');
    } else {
      removes.push('#gsi2pk', '#gsi2sk');
    }
  }

  // Note: absent = leave unchanged; empty string = clear (REMOVE); else set.
  if (note !== undefined) {
    names['#note'] = 'note';
    names['#noteLower'] = 'noteLower';
    if (note === '') {
      removes.push('#note', '#noteLower');
    } else {
      values[':note'] = note;
      values[':noteLower'] = note.toLowerCase();
      sets.push('#note = :note', '#noteLower = :noteLower');
    }
  }

  let updateExpression = `SET ${sets.join(', ')}`;
  if (removes.length > 0) {
    updateExpression += ` REMOVE ${removes.join(', ')}`;
  }

  let conditionExpression = 'attribute_exists(PK)';
  if (expectedVersion !== undefined) {
    conditionExpression += ' AND #version = :expectedVersion';
    values[':expectedVersion'] = expectedVersion;
  }

  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: env.tableName,
        Key: { PK: pk, SK: sk },
        UpdateExpression: updateExpression,
        ConditionExpression: conditionExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      }),
    );
    const item = res.Attributes as TransactionItem;
    const responseBody: PatchTransactionCategoryResponse = {
      item: toTransactionDto(item),
    };
    return json(200, responseBody);
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      if (err.Item !== undefined) {
        throw new ApiError(
          409,
          'VERSION_CONFLICT',
          'transaction version does not match',
        );
      }
      throw new ApiError(404, 'NOT_FOUND', `transaction "${txnId}" not found on ${date}`);
    }
    throw err;
  }
}
