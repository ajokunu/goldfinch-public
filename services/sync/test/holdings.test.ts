/**
 * SimpleFIN holdings ingestion (P7-3): replace-per-account semantics, asOf
 * stamping, defensive parsing of the beta wire shape (malformed entries are
 * logged and skipped, never silently dropped), and the sticky
 * holdingsSupported account flag.
 */

import { holdingSk, userPk } from '@goldfinch/shared/keys';
import type { SimpleFinAccount } from '@goldfinch/shared/simplefin';
import { describe, expect, it } from 'vitest';

import {
  applyHoldingsSupported,
  ingestHoldings,
  loadPriorAccountState,
} from '../src/holdings.js';
import type { SyncAccountItem } from '../src/types.js';
import { captureLogger } from './capture-logger.js';
import { FakeDdb } from './fake-ddb.js';
import { HOUSEHOLD, NOW, TABLE_NAME, epoch } from './fixtures.js';

const PK = userPk(HOUSEHOLD);
const BALANCE_DATE = epoch('2026-06-09T09:00:00Z');

function investmentAccount(holdings?: unknown[]): SimpleFinAccount {
  const account: SimpleFinAccount = {
    id: 'ACT-invest-1',
    name: 'Brokerage',
    currency: 'USD',
    balance: '10000.00',
    'balance-date': BALANCE_DATE,
    org: {
      domain: 'examplebroker.com',
      name: 'Example Broker',
      'sfin-url': 'https://bridge.example.com/simplefin',
    },
    transactions: [],
  };
  if (holdings !== undefined) {
    account.holdings = holdings;
  }
  return account;
}

const VTI = {
  id: 'HOL-vti',
  created: epoch('2026-06-08T20:00:00Z'),
  currency: 'USD',
  cost_basis: '5000.00',
  description: 'Vanguard Total Stock Market ETF',
  market_value: '6234.56',
  purchase_price: '200.00',
  shares: '21.5000',
  symbol: 'VTI',
};

const BND = {
  id: 'HOL-bnd',
  // no created: asOf must fall back to the account balance-date
  market_value: '1500.00',
  shares: '20',
  symbol: 'BND',
};

async function ingest(ddb: FakeDdb, accounts: SimpleFinAccount[]) {
  const captured = captureLogger();
  const result = await ingestHoldings(accounts, {
    docClient: ddb.asDocClient(),
    tableName: TABLE_NAME,
    household: HOUSEHOLD,
    now: NOW,
    logger: captured.logger,
  });
  return { result, captured };
}

describe('ingestHoldings', () => {
  it('writes HOLDING# items with parsed money, decimal-string shares, and asOf stamping (created, then balance-date)', async () => {
    const ddb = new FakeDdb();
    const { result } = await ingest(ddb, [investmentAccount([VTI, BND])]);

    expect(result).toEqual({
      accountsWithHoldings: 1,
      holdingsWritten: 2,
      holdingsDeleted: 0,
      entriesSkipped: 0,
    });

    const vti = ddb.getItem(PK, holdingSk('ACT-invest-1', 'HOL-vti'));
    expect(vti?.entityType).toBe('HOLDING');
    expect(vti?.accountId).toBe('ACT-invest-1');
    expect(vti?.holdingId).toBe('HOL-vti');
    expect(vti?.symbol).toBe('VTI');
    expect(vti?.description).toBe('Vanguard Total Stock Market ETF');
    expect(vti?.shares).toBe('21.5000'); // decimal string, never a float
    expect(vti?.marketValueMinor).toBe(623456);
    expect(vti?.costBasisMinor).toBe(500000);
    expect(vti?.purchasePriceMinor).toBe(20000); // feed purchase_price, captured when non-zero
    expect(vti?.currency).toBe('USD');
    expect(vti?.asOf).toBe(VTI.created); // holding's own timestamp wins
    expect(vti?.lastSyncedAt).toBe(NOW.toISOString());

    const bnd = ddb.getItem(PK, holdingSk('ACT-invest-1', 'HOL-bnd'));
    expect(bnd?.asOf).toBe(BALANCE_DATE); // fallback: account balance-date
    expect(bnd?.description).toBe('BND'); // falls back to symbol
    expect(bnd?.costBasisMinor).toBeUndefined();
    expect(bnd?.purchasePriceMinor).toBeUndefined(); // absent on the wire -> unset
  });

  it('treats a bridge-reported cost_basis of 0 as "not provided" (custodians that do not track basis send 0)', async () => {
    const ddb = new FakeDdb();
    const zeroBasis = { ...VTI, id: 'HOL-zerocb', cost_basis: '0.00' };
    await ingest(ddb, [investmentAccount([zeroBasis])]);

    const item = ddb.getItem(PK, holdingSk('ACT-invest-1', 'HOL-zerocb'));
    expect(item?.marketValueMinor).toBe(623456); // the position still has market value
    // 0 basis on a valued position means the custodian doesn't expose it -> unset,
    // so the UI renders "—" rather than a misleading $0.00 / false 100% gain.
    expect(item?.costBasisMinor).toBeUndefined();
  });

  it('treats a bridge-reported purchase_price of 0 as "not provided" (same zero-guard as cost_basis)', async () => {
    const ddb = new FakeDdb();
    const zeroPurchase = { ...VTI, id: 'HOL-zeropp', purchase_price: '0.00' };
    await ingest(ddb, [investmentAccount([zeroPurchase])]);

    const item = ddb.getItem(PK, holdingSk('ACT-invest-1', 'HOL-zeropp'));
    expect(item?.marketValueMinor).toBe(623456); // the position still has market value
    // 0 purchase_price is "unavailable", not a real zero-cost lot -> left unset
    // so it never masquerades as a feed cost source.
    expect(item?.purchasePriceMinor).toBeUndefined();
  });

  it('captures purchase_price when non-zero and omits it when absent', async () => {
    const ddb = new FakeDdb();
    await ingest(ddb, [investmentAccount([VTI, BND])]);

    expect(
      ddb.getItem(PK, holdingSk('ACT-invest-1', 'HOL-vti'))?.purchasePriceMinor,
    ).toBe(20000); // VTI.purchase_price '200.00'
    expect(
      ddb.getItem(PK, holdingSk('ACT-invest-1', 'HOL-bnd'))?.purchasePriceMinor,
    ).toBeUndefined(); // BND has no purchase_price on the wire
  });

  it('never touches a HOLDINGBASIS# item in the partition (replace semantics only Put/Delete HOLDING# SKs)', async () => {
    const ddb = new FakeDdb();
    // A user-owned manual cost-basis row lives under the same household partition
    // but its own SK prefix. Sync only ever enumerates HOLDING# SKs, so this row
    // must survive every ingest run untouched (sync-safe by construction).
    const basisSk = 'HOLDINGBASIS#ACT-invest-1#VTI';
    ddb.putItem({
      PK,
      SK: basisSk,
      entityType: 'HOLDING_BASIS',
      accountId: 'ACT-invest-1',
      symbol: 'VTI',
      costBasisMinor: 480000,
      currency: 'USD',
    });

    // First ingest with positions, then a full sell-out (deletes all HOLDING#).
    await ingest(ddb, [investmentAccount([VTI, BND])]);
    await ingest(ddb, [investmentAccount([])]);

    expect(ddb.listSks(PK, 'HOLDING#')).toHaveLength(0); // all holdings gone
    const survived = ddb.getItem(PK, basisSk);
    expect(survived?.entityType).toBe('HOLDING_BASIS');
    expect(survived?.costBasisMinor).toBe(480000); // untouched by Put-fresh/Delete-stale
    expect(ddb.listSks(PK, 'HOLDINGBASIS#')).toEqual([basisSk]);
  });

  it('replaces per account: positions absent from the new payload are deleted, the rest upserted', async () => {
    const ddb = new FakeDdb();
    await ingest(ddb, [investmentAccount([VTI, BND])]);

    const soldVtiBoughtMore = { ...BND, shares: '25' };
    const { result } = await ingest(ddb, [investmentAccount([soldVtiBoughtMore])]);

    expect(result.holdingsWritten).toBe(1);
    expect(result.holdingsDeleted).toBe(1);
    expect(ddb.getItem(PK, holdingSk('ACT-invest-1', 'HOL-vti'))).toBeUndefined();
    expect(ddb.getItem(PK, holdingSk('ACT-invest-1', 'HOL-bnd'))?.shares).toBe('25');
    expect(ddb.listSks(PK, 'HOLDING#')).toHaveLength(1);
  });

  it('treats an EMPTY holdings array as "sold everything": all positions deleted', async () => {
    const ddb = new FakeDdb();
    await ingest(ddb, [investmentAccount([VTI, BND])]);

    const { result } = await ingest(ddb, [investmentAccount([])]);
    expect(result.accountsWithHoldings).toBe(1);
    expect(result.holdingsDeleted).toBe(2);
    expect(ddb.listSks(PK, 'HOLDING#')).toHaveLength(0);
  });

  it('leaves an account WITHOUT a holdings array untouched (absence is not "sold everything")', async () => {
    const ddb = new FakeDdb();
    await ingest(ddb, [investmentAccount([VTI, BND])]);

    const { result } = await ingest(ddb, [investmentAccount(undefined)]);
    expect(result.accountsWithHoldings).toBe(0);
    expect(result.holdingsDeleted).toBe(0);
    expect(ddb.listSks(PK, 'HOLDING#')).toHaveLength(2);
  });

  it('logs and skips malformed entries individually; one bad position never blocks the rest', async () => {
    const ddb = new FakeDdb();
    const malformed: unknown[] = [
      VTI,
      'not-an-object',
      { ...BND, id: undefined },
      { ...BND, id: 'HOL#hash' }, // would corrupt the SK
      { ...BND, id: 'HOL-badshares', shares: 12.5 }, // float, not decimal string
      { ...BND, id: 'HOL-badmv', market_value: 'lots' },
      { ...BND, id: 'HOL-badcb', cost_basis: 'unknown' },
    ];

    const { result, captured } = await ingest(ddb, [investmentAccount(malformed)]);

    expect(result.holdingsWritten).toBe(1);
    expect(result.entriesSkipped).toBe(6);
    expect(ddb.listSks(PK, 'HOLDING#')).toEqual([holdingSk('ACT-invest-1', 'HOL-vti')]);

    const warns = captured.atLevel('warn');
    expect(warns).toHaveLength(6);
    for (const warn of warns) {
      expect(warn.msg).toBe('skipping malformed SimpleFIN holding');
      expect(warn.accountId).toBe('ACT-invest-1');
      expect(typeof warn.reason).toBe('string');
    }
    expect(warns.map((w) => w.index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps per-account isolation: replacing one account never touches another account\'s positions', async () => {
    const ddb = new FakeDdb();
    const other: SimpleFinAccount = { ...investmentAccount([VTI]), id: 'ACT-invest-2' };
    await ingest(ddb, [investmentAccount([VTI]), other]);
    expect(ddb.listSks(PK, 'HOLDING#')).toHaveLength(2);

    await ingest(ddb, [investmentAccount([])]); // first account sells out
    expect(ddb.listSks(PK, 'HOLDING#')).toEqual([holdingSk('ACT-invest-2', 'HOL-vti')]);
  });
});

describe('holdingsSupported flag', () => {
  function acctItem(simplefinAccountId: string, holdingsSupported?: boolean): SyncAccountItem {
    return {
      simplefinAccountId,
      ...(holdingsSupported === undefined ? {} : { holdingsSupported }),
    } as SyncAccountItem;
  }

  it('stamps true when the payload carries a holdings array, false otherwise', () => {
    const withHoldings = acctItem('ACT-invest-1');
    const without = acctItem('ACT-checking-1');
    applyHoldingsSupported(
      [withHoldings, without],
      [investmentAccount([]), { ...investmentAccount(undefined), id: 'ACT-checking-1' }],
      new Map(),
    );
    expect(withHoldings.holdingsSupported).toBe(true);
    expect(without.holdingsSupported).toBe(false);
  });

  it('is sticky: a previously-true flag survives a payload without holdings', () => {
    const item = acctItem('ACT-invest-1');
    applyHoldingsSupported(
      [item],
      [investmentAccount(undefined)],
      new Map([['ACT-invest-1', true]]),
    );
    expect(item.holdingsSupported).toBe(true);
  });

  it('round-trips through the table via loadPriorAccountState', async () => {
    const ddb = new FakeDdb();
    ddb.putItem({
      PK,
      SK: 'ACCT#ACT-invest-1',
      entityType: 'ACCOUNT',
      simplefinAccountId: 'ACT-invest-1',
      holdingsSupported: true,
      accountType: 'investment',
    });
    ddb.putItem({
      PK,
      SK: 'ACCT#ACT-checking-1',
      entityType: 'ACCOUNT',
      simplefinAccountId: 'ACT-checking-1',
      holdingsSupported: false,
      accountType: 'checking',
    });
    // DISCRIMINATING fixtures: holdingsSupported is DECOUPLED from accountType,
    // so this test fails if the loader keys investmentIds off holdingsSupported
    // (the bug) instead of the stored accountType (the contract).
    //  - a bank/card that reports an empty holdings array (holdingsSupported=true)
    //    but was never investment -> MUST be excluded.
    ddb.putItem({
      PK,
      SK: 'ACCT#ACT-bank-holds',
      entityType: 'ACCOUNT',
      simplefinAccountId: 'ACT-bank-holds',
      holdingsSupported: true,
      accountType: 'other',
    });
    //  - an investment account whose latest payload dropped holdings
    //    (holdingsSupported=false) -> MUST still be included.
    ddb.putItem({
      PK,
      SK: 'ACCT#ACT-invest-nohold',
      entityType: 'ACCOUNT',
      simplefinAccountId: 'ACT-invest-nohold',
      holdingsSupported: false,
      accountType: 'investment',
    });

    const state = await loadPriorAccountState(ddb.asDocClient(), TABLE_NAME, HOUSEHOLD);
    expect(state.holdingsSupported.get('ACT-invest-1')).toBe(true);
    expect(state.holdingsSupported.get('ACT-checking-1')).toBe(false);
    // investmentIds keys off the stored accountType === 'investment', NOT
    // holdingsSupported.
    expect(state.investmentIds.has('ACT-invest-1')).toBe(true);
    expect(state.investmentIds.has('ACT-checking-1')).toBe(false);
    // The decoupling: holdingsSupported=true + accountType!='investment' is OUT;
    // holdingsSupported=false + accountType='investment' is IN.
    expect(state.investmentIds.has('ACT-bank-holds')).toBe(false);
    expect(state.investmentIds.has('ACT-invest-nohold')).toBe(true);
  });
});
