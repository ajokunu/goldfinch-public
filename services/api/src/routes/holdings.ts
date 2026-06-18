/**
 * GET /accounts/{accountId}/holdings (P7-3) and
 * POST /accounts/{accountId}/holdings/{symbol}/cost-basis (Investments
 * enrichment, Part A — user-owned manual cost basis).
 *
 * Holdings are written by the sync Lambda from the SimpleFIN beta `holdings`
 * array. `holdingsSupported` on the GET response is the explicit
 * no-silent-blank signal: false means the institution does not provide holdings
 * via SimpleFIN, and the UI must render that state. When the account item has
 * not recorded the flag yet (pre-Phase-7 sync), the presence of holdings rows
 * is used as the fallback signal.
 *
 * The manual cost basis is a SEPARATE user-owned entity (HOLDING_BASIS), keyed
 * on the stable (accountId, symbol) identity and written ONLY here. It survives
 * every sync by construction (sync never enumerates the HOLDINGBASIS# SK). The
 * GET path joins it onto each holding at read time; the effective-basis
 * precedence and the gain/percent math live in the shared
 * @goldfinch/shared/holdingBasis helpers (the single source of truth).
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SCHEMA_VERSION } from '@goldfinch/shared/constants';
import {
  acctSk,
  holdingBasisPrefix,
  holdingBasisSk,
  holdingPriceHistoryBounds,
  holdingPricePrefix,
  holdingPrefix,
  userPk,
} from '@goldfinch/shared/keys';
import { parseCurrencyAmount } from '@goldfinch/shared/money';
import type {
  AccountItem,
  HoldingBasisItem,
  HoldingDto,
  HoldingItem,
  HoldingPriceHistoryResponse,
  HoldingPriceSnapshotItem,
  IsoDate,
  ListHoldingsResponse,
} from '@goldfinch/shared/types';
import { getIdentity } from '../context.js';
import { ddb, queryAll } from '../ddb.js';
import { nowIso, todayInTz } from '../dates.js';
import { getEnv } from '../env.js';
import { ApiError, json, noContent, parseJsonBody, requirePathParam } from '../http.js';
import { logger } from '../logger.js';
import { toHoldingDto, toHoldingPricePointDto } from '../mapping.js';
import { requireIsoDate } from '../validate.js';

export async function listAccountHoldings(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const accountId = requirePathParam(event, 'accountId');
  const pk = userPk(household);

  const accountRes = await ddb.send(
    new GetCommand({ TableName: env.tableName, Key: { PK: pk, SK: acctSk(accountId) } }),
  );
  const account = accountRes.Item as AccountItem | undefined;
  if (account === undefined) {
    throw new ApiError(404, 'NOT_FOUND', `account "${accountId}" not found`);
  }

  const holdings = await queryAll<HoldingItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk, ':prefix': holdingPrefix(accountId) },
  });
  // Second query: the user's manual cost-basis items for this account. Joined
  // by symbol at read time (the basis row is never an entry in the holdings
  // overwrite set). Orphan basis (no matching held symbol) is silently ignored.
  const basisRows = await queryAll<HoldingBasisItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk, ':prefix': holdingBasisPrefix(accountId) },
  });
  const basisBySymbol = new Map<string, HoldingBasisItem>();
  for (const basis of basisRows) {
    if (basis.entityType === 'HOLDING_BASIS') {
      basisBySymbol.set(basis.symbol, basis);
    }
  }

  const items = holdings
    .filter((item) => item.entityType === 'HOLDING')
    // Sort by market value DESCENDING (largest position first) — the default
    // sort for the enriched Investments tab (Part B).
    .sort((a, b) =>
      a.marketValueMinor < b.marketValueMinor
        ? 1
        : a.marketValueMinor > b.marketValueMinor
          ? -1
          : 0,
    );

  const body: ListHoldingsResponse = {
    items: items.map((item) => toHoldingDto(item, matchedBasis(item, basisBySymbol))),
    holdingsSupported: account.holdingsSupported ?? items.length > 0,
  };
  return json(200, body);
}

/**
 * The manual basis for a holding, attached ONLY when it shares the holding's
 * currency (else ignored + logged, like the orphan case) so the read-time join
 * is always same-currency before gain is computed (P7-7). A symbol-less holding
 * has no basis. An orphan basis (no matching held symbol) is dropped simply by
 * never being looked up.
 */
function matchedBasis(
  holding: HoldingItem,
  basisBySymbol: Map<string, HoldingBasisItem>,
): HoldingBasisItem | undefined {
  if (holding.symbol === undefined) return undefined;
  const basis = basisBySymbol.get(holding.symbol);
  if (basis === undefined) return undefined;
  if (basis.currency !== holding.currency) {
    logger.warn('ignoring manual cost basis with mismatched currency', {
      accountId: holding.accountId,
      symbol: holding.symbol,
      holdingCurrency: holding.currency,
      basisCurrency: basis.currency,
    });
    return undefined;
  }
  return basis;
}

/**
 * POST /accounts/{accountId}/holdings/{symbol}/cost-basis — set or clear the
 * user's manual TOTAL cost basis for a position.
 *
 * Body: `{ amount: DecimalString | null }`. `amount === null` OR an
 * empty/whitespace string CLEARS the basis (deletes the HOLDING_BASIS item so
 * the row falls back to the feed value or the em-dash — never a misleading $0).
 * Otherwise the amount is the decimal string the user typed; the currency is
 * derived from the matched HOLDING# row for (accountId, symbol) (404 if the
 * symbol is not held in that account) and parsed via parseCurrencyAmount,
 * mirroring the goals/contribution precedent. A `#` in the symbol is rejected
 * 400 (it would break the SK; mirrors keys.ts assertComponent).
 */
export async function setHoldingCostBasis(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household, sub } = getIdentity(event);
  const env = getEnv();
  const accountId = requirePathParam(event, 'accountId');
  const symbol = requirePathParam(event, 'symbol');
  const pk = userPk(household);

  // Mirror the keys.ts assertComponent '#'-reject as a 400 (a '#' would break
  // the composite SK; '.'/'-' are valid ticker characters and pass).
  if (symbol.includes('#')) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'symbol must not contain "#"');
  }

  const body = parseJsonBody(event);
  // Read `amount` DIRECTLY (NOT optInt, which collapses null and absent to
  // undefined): null OR an empty/whitespace string clears; otherwise parse.
  const rawAmount = body['amount'];
  const isClear =
    rawAmount === null ||
    (typeof rawAmount === 'string' && rawAmount.trim().length === 0);

  if (isClear) {
    await ddb.send(
      new DeleteCommand({
        TableName: env.tableName,
        Key: { PK: pk, SK: holdingBasisSk(accountId, symbol) },
      }),
    );
    return noContent();
  }

  if (typeof rawAmount !== 'string') {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'amount must be a decimal string or null',
    );
  }

  // Confirm the symbol is held in this account and derive its currency. The
  // holdings list is small (one account's positions); a query + find avoids
  // depending on the opaque holdingId.
  const holdings = await queryAll<HoldingItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk, ':prefix': holdingPrefix(accountId) },
  });
  const holding = holdings.find(
    (item) => item.entityType === 'HOLDING' && item.symbol === symbol,
  );
  if (holding === undefined) {
    throw new ApiError(
      404,
      'NOT_FOUND',
      `holding "${symbol}" is not held in account "${accountId}"`,
    );
  }

  const costBasisMinor = parseCurrencyAmount(rawAmount, holding.currency);
  if (costBasisMinor < 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'amount must not be negative');
  }

  // Read the existing basis (if any) to preserve createdBy/createdAt and bump
  // the optimistic-lock version, mirroring the goals/rules audit shape.
  const existingRes = await ddb.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { PK: pk, SK: holdingBasisSk(accountId, symbol) },
    }),
  );
  const existing = existingRes.Item as HoldingBasisItem | undefined;
  const now = nowIso();

  const item: HoldingBasisItem = {
    PK: pk,
    SK: holdingBasisSk(accountId, symbol),
    entityType: 'HOLDING_BASIS',
    schemaVersion: SCHEMA_VERSION,
    accountId,
    symbol,
    costBasisMinor,
    currency: holding.currency,
    createdBy: existing?.createdBy ?? sub,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    version: (existing?.version ?? 0) + 1,
  };

  await ddb.send(new PutCommand({ TableName: env.tableName, Item: { ...item } }));

  logger.info('set holding cost basis', { accountId, symbol, version: item.version });

  // Echo the enriched holding so the client can replace its row authoritatively
  // (mirrors the goals/contribution route returning the recomputed parent).
  const responseBody: HoldingDto = toHoldingDto(holding, item);
  return json(200, responseBody);
}

/**
 * GET /accounts/{accountId}/holdings/{symbol}/price-history?from&to — the daily
 * price-per-share snapshots sync writes for one position (Investments chart).
 *
 * Mirrors GET /networth/history: defaults to = today (DEFAULT_TZ), from = the
 * earliest snapshot; `firstSnapshotDate` is null until the first snapshot exists
 * (history accrues from first deploy — the chart states its start date, there is
 * no backfill). The server returns the RAW price series; the client normalizes
 * it to a % return via the single shared holdingReturn helper. A `#` in the
 * symbol is rejected 400 (mirrors the keys.ts SK guard).
 */
export async function holdingPriceHistory(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const accountId = requirePathParam(event, 'accountId');
  const symbol = requirePathParam(event, 'symbol');
  const pk = userPk(household);

  if (symbol.includes('#')) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'symbol must not contain "#"');
  }

  const qs = event.queryStringParameters ?? {};
  const to: IsoDate =
    qs['to'] !== undefined ? requireIsoDate(qs['to'], 'to') : todayInTz(env.defaultTz);

  // Earliest snapshot for this position = the `from` default and firstSnapshotDate.
  const firstRes = await ddb.send(
    new QueryCommand({
      TableName: env.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':prefix': holdingPricePrefix(accountId, symbol),
      },
      ScanIndexForward: true,
      Limit: 1,
    }),
  );
  const firstItem = (firstRes.Items ?? [])[0] as HoldingPriceSnapshotItem | undefined;
  const firstSnapshotDate = firstItem?.date ?? null;

  if (firstSnapshotDate === null) {
    const empty: HoldingPriceHistoryResponse = { items: [], firstSnapshotDate: null };
    return json(200, empty);
  }

  const from: IsoDate =
    qs['from'] !== undefined ? requireIsoDate(qs['from'], 'from') : firstSnapshotDate;
  if (from > to) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'from must not be after to');
  }

  // One snapshot per calendar day — bounded, so the queryAll drain is safe.
  const bounds = holdingPriceHistoryBounds(accountId, symbol, from, to);
  const snapshots = await queryAll<HoldingPriceSnapshotItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
    ExpressionAttributeValues: { ':pk': pk, ':start': bounds.start, ':end': bounds.end },
  });

  const body: HoldingPriceHistoryResponse = {
    items: snapshots
      .filter((item) => item.entityType === 'HOLDING_PRICE_SNAPSHOT')
      .map(toHoldingPricePointDto),
    firstSnapshotDate,
  };
  return json(200, body);
}
