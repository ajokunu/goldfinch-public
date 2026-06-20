/**
 * Daily price-per-share snapshot writer (Investments chart).
 *
 * After each successful run, sync writes ONE
 * HOLDINGPRICE#<accountId>#<symbol>#<yyyy-mm-dd> item per held position that has
 * a symbol and a derivable price (idempotent overwrite within a calendar day,
 * DEFAULT_TZ — the same calendar every SK date in the table uses). History
 * accrues from first deploy; there is no synthetic backfill (the client chart
 * states its start date when sparse, like the net-worth chart).
 *
 * Inputs are the household's HOLDING# items READ FROM THE TABLE (the items
 * ingestHoldings just wrote this run), so each snapshot reflects this run's
 * market value.
 *
 * price-per-share = market_value / shares comes from the SINGLE shared helper
 * `pricePerShareMinor` — the SAME math the API `currentPrice` DTO uses — so the
 * displayed price and the charted history cannot drift. A position with no
 * symbol, or shares <= 0 / non-numeric (no derivable price), is skipped with a
 * count (structurally dirty rows degrade, they never abort the run).
 *
 * SYNC-SAFETY BY CONSTRUCTION: this writer only ever PUTs HOLDINGPRICE# items
 * and never deletes anything, and the holdings replace logic (holdings.ts) only
 * enumerates HOLDING# SKs — the HOLDINGPRICE# namespace is disjoint — so a price
 * snapshot survives every sync with no allow-list entry.
 */

import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DEFAULT_TZ, SCHEMA_VERSION } from '@goldfinch/shared/constants';
import { isoDateInTz } from '@goldfinch/shared/dates';
import { pricePerShareMinor } from '@goldfinch/shared/holdingReturn';
import { KEY_PREFIX, holdingPriceSnapshotSk, userPk } from '@goldfinch/shared/keys';
import type { UserPk } from '@goldfinch/shared/keys';
import type { Logger } from '@goldfinch/shared/logger';
import type { HoldingItem, HoldingPriceSnapshotItem } from '@goldfinch/shared/types';

import type { DdbItem, DocClient } from './writer.js';

export interface HoldingPriceSnapshotOptions {
  docClient: DocClient;
  tableName: string;
  household: string;
  now: Date;
  logger: Logger;
}

export interface HoldingPriceSnapshotResult {
  snapshotsWritten: number;
  /** Positions skipped: no usable symbol, or no derivable price. */
  skipped: number;
}

/** All HOLDING# items in the household partition (paginated begins_with Query). */
async function loadHoldings(
  docClient: DocClient,
  tableName: string,
  pk: UserPk,
): Promise<HoldingItem[]> {
  const holdings: HoldingItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': KEY_PREFIX.holding },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const raw of response.Items ?? []) {
      holdings.push(raw as unknown as HoldingItem);
    }
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey !== undefined);
  return holdings;
}

/**
 * Compute and Put today's HOLDINGPRICE# snapshots — one per (accountId, symbol)
 * with a derivable price. Re-running on the same calendar day overwrites in
 * place (later run wins, it has fresher values). Additive: never deletes.
 */
export async function writeHoldingPriceSnapshots(
  options: HoldingPriceSnapshotOptions,
): Promise<HoldingPriceSnapshotResult> {
  const { docClient, tableName, household, now, logger } = options;
  const pk = userPk(household);
  const date = isoDateInTz(now, DEFAULT_TZ);

  const holdings = await loadHoldings(docClient, tableName, pk);
  let snapshotsWritten = 0;
  let skipped = 0;

  for (const holding of holdings) {
    if (holding.entityType !== 'HOLDING') {
      continue;
    }
    const { accountId, symbol, currency } = holding;
    // Symbol-less positions cannot be keyed by (accountId, symbol); a '#' would
    // corrupt the composite SK (and would throw in holdingPriceSnapshotSk). A
    // missing accountId/currency is a corrupt row. Any of these -> skip, never
    // abort the run.
    if (
      typeof symbol !== 'string' ||
      symbol.length === 0 ||
      symbol.includes('#') ||
      typeof accountId !== 'string' ||
      accountId.length === 0 ||
      typeof currency !== 'string' ||
      currency.length === 0
    ) {
      skipped += 1;
      continue;
    }
    const priceMinor = pricePerShareMinor(holding.marketValueMinor, holding.shares);
    if (priceMinor === undefined) {
      // shares <= 0 / non-numeric / unsafe result: no derivable price.
      skipped += 1;
      continue;
    }
    const item: HoldingPriceSnapshotItem = {
      PK: pk,
      SK: holdingPriceSnapshotSk(accountId, symbol, date),
      entityType: 'HOLDING_PRICE_SNAPSHOT',
      schemaVersion: SCHEMA_VERSION,
      date,
      accountId,
      symbol,
      currency,
      pricePerShareMinor: priceMinor,
      createdAt: now.toISOString(),
    };
    await docClient.send(new PutCommand({ TableName: tableName, Item: item as DdbItem }));
    snapshotsWritten += 1;
  }

  logger.info('holding price snapshots written', {
    date,
    snapshotsWritten,
    skipped,
    holdingCount: holdings.length,
  });
  return { snapshotsWritten, skipped };
}
