/**
 * SimpleFIN investment-holdings ingestion (P7-3).
 *
 * The SimpleFIN beta `holdings` array is typed `unknown[]` on the wire
 * (institution support is spotty and the field set is beta), so every entry
 * is validated defensively here: a malformed entry is logged with context and
 * skipped — never silently dropped, never allowed to poison the batch.
 *
 * Semantics:
 *   - REPLACE PER ACCOUNT: when an account's payload carries a holdings array
 *     (even an empty one), that account's HOLDING#<accountId>#<holdingId>
 *     items are replaced wholesale — fresh entries Put, stale SKs Deleted.
 *     An account WITHOUT a holdings array is left untouched (the institution
 *     did not report; absence is not "sold everything").
 *   - `asOf` is stamped from the holding's `created` epoch when present,
 *     falling back to the account's balance-date, then the run clock.
 *   - `shares` is carried as a DecimalString (fractional shares are not
 *     money); monetary fields parse through the shared money helpers into
 *     integer minor units — never floats.
 *
 * holdingsSupported (AccountItem): true once the bridge has EVER returned a
 * holdings array for the account ("ever" is honored by merging the prior
 * flag into the fresh item before the account write), false when it has not —
 * the UI renders an explicit unsupported state on false, never a blank.
 */

import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SCHEMA_VERSION } from '@goldfinch/shared/constants';
import { KEY_PREFIX, holdingPrefix, holdingSk, userPk } from '@goldfinch/shared/keys';
import type { UserPk } from '@goldfinch/shared/keys';
import type { Logger } from '@goldfinch/shared/logger';
import { parseCurrencyAmount } from '@goldfinch/shared/money';
import type { SimpleFinAccount } from '@goldfinch/shared/simplefin';
import type {
  AccountItem,
  EpochSeconds,
  HoldingItem,
} from '@goldfinch/shared/types';

import type { SyncAccountItem } from './types.js';
import type { DdbItem, DocClient } from './writer.js';

/** Decimal-string shape for `shares` (sign allowed; never parsed as float). */
const SHARES_PATTERN = /^[+-]?\d+(\.\d+)?$/;

/** The SimpleFIN beta holding fields, all unverified until parsed. */
interface SimpleFinHoldingWire {
  id?: unknown;
  created?: unknown;
  currency?: unknown;
  cost_basis?: unknown;
  description?: unknown;
  market_value?: unknown;
  purchase_price?: unknown;
  shares?: unknown;
  symbol?: unknown;
}

export interface HoldingsIngestOptions {
  docClient: DocClient;
  tableName: string;
  household: string;
  now: Date;
  logger: Logger;
}

export interface HoldingsIngestResult {
  /** Accounts whose payload carried a holdings array (replaced this run). */
  accountsWithHoldings: number;
  holdingsWritten: number;
  /** Stale HOLDING# rows removed by replace semantics. */
  holdingsDeleted: number;
  /** Malformed entries skipped (each one logged with context). */
  entriesSkipped: number;
}

type ParseResult =
  | { ok: true; item: HoldingItem }
  | { ok: false; reason: string };

function parseHolding(
  raw: unknown,
  account: SimpleFinAccount,
  pk: UserPk,
  nowEpoch: EpochSeconds,
  nowIso: string,
): ParseResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'holding entry is not an object' };
  }
  const wire = raw as SimpleFinHoldingWire;

  if (typeof wire.id !== 'string' || wire.id.length === 0) {
    return { ok: false, reason: 'holding id missing or not a string' };
  }
  if (wire.id.includes('#')) {
    return { ok: false, reason: 'holding id contains "#" (would corrupt the SK)' };
  }
  if (typeof wire.shares !== 'string' || !SHARES_PATTERN.test(wire.shares.trim())) {
    return { ok: false, reason: 'holding shares missing or not a decimal string' };
  }
  const currency =
    typeof wire.currency === 'string' && wire.currency.length > 0
      ? wire.currency
      : account.currency;
  if (typeof wire.market_value !== 'string') {
    return { ok: false, reason: 'holding market_value missing or not a string' };
  }
  let marketValueMinor: number;
  try {
    marketValueMinor = parseCurrencyAmount(wire.market_value, currency);
  } catch (err) {
    return {
      ok: false,
      reason: `holding market_value is not parseable money: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const symbol = typeof wire.symbol === 'string' && wire.symbol.length > 0 ? wire.symbol : undefined;
  const description =
    typeof wire.description === 'string' && wire.description.length > 0
      ? wire.description
      : (symbol ?? wire.id);
  const asOf: EpochSeconds =
    typeof wire.created === 'number' && Number.isFinite(wire.created)
      ? Math.trunc(wire.created)
      : (account['balance-date'] ?? nowEpoch);

  const item: HoldingItem = {
    PK: pk,
    SK: holdingSk(account.id, wire.id),
    entityType: 'HOLDING',
    schemaVersion: SCHEMA_VERSION,
    accountId: account.id,
    holdingId: wire.id,
    description,
    shares: wire.shares.trim(),
    marketValueMinor,
    currency,
    asOf,
    lastSyncedAt: nowIso,
  };
  if (symbol !== undefined) {
    item.symbol = symbol;
  }
  if (typeof wire.cost_basis === 'string') {
    let parsedCostBasis: number;
    try {
      parsedCostBasis = parseCurrencyAmount(wire.cost_basis, currency);
    } catch {
      // Strict by design: a present-but-unparseable money field means the
      // entry is suspect, so the whole position is skipped (and logged by the
      // caller) rather than persisted half-correct.
      return {
        ok: false,
        reason: `holding cost_basis is not parseable money: "${wire.cost_basis}"`,
      };
    }
    // The bridge reports cost_basis "0" for accounts that don't actually track
    // it (employer 401k/403b plans, HSAs, many IRAs). A position WITH market
    // value but a zero basis is "unknown", not a real zero-cost lot — leaving
    // costBasisMinor unset makes every reader (HoldingsTable, the Investments
    // aggregate) render "—" via its costBasisComplete/undefined checks instead
    // of a misleading $0.00. A genuine zero-cost lot is vanishingly rare here
    // and not worth showing a false 100%-gain for.
    if (parsedCostBasis !== 0) {
      item.costBasisMinor = parsedCostBasis;
    }
  }
  if (typeof wire.purchase_price === 'string') {
    let parsedPurchasePrice: number;
    try {
      parsedPurchasePrice = parseCurrencyAmount(wire.purchase_price, currency);
    } catch {
      // Strict by design, mirroring cost_basis: a present-but-unparseable money
      // field means the entry is suspect, so the whole position is skipped (and
      // logged by the caller) rather than persisted half-correct.
      return {
        ok: false,
        reason: `holding purchase_price is not parseable money: "${wire.purchase_price}"`,
      };
    }
    // Same zero-guard as cost_basis: the bridge reports purchase_price "0" for
    // accounts that don't track it (the household's tax-advantaged plans), so a
    // 0 is "unavailable", not a real zero-cost lot — leaving purchasePriceMinor
    // unset keeps it from masquerading as a feed cost source. It is an additive
    // fallback only; it never blocks the manual basis path.
    if (parsedPurchasePrice !== 0) {
      item.purchasePriceMinor = parsedPurchasePrice;
    }
  }
  return { ok: true, item };
}

/** All existing HOLDING# SKs for one account (paginated begins_with Query). */
async function listHoldingSks(
  docClient: DocClient,
  tableName: string,
  pk: UserPk,
  accountId: string,
): Promise<string[]> {
  const sks: string[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': holdingPrefix(accountId) },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const raw of response.Items ?? []) {
      const sk = (raw as { SK?: unknown }).SK;
      if (typeof sk === 'string') {
        sks.push(sk);
      }
    }
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey !== undefined);
  return sks;
}

/**
 * Ingest holdings for every account in the payload that carries a holdings
 * array, with replace-per-account semantics. Errors from DynamoDB propagate
 * (idempotent writes; the next run repairs); malformed ENTRIES are logged
 * and skipped so one bad position cannot block the rest.
 */
export async function ingestHoldings(
  accounts: readonly SimpleFinAccount[],
  options: HoldingsIngestOptions,
): Promise<HoldingsIngestResult> {
  const { docClient, tableName, household, now, logger } = options;
  const pk = userPk(household);
  const nowEpoch = Math.trunc(now.getTime() / 1000) as EpochSeconds;
  const nowIso = now.toISOString();

  const result: HoldingsIngestResult = {
    accountsWithHoldings: 0,
    holdingsWritten: 0,
    holdingsDeleted: 0,
    entriesSkipped: 0,
  };

  for (const account of accounts) {
    if (account.holdings === undefined) {
      continue; // institution did not report holdings: leave items untouched
    }
    result.accountsWithHoldings += 1;

    const fresh: HoldingItem[] = [];
    account.holdings.forEach((raw, index) => {
      const parsed = parseHolding(raw, account, pk, nowEpoch, nowIso);
      if (parsed.ok) {
        fresh.push(parsed.item);
      } else {
        result.entriesSkipped += 1;
        logger.warn('skipping malformed SimpleFIN holding', {
          accountId: account.id,
          index,
          reason: parsed.reason,
        });
      }
    });

    const existingSks = await listHoldingSks(docClient, tableName, pk, account.id);
    for (const item of fresh) {
      await docClient.send(
        new PutCommand({ TableName: tableName, Item: item as DdbItem }),
      );
      result.holdingsWritten += 1;
    }
    const freshSks = new Set<string>(fresh.map((item) => item.SK));
    for (const sk of existingSks) {
      if (!freshSks.has(sk)) {
        await docClient.send(
          new DeleteCommand({ TableName: tableName, Key: { PK: pk, SK: sk } }),
        );
        result.holdingsDeleted += 1;
      }
    }
  }

  logger.info('holdings ingestion complete', { ...result });
  return result;
}

/**
 * Prior holdingsSupported flags by simplefinAccountId, read BEFORE the upsert
 * pass so applyHoldingsSupported can merge the sticky flag onto the fresh
 * items (the P8-4 account writer SETs whatever rides the item and never
 * REMOVEs the flag). One small begins_with Query per run.
 */
export async function loadHoldingsSupportFlags(
  docClient: DocClient,
  tableName: string,
  household: string,
): Promise<Map<string, boolean>> {
  const pk = userPk(household);
  const flags = new Map<string, boolean>();
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': KEY_PREFIX.account },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const raw of response.Items ?? []) {
      const account = raw as unknown as AccountItem;
      if (typeof account.simplefinAccountId === 'string') {
        flags.set(account.simplefinAccountId, account.holdingsSupported === true);
      }
    }
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey !== undefined);
  return flags;
}

/**
 * Stamp holdingsSupported on the to-be-written ACCT# items: true when this
 * payload carries a holdings array OR the flag was ever true before (sticky
 * true per the shared contract), false otherwise.
 */
export function applyHoldingsSupported(
  items: SyncAccountItem[],
  wireAccounts: readonly SimpleFinAccount[],
  priorFlags: ReadonlyMap<string, boolean>,
): void {
  const present = new Map<string, boolean>(
    wireAccounts.map((account) => [account.id, account.holdings !== undefined]),
  );
  for (const item of items) {
    item.holdingsSupported =
      present.get(item.simplefinAccountId) === true ||
      priorFlags.get(item.simplefinAccountId) === true;
  }
}
