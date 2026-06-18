/**
 * Daily NETWORTH#<date> snapshot (P7-4 reconciled with P7-7): totals are
 * computed from the STORED ACCT# items, liabilities fold in as abs(balance),
 * every currency gets its own slice (no synthetic mixed totals), the top-level
 * totals duplicate the base-currency slice, and same-day re-runs overwrite.
 */

import { acctSk, netWorthSk, userPk } from '@goldfinch/shared/keys';
import { describe, expect, it } from 'vitest';

import { writeNetWorthSnapshot } from '../src/networth.js';
import { captureLogger } from './capture-logger.js';
import { FakeDdb } from './fake-ddb.js';
import { HOUSEHOLD, NOW, TABLE_NAME } from './fixtures.js';

const PK = userPk(HOUSEHOLD);
/** NOW is 2026-06-09T13:00Z == 09:00 ET; snapshots date in DEFAULT_TZ. */
const TODAY_SK = netWorthSk('2026-06-09');

function account(
  accountId: string,
  accountType: string,
  balanceMinor: number,
  currency = 'USD',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    PK,
    SK: acctSk(accountId),
    entityType: 'ACCOUNT',
    schemaVersion: 1,
    name: accountId,
    accountType,
    institution: 'Example Bank',
    balanceMinor,
    currency,
    balanceDate: Math.trunc(NOW.getTime() / 1000),
    simplefinAccountId: accountId,
    lastSyncedAt: NOW.toISOString(),
    ...overrides,
  };
}

async function snapshot(ddb: FakeDdb, now: Date = NOW) {
  const captured = captureLogger();
  const item = await writeNetWorthSnapshot({
    docClient: ddb.asDocClient(),
    tableName: TABLE_NAME,
    household: HOUSEHOLD,
    now,
    baseCurrency: 'USD',
    logger: captured.logger,
  });
  return { item, captured };
}

describe('writeNetWorthSnapshot', () => {
  it('writes one NETWORTH#<date> item: assets signed, liabilities abs, net = assets - liabilities', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(account('ACT-checking-1', 'checking', 123456));
    ddb.putItem(account('ACT-credit-1', 'credit', -43210)); // owed: abs() folds in
    ddb.putItem(account('ACT-loan-1', 'loan', 200000)); // positive-sign liability

    const { item } = await snapshot(ddb);

    expect(item.SK).toBe(TODAY_SK);
    expect(item.entityType).toBe('NETWORTH_SNAPSHOT');
    expect(item.date).toBe('2026-06-09');
    expect(item.currency).toBe('USD');
    expect(item.assetsMinor).toBe(123456);
    expect(item.liabilitiesMinor).toBe(243210); // 43210 + 200000
    expect(item.netMinor).toBe(-119754);
    expect(item.createdAt).toBe(NOW.toISOString());

    const stored = ddb.getItem(PK, TODAY_SK);
    expect(stored).toEqual(item);
  });

  it('groups by currency with NO synthetic mixed total; top-level totals duplicate the base slice', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(account('ACT-checking-1', 'checking', 123456, 'USD'));
    ddb.putItem(account('ACT-credit-1', 'credit', -43210, 'USD'));
    ddb.putItem(account('ACT-eur-1', 'savings', 50000, 'EUR'));

    const { item } = await snapshot(ddb);

    expect(Object.keys(item.perCurrency).sort()).toEqual(['EUR', 'USD']);
    expect(item.perCurrency.USD).toEqual({
      assetsMinor: 123456,
      liabilitiesMinor: 43210,
      netMinor: 80246,
    });
    expect(item.perCurrency.EUR).toEqual({
      assetsMinor: 50000,
      liabilitiesMinor: 0,
      netMinor: 50000,
    });
    // Top-level == base slice, never USD+EUR mixed.
    expect(item.assetsMinor).toBe(123456);
    expect(item.liabilitiesMinor).toBe(43210);
    expect(item.netMinor).toBe(80246);
  });

  it('always carries the base currency, zeroed when no account uses it', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(account('ACT-eur-1', 'savings', 50000, 'EUR'));

    const { item } = await snapshot(ddb);

    expect(item.perCurrency.USD).toEqual({ assetsMinor: 0, liabilitiesMinor: 0, netMinor: 0 });
    expect(item.assetsMinor).toBe(0);
    expect(item.netMinor).toBe(0);
    expect(item.perCurrency.EUR?.netMinor).toBe(50000);
  });

  it('classifies via effectiveIsLiability: P8-4 overrides reclassify the snapshot immediately', async () => {
    const ddb = new FakeDdb();
    // Synced credit account the user flipped to non-liability: counts as an
    // asset at its SIGNED balance.
    ddb.putItem(account('ACT-credit-1', 'credit', -43210, 'USD', { isLiabilityOverride: false }));
    // Checking account re-typed to loan: the new type's liability default wins.
    ddb.putItem(account('ACT-retyped-1', 'checking', 200000, 'USD', { typeOverride: 'loan' }));
    // Checking account with an explicit liability flip, no type change.
    ddb.putItem(account('ACT-flip-1', 'checking', 50000, 'USD', { isLiabilityOverride: true }));

    const { item } = await snapshot(ddb);

    expect(item.assetsMinor).toBe(-43210);
    expect(item.liabilitiesMinor).toBe(250000); // 200000 + 50000, both abs()
    expect(item.netMinor).toBe(-293210);
  });

  it('ignores an invalid stored typeOverride with a warning and falls back to the synced type', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(account('ACT-credit-1', 'credit', -1000, 'USD', { typeOverride: 'castle' }));

    const { item, captured } = await snapshot(ddb);

    expect(item.liabilitiesMinor).toBe(1000); // synced 'credit' still classifies
    expect(item.assetsMinor).toBe(0);
    expect(
      captured.atLevel('warn').map((line) => line.msg),
    ).toContain('ignoring invalid typeOverride on account item');
  });

  it('skips structurally corrupt account rows with a warning instead of producing a silently wrong total', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(account('ACT-checking-1', 'checking', 123456));
    ddb.putItem(account('ACT-bad-1', 'checking', 12.5)); // float minor units: corrupt
    ddb.putItem(account('ACT-bad-2', 'checking', 1000, ''));

    const { item, captured } = await snapshot(ddb);

    expect(item.assetsMinor).toBe(123456);
    const warns = captured.atLevel('warn');
    expect(warns.map((line) => line.msg).sort()).toEqual([
      'skipping account with missing currency in net-worth snapshot',
      'skipping account with non-integer balanceMinor in net-worth snapshot',
    ]);
  });

  it('overwrites in place on a same-day re-run (later balances win) and never duplicates the SK', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(account('ACT-checking-1', 'checking', 100000));
    await snapshot(ddb);

    ddb.putItem(account('ACT-checking-1', 'checking', 90000)); // balance moved intraday
    const later = new Date('2026-06-09T22:00:00.000Z'); // still 2026-06-09 ET
    const { item } = await snapshot(ddb, later);

    expect(item.SK).toBe(TODAY_SK);
    expect(ddb.listSks(PK, 'NETWORTH#')).toEqual([TODAY_SK]);
    expect(ddb.getItem(PK, TODAY_SK)?.assetsMinor).toBe(90000);
    expect(ddb.getItem(PK, TODAY_SK)?.createdAt).toBe(later.toISOString());
  });

  it('writes distinct items across calendar days so history accrues', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(account('ACT-checking-1', 'checking', 100000));
    await snapshot(ddb);
    await snapshot(ddb, new Date('2026-06-10T13:00:00.000Z'));

    expect(ddb.listSks(PK, 'NETWORTH#')).toEqual([
      netWorthSk('2026-06-09'),
      netWorthSk('2026-06-10'),
    ]);
  });
});
