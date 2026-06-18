/**
 * Daily net-worth snapshot writer (P7-4, reconciled with P7-7).
 *
 * After each successful run, sync writes ONE NETWORTH#<yyyy-mm-dd> item for
 * the household (idempotent overwrite within a calendar day, DEFAULT_TZ —
 * the same calendar every SK date in the table uses). History accrues from
 * first deploy; there is no synthetic backfill.
 *
 * Inputs are the household's ACCT# items READ FROM THE TABLE, not this run's
 * payload — manual accounts (P7-6) and accounts a partial payload omitted
 * still count at their last-known balances.
 *
 * Sign conventions match GET /summary (services/api/src/routes/summary.ts):
 *   - assets:      signed balance as stored, for non-liability accounts;
 *   - liabilities: abs(balance) for liability-classified accounts, whatever
 *     sign the institution reports the amount owed with;
 *   - net = assets - liabilities.
 *
 * Liability classification (P8-4) goes through the SHARED
 * effectiveIsLiability() helper — the sole precedence source for
 * isLiabilityOverride ?? typeOverride ?? synced-type default — so a user's
 * account-type/liability edit reclassifies the very next snapshot exactly
 * like GET /summary does. Never re-derive classification inline here.
 *
 * Multi-currency (P7-7): NO synthetic mixed-currency totals. Each currency
 * gets its own NetWorthCurrencySlice in `perCurrency` (the base currency is
 * always present, zeroed if unused); the item's top-level totals duplicate
 * the base-currency slice per the shared NetWorthSnapshotItem contract.
 */

import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { effectiveIsLiability } from '@goldfinch/shared/accountTypes';
import { DEFAULT_TZ, SCHEMA_VERSION } from '@goldfinch/shared/constants';
import { isoDateInTz } from '@goldfinch/shared/dates';
import { KEY_PREFIX, netWorthSk, userPk } from '@goldfinch/shared/keys';
import type { UserPk } from '@goldfinch/shared/keys';
import type { Logger } from '@goldfinch/shared/logger';
import { addMinor, negateMinor } from '@goldfinch/shared/money';
import type {
  AccountItem,
  CurrencyCode,
  NetWorthCurrencySlice,
  NetWorthSnapshotItem,
} from '@goldfinch/shared/types';

import type { DdbItem, DocClient } from './writer.js';

export interface NetWorthSnapshotOptions {
  docClient: DocClient;
  tableName: string;
  household: string;
  now: Date;
  /** Currency whose slice fills the top-level totals. */
  baseCurrency: CurrencyCode;
  logger: Logger;
}

/** All ACCT# items in the household partition (paginated begins_with Query). */
async function loadAccounts(
  docClient: DocClient,
  tableName: string,
  pk: UserPk,
): Promise<AccountItem[]> {
  const accounts: AccountItem[] = [];
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
      accounts.push(raw as unknown as AccountItem);
    }
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey !== undefined);
  return accounts;
}

/**
 * Fold accounts into per-currency slices. Structurally corrupt rows (missing
 * currency / non-integer balance) are skipped with a warning so one bad item
 * cannot produce a wrong household total silently.
 */
export function computePerCurrency(
  accounts: readonly AccountItem[],
  baseCurrency: CurrencyCode,
  logger: Logger,
): Record<CurrencyCode, NetWorthCurrencySlice> {
  const totals = new Map<CurrencyCode, { assets: number; liabilities: number }>();
  const sliceFor = (currency: CurrencyCode): { assets: number; liabilities: number } => {
    let slice = totals.get(currency);
    if (slice === undefined) {
      slice = { assets: 0, liabilities: 0 };
      totals.set(currency, slice);
    }
    return slice;
  };
  // The base currency is always carried, zeroed when unused (contract).
  sliceFor(baseCurrency);

  for (const account of accounts) {
    if (account.entityType !== 'ACCOUNT') {
      continue;
    }
    if (typeof account.currency !== 'string' || account.currency.length === 0) {
      logger.warn('skipping account with missing currency in net-worth snapshot', {
        sk: account.SK,
      });
      continue;
    }
    if (!Number.isSafeInteger(account.balanceMinor)) {
      logger.warn('skipping account with non-integer balanceMinor in net-worth snapshot', {
        sk: account.SK,
        balanceMinor: account.balanceMinor,
      });
      continue;
    }
    const slice = sliceFor(account.currency);
    // P8-4: the shared helper honors isLiabilityOverride/typeOverride and
    // logs (never throws) on dirty stored values.
    if (effectiveIsLiability(account, logger)) {
      slice.liabilities = addMinor(slice.liabilities, Math.abs(account.balanceMinor));
    } else {
      slice.assets = addMinor(slice.assets, account.balanceMinor);
    }
  }

  const perCurrency: Record<CurrencyCode, NetWorthCurrencySlice> = {};
  for (const currency of [...totals.keys()].sort()) {
    const { assets, liabilities } = totals.get(currency)!;
    perCurrency[currency] = {
      assetsMinor: assets,
      liabilitiesMinor: liabilities,
      netMinor: addMinor(assets, negateMinor(liabilities)),
    };
  }
  return perCurrency;
}

/**
 * Compute and Put today's NETWORTH# snapshot. Re-running on the same calendar
 * day overwrites in place (later run wins — it has fresher balances).
 */
export async function writeNetWorthSnapshot(
  options: NetWorthSnapshotOptions,
): Promise<NetWorthSnapshotItem> {
  const { docClient, tableName, household, now, baseCurrency, logger } = options;
  const pk = userPk(household);
  const date = isoDateInTz(now, DEFAULT_TZ);

  const accounts = await loadAccounts(docClient, tableName, pk);
  const perCurrency = computePerCurrency(accounts, baseCurrency, logger);
  const baseSlice = perCurrency[baseCurrency]!;

  const item: NetWorthSnapshotItem = {
    PK: pk,
    SK: netWorthSk(date),
    entityType: 'NETWORTH_SNAPSHOT',
    schemaVersion: SCHEMA_VERSION,
    date,
    currency: baseCurrency,
    assetsMinor: baseSlice.assetsMinor,
    liabilitiesMinor: baseSlice.liabilitiesMinor,
    netMinor: baseSlice.netMinor,
    perCurrency,
    createdAt: now.toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: tableName, Item: item as DdbItem }));

  logger.info('net-worth snapshot written', {
    date,
    currencies: Object.keys(perCurrency),
    netMinor: item.netMinor,
    accountCount: accounts.length,
  });
  return item;
}
