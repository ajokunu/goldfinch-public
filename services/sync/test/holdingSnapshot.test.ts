/**
 * Daily HOLDINGPRICE#<accountId>#<symbol>#<date> snapshot writer (Investments
 * chart): one item per position with a symbol + derivable price-per-share
 * (market_value / shares via the shared helper), skips symbol-less / zero /
 * non-numeric-share positions, overwrites same-day re-runs in place, and — the
 * load-bearing guarantee — a price snapshot SURVIVES a holdings replace because
 * the replace logic only enumerates HOLDING# SKs.
 */

import { KEY_PREFIX, holdingPriceSnapshotSk, holdingSk, userPk } from '@goldfinch/shared/keys';
import type { SimpleFinAccount } from '@goldfinch/shared/simplefin';
import { describe, expect, it } from 'vitest';

import { writeHoldingPriceSnapshots } from '../src/holdingSnapshot.js';
import { ingestHoldings } from '../src/holdings.js';
import { captureLogger } from './capture-logger.js';
import { FakeDdb } from './fake-ddb.js';
import { HOUSEHOLD, NOW, TABLE_NAME } from './fixtures.js';

const PK = userPk(HOUSEHOLD);
/** NOW is 2026-06-09T13:00Z == 09:00 ET; snapshots date in DEFAULT_TZ. */
const TODAY = '2026-06-09';

function holding(
  accountId: string,
  holdingId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    PK,
    SK: holdingSk(accountId, holdingId),
    entityType: 'HOLDING',
    schemaVersion: 1,
    accountId,
    holdingId,
    symbol: 'VTI',
    description: 'Vanguard Total Stock Market ETF',
    shares: '100',
    marketValueMinor: 1000000, // $10,000.00 over 100 shares -> $100.00/share
    currency: 'USD',
    asOf: NOW.toISOString(),
    ...overrides,
  };
}

async function run(ddb: FakeDdb, now: Date = NOW) {
  const captured = captureLogger();
  const result = await writeHoldingPriceSnapshots({
    docClient: ddb.asDocClient(),
    tableName: TABLE_NAME,
    household: HOUSEHOLD,
    now,
    logger: captured.logger,
  });
  return { result, captured };
}

describe('writeHoldingPriceSnapshots', () => {
  it('writes one HOLDINGPRICE#<accountId>#<symbol>#<date> per position with a derivable price', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(holding('ACT-1', 'HOL-vti'));

    const { result } = await run(ddb);

    expect(result).toEqual({ snapshotsWritten: 1, skipped: 0 });
    const stored = ddb.getItem(PK, holdingPriceSnapshotSk('ACT-1', 'VTI', TODAY));
    expect(stored).toMatchObject({
      entityType: 'HOLDING_PRICE_SNAPSHOT',
      date: TODAY,
      accountId: 'ACT-1',
      symbol: 'VTI',
      currency: 'USD',
      pricePerShareMinor: 10000, // $100.00
    });
    expect(stored?.createdAt).toBe(NOW.toISOString());
  });

  it('skips positions with no symbol or no derivable price (shares <= 0 / non-numeric)', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(holding('ACT-1', 'HOL-nosym', { symbol: undefined }));
    ddb.putItem(holding('ACT-2', 'HOL-zero', { symbol: 'ZRO', shares: '0' }));
    ddb.putItem(holding('ACT-3', 'HOL-bad', { symbol: 'BAD', shares: 'not-a-number' }));
    ddb.putItem(holding('ACT-4', 'HOL-ok', { symbol: 'OK', shares: '10', marketValueMinor: 50000 }));

    const { result } = await run(ddb);

    expect(result).toEqual({ snapshotsWritten: 1, skipped: 3 });
    expect(ddb.listSks(PK, KEY_PREFIX.holdingPrice)).toEqual([
      holdingPriceSnapshotSk('ACT-4', 'OK', TODAY),
    ]);
  });

  it('is idempotent per calendar day (same-day re-run overwrites in place)', async () => {
    const ddb = new FakeDdb();
    ddb.putItem(holding('ACT-1', 'HOL-vti', { marketValueMinor: 1000000, shares: '100' }));
    await run(ddb);
    // Price moves; a same-day re-run replaces the single dated item.
    ddb.putItem(holding('ACT-1', 'HOL-vti', { marketValueMinor: 1100000, shares: '100' }));
    await run(ddb);

    const sks = ddb.listSks(PK, KEY_PREFIX.holdingPrice);
    expect(sks).toEqual([holdingPriceSnapshotSk('ACT-1', 'VTI', TODAY)]);
    expect(ddb.getItem(PK, sks[0]!)?.pricePerShareMinor).toBe(11000); // $110.00
  });

  it('a price snapshot SURVIVES a holdings replace (sync-safe by construction)', async () => {
    const ddb = new FakeDdb();
    // A prior-day price snapshot for a position.
    const priorSk = holdingPriceSnapshotSk('ACT-invest-1', 'VTI', '2026-06-01');
    ddb.putItem({
      PK,
      SK: priorSk,
      entityType: 'HOLDING_PRICE_SNAPSHOT',
      schemaVersion: 1,
      date: '2026-06-01',
      accountId: 'ACT-invest-1',
      symbol: 'VTI',
      currency: 'USD',
      pricePerShareMinor: 9000,
      createdAt: '2026-06-01T13:00:00.000Z',
    });
    // A stale HOLDING# the replace WILL delete (empty holdings array).
    ddb.putItem(holding('ACT-invest-1', 'HOL-old'));

    const captured = captureLogger();
    const account: SimpleFinAccount = {
      id: 'ACT-invest-1',
      name: 'Brokerage',
      currency: 'USD',
      balance: '10000.00',
      'balance-date': Math.trunc(NOW.getTime() / 1000),
      org: { domain: 'b.com', name: 'B', 'sfin-url': 'https://bridge.example.com/simplefin' },
      transactions: [],
      holdings: [],
    };
    await ingestHoldings([account], {
      docClient: ddb.asDocClient(),
      tableName: TABLE_NAME,
      household: HOUSEHOLD,
      now: NOW,
      logger: captured.logger,
    });

    // The empty holdings array deleted the HOLDING# item but never the
    // HOLDINGPRICE# item — disjoint SK namespace, untouched by replace.
    expect(ddb.getItem(PK, holdingSk('ACT-invest-1', 'HOL-old'))).toBeUndefined();
    expect(ddb.getItem(PK, priorSk)).toBeTruthy();
  });
});
