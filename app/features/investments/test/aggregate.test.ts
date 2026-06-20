/**
 * Aggregate-holdings math for the Investments tab. The load-bearing
 * invariants: shares sum as EXACT decimal strings (no float), market value as
 * integer minor units, cost basis only when the whole group is complete,
 * currencies never combine into a mixed grand total (P7-7), the default sort is
 * market value DESCENDING, and gain/percentReturn/allocation come from the
 * SHARED holdingBasis helpers (BigInt, signed, truncate toward zero).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { HoldingDto } from '@goldfinch/shared/types';
import {
  addShares,
  aggregateHoldings,
  allocationPercent,
  totalsByCurrency,
  totalsByCurrencyHoldings,
} from '../lib/aggregate.js';

function holding(over: Partial<HoldingDto> & { holdingId: string }): HoldingDto {
  return {
    accountId: 'acct-1',
    description: 'Position',
    shares: '1',
    marketValue: '0',
    marketValueMinor: 0,
    currency: 'USD',
    asOf: 1_700_000_000,
    ...over,
  };
}

describe('addShares (exact decimal strings, no float)', () => {
  it('adds fractional shares exactly', () => {
    assert.equal(addShares('1.5', '2.25'), '3.75');
  });

  it('trims alignment zeros so 10.00 + 5 = 15', () => {
    assert.equal(addShares('10.00', '5'), '15');
  });

  it('handles differing fractional lengths', () => {
    assert.equal(addShares('0.001', '0.1'), '0.101');
  });

  it('carries integer addition without float drift', () => {
    // 0.1 + 0.2 would be 0.30000000000000004 as floats.
    assert.equal(addShares('0.1', '0.2'), '0.3');
  });

  it('supports negatives (a sell reducing the position)', () => {
    assert.equal(addShares('3.5', '-1.25'), '2.25');
  });

  it('treats malformed operands as zero rather than throwing', () => {
    assert.equal(addShares('not-a-number', '4.5'), '4.5');
  });
});

describe('aggregateHoldings', () => {
  it('merges the same symbol/currency across accounts with exact shares', () => {
    const result = aggregateHoldings([
      holding({
        holdingId: 'h1',
        accountId: 'acct-1',
        symbol: 'VTI',
        shares: '1.5',
        marketValueMinor: 30_000,
        costBasisMinor: 20_000,
      }),
      holding({
        holdingId: 'h2',
        accountId: 'acct-2',
        symbol: 'VTI',
        shares: '2.25',
        marketValueMinor: 45_000,
        costBasisMinor: 30_000,
      }),
    ]);

    assert.equal(result.length, 1);
    const vti = result[0]!;
    assert.equal(vti.symbol, 'VTI');
    assert.equal(vti.shares, '3.75'); // exact string, not 3.75 float
    assert.equal(typeof vti.shares, 'string');
    assert.equal(vti.marketValueMinor, 75_000);
    assert.equal(vti.costBasisComplete, true);
    assert.equal(vti.costBasisMinor, 50_000);
    assert.equal(vti.holdingCount, 2);
    // gain = 75_000 - 50_000 = 25_000; percent = 25_000*100/50_000 = 50.
    assert.equal(vti.gainMinor, 25_000);
    assert.equal(vti.percentReturn, 50);
  });

  it('marks cost basis incomplete when any member lacks it and omits the total + P/L', () => {
    const result = aggregateHoldings([
      holding({ holdingId: 'h1', symbol: 'AAPL', costBasisMinor: 10_000 }),
      holding({ holdingId: 'h2', symbol: 'AAPL' }), // no costBasisMinor
    ]);

    assert.equal(result.length, 1);
    const aapl = result[0]!;
    assert.equal(aapl.costBasisComplete, false);
    assert.equal(aapl.gainMinor, undefined);
    assert.equal(aapl.percentReturn, undefined);
    // totalsByCurrency must then drop the basis for this currency.
    const totals = totalsByCurrency(result);
    assert.equal(totals[0]!.costBasisComplete, false);
    assert.equal(totals[0]!.percentReturn, undefined);
  });

  it('never combines currencies into a grand total (P7-7)', () => {
    const positions = aggregateHoldings([
      holding({
        holdingId: 'h1',
        symbol: 'VTI',
        currency: 'USD',
        marketValueMinor: 30_000,
        costBasisMinor: 20_000,
      }),
      holding({
        holdingId: 'h2',
        symbol: 'IWDA',
        currency: 'EUR',
        marketValueMinor: 50_000,
        costBasisMinor: 40_000,
      }),
    ]);
    assert.equal(positions.length, 2);

    const totals = totalsByCurrency(positions);
    assert.deepEqual(
      totals.map((t) => t.currency),
      ['EUR', 'USD'],
    );
    const eur = totals.find((t) => t.currency === 'EUR')!;
    const usd = totals.find((t) => t.currency === 'USD')!;
    assert.equal(eur.marketValueMinor, 50_000);
    assert.equal(usd.marketValueMinor, 30_000);
    // Per-currency P/L, never blended.
    assert.equal(eur.gainMinor, 10_000);
    assert.equal(usd.gainMinor, 10_000);
    assert.equal(usd.percentReturn, 50);
  });

  it('keeps two different unsymboled positions distinct (keyed by description)', () => {
    const result = aggregateHoldings([
      holding({ holdingId: 'h1', symbol: undefined, description: 'Fund A', marketValueMinor: 100 }),
      holding({ holdingId: 'h2', symbol: undefined, description: 'Fund B', marketValueMinor: 200 }),
    ]);
    assert.equal(result.length, 2);
  });

  it('merges the same unsymboled position held in two accounts', () => {
    const result = aggregateHoldings([
      holding({
        holdingId: 'h1',
        accountId: 'acct-1',
        symbol: undefined,
        description: 'House Fund',
        shares: '1',
        marketValueMinor: 100,
      }),
      holding({
        holdingId: 'h2',
        accountId: 'acct-2',
        symbol: undefined,
        description: 'House Fund',
        shares: '2',
        marketValueMinor: 200,
      }),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.shares, '3');
    assert.equal(result[0]!.marketValueMinor, 300);
  });

  it('carries the newest asOf in the group', () => {
    const result = aggregateHoldings([
      holding({ holdingId: 'h1', symbol: 'VOO', marketValueMinor: 100, asOf: 1_700_000_000 }),
      holding({ holdingId: 'h2', symbol: 'VOO', marketValueMinor: 100, asOf: 1_800_000_000 }),
    ]);
    assert.equal(result[0]!.asOf, 1_800_000_000);
  });

  it('sorts by market value descending (the default tab order)', () => {
    const result = aggregateHoldings([
      holding({ holdingId: 'h1', symbol: 'SMALL', currency: 'USD', marketValueMinor: 1_000 }),
      holding({ holdingId: 'h2', symbol: 'BIG', currency: 'USD', marketValueMinor: 90_000 }),
      holding({ holdingId: 'h3', symbol: 'MID', currency: 'USD', marketValueMinor: 30_000 }),
    ]);
    assert.deepEqual(
      result.map((p) => p.symbol),
      ['BIG', 'MID', 'SMALL'],
    );
  });

  it('breaks value ties by currency then symbol', () => {
    const result = aggregateHoldings([
      holding({ holdingId: 'h1', symbol: 'ZZZ', currency: 'USD', marketValueMinor: 10_000 }),
      holding({ holdingId: 'h2', symbol: 'AAA', currency: 'USD', marketValueMinor: 10_000 }),
      holding({ holdingId: 'h3', symbol: 'BBB', currency: 'EUR', marketValueMinor: 10_000 }),
    ]);
    assert.deepEqual(
      result.map((p) => `${p.currency}:${p.symbol}`),
      ['EUR:BBB', 'USD:AAA', 'USD:ZZZ'],
    );
  });

  it('returns empty results for no holdings', () => {
    assert.deepEqual(aggregateHoldings([]), []);
    assert.deepEqual(totalsByCurrency([]), []);
  });
});

describe('editability + accountId carry-through (§9.1)', () => {
  it('a single-account symboled row is editable and carries its accountId', () => {
    const result = aggregateHoldings([
      holding({ holdingId: 'h1', accountId: 'acct-7', symbol: 'VTI', marketValueMinor: 100 }),
    ]);
    assert.equal(result[0]!.editable, true);
    assert.equal(result[0]!.accountId, 'acct-7');
  });

  it('an unsymboled row is never editable (no (accountId, symbol) key)', () => {
    const result = aggregateHoldings([
      holding({ holdingId: 'h1', accountId: 'acct-7', symbol: undefined, marketValueMinor: 100 }),
    ]);
    assert.equal(result[0]!.editable, false);
  });

  it('a group spanning two accounts is non-editable with no single accountId', () => {
    const result = aggregateHoldings([
      holding({ holdingId: 'h1', accountId: 'acct-1', symbol: 'VTI', marketValueMinor: 100 }),
      holding({ holdingId: 'h2', accountId: 'acct-2', symbol: 'VTI', marketValueMinor: 200 }),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.editable, false);
    assert.equal(result[0]!.accountId, undefined);
  });
});

describe('per-position return chart gate (Contract f: accountId && symbol)', () => {
  // The Investments tab enables a holding's inline return chart exactly when the
  // position resolves to a single (accountId, symbol) query target -- the same
  // gate the cost-basis sheet uses. These assertions pin both fields the chart
  // query consumes, so the chart can never fire against an ambiguous group.
  const canShowChart = (position: { accountId?: string; symbol?: string }) =>
    position.accountId !== undefined && position.symbol !== undefined;

  it('exposes BOTH accountId and symbol for a single-account symboled position', () => {
    const [position] = aggregateHoldings([
      holding({ holdingId: 'h1', accountId: 'acct-9', symbol: 'VTI', marketValueMinor: 100 }),
    ]);
    assert.equal(position!.accountId, 'acct-9');
    assert.equal(position!.symbol, 'VTI');
    assert.equal(canShowChart(position!), true);
    // The chart gate and the cost-basis edit gate agree (single source).
    assert.equal(position!.editable, canShowChart(position!));
  });

  it('clears the chart gate for a multi-account group (no single query target)', () => {
    const [position] = aggregateHoldings([
      holding({ holdingId: 'h1', accountId: 'acct-1', symbol: 'VTI', marketValueMinor: 100 }),
      holding({ holdingId: 'h2', accountId: 'acct-2', symbol: 'VTI', marketValueMinor: 200 }),
    ]);
    assert.equal(position!.accountId, undefined);
    assert.equal(canShowChart(position!), false);
  });

  it('clears the chart gate for an unsymboled position', () => {
    const [position] = aggregateHoldings([
      holding({ holdingId: 'h1', accountId: 'acct-3', symbol: undefined, marketValueMinor: 100 }),
    ]);
    assert.equal(position!.symbol, undefined);
    assert.equal(canShowChart(position!), false);
  });
});

describe('currentPrice passthrough', () => {
  it('carries the per-share price for a single lot', () => {
    const result = aggregateHoldings([
      holding({ holdingId: 'h1', symbol: 'VTI', marketValueMinor: 30_000, currentPriceMinor: 20_000 }),
    ]);
    assert.equal(result[0]!.currentPriceMinor, 20_000);
  });

  it('drops the per-share price for a blended (multi-lot) group', () => {
    const result = aggregateHoldings([
      holding({ holdingId: 'h1', accountId: 'a', symbol: 'VTI', marketValueMinor: 30_000, currentPriceMinor: 20_000 }),
      holding({ holdingId: 'h2', accountId: 'a', symbol: 'VTI', marketValueMinor: 45_000, currentPriceMinor: 20_500 }),
    ]);
    assert.equal(result[0]!.currentPriceMinor, undefined);
  });
});

describe('allocationPercent (BigInt, per-currency, truncate toward zero)', () => {
  const position = (marketValueMinor: number) =>
    aggregateHoldings([holding({ holdingId: 'h1', symbol: 'X', marketValueMinor })])[0]!;

  it('computes the position share of the currency total, truncated', () => {
    // 33_333 / 100_000 = 33.333% -> 33 (truncated).
    assert.equal(allocationPercent(position(33_333), 100_000), 33);
  });

  it('returns 100 for a sole position', () => {
    assert.equal(allocationPercent(position(50_000), 50_000), 100);
  });

  it('returns undefined when the currency total is non-positive (no divide-by-zero)', () => {
    assert.equal(allocationPercent(position(0), 0), undefined);
  });
});

describe('percentReturn rounding (shared helper, truncate toward zero)', () => {
  it('truncates a loss toward zero (-74.8% -> -74, not floored to -75)', () => {
    // gain = 50 - 199 = -149 minor; -149*100/199 = -74.87... truncates to -74.
    const result = aggregateHoldings([
      holding({ holdingId: 'h1', symbol: 'L', marketValueMinor: 50, costBasisMinor: 199 }),
    ]);
    assert.equal(result[0]!.gainMinor, -149);
    assert.equal(result[0]!.percentReturn, -74);
  });

  it('omits percentReturn when cost basis is 0 (never divides by zero)', () => {
    const result = aggregateHoldings([
      holding({ holdingId: 'h1', symbol: 'Z', marketValueMinor: 5_000, costBasisMinor: 0 }),
    ]);
    assert.equal(result[0]!.gainMinor, 5_000);
    assert.equal(result[0]!.percentReturn, undefined);
  });
});

describe('totalsByCurrencyHoldings (single source shared with HoldingsTable)', () => {
  it('folds un-aggregated DTOs the same way totalsByCurrency folds positions', () => {
    const holdings = [
      holding({ holdingId: 'h1', symbol: 'VTI', currency: 'USD', marketValueMinor: 30_000, costBasisMinor: 20_000 }),
      holding({ holdingId: 'h2', symbol: 'VOO', currency: 'USD', marketValueMinor: 45_000, costBasisMinor: 30_000 }),
    ];
    const fromHoldings = totalsByCurrencyHoldings(holdings);
    const fromPositions = totalsByCurrency(aggregateHoldings(holdings));
    assert.deepEqual(fromHoldings, fromPositions);
    assert.equal(fromHoldings[0]!.marketValueMinor, 75_000);
    assert.equal(fromHoldings[0]!.gainMinor, 25_000);
    assert.equal(fromHoldings[0]!.percentReturn, 50);
  });

  it('drops basis + P/L for a currency when any holding lacks a cost basis', () => {
    const totals = totalsByCurrencyHoldings([
      holding({ holdingId: 'h1', symbol: 'VTI', marketValueMinor: 30_000, costBasisMinor: 20_000 }),
      holding({ holdingId: 'h2', symbol: 'VOO', marketValueMinor: 45_000 }),
    ]);
    assert.equal(totals[0]!.costBasisComplete, false);
    assert.equal(totals[0]!.percentReturn, undefined);
  });
});
