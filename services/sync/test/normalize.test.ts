/**
 * Sync-side account enrichment in normalizeForSync.
 *
 * Durable investment classification: SimpleFIN exposes no account type, but
 * only investment-capable accounts carry a `holdings` array. So an account that
 * reports holdings is typed `investment` (an asset) -- the single derivation
 * that lets the Investments tab pick up brokerage accounts with no
 * hand-maintained id list. An explicit ACCOUNT_TYPES_JSON mapping still wins.
 */

import type { SimpleFinAccount, SimpleFinAccountSet } from '@goldfinch/shared/simplefin';
import { describe, expect, it } from 'vitest';

import { RETIREMENT_CONTRIBUTIONS_CATEGORY_ID } from '@goldfinch/shared/constants';

import { normalizeForSync } from '../src/normalize.js';
import { HOUSEHOLD, NOW, epoch } from './fixtures.js';

const BALANCE_DATE = epoch('2026-06-14T09:00:00Z');

function account(id: string, overrides: Partial<SimpleFinAccount> = {}): SimpleFinAccount {
  return {
    id,
    name: id,
    currency: 'USD',
    balance: '100.00',
    'balance-date': BALANCE_DATE,
    org: { domain: 'ex.com', name: 'Ex', 'sfin-url': 'https://bridge.example.com/simplefin' },
    transactions: [],
    ...overrides,
  };
}

function setOf(...accounts: SimpleFinAccount[]): SimpleFinAccountSet {
  return { errors: [], errlist: [], accounts };
}

const POSITION = {
  id: 'HOL-1',
  symbol: 'VTI',
  shares: '10',
  market_value: '2500.00',
  currency: 'USD',
};

describe('normalizeForSync investment classification', () => {
  it('types an account that holds at least one position as investment (asset)', () => {
    const { accounts } = normalizeForSync(setOf(account('ACT-brk', { holdings: [POSITION] })), {
      household: HOUSEHOLD,
      now: NOW,
    });
    expect(accounts[0]!.accountType).toBe('investment');
    // investment is isLiabilityDefault:false -- it adds to net worth.
    expect(accounts[0]!.isLiability).toBe(false);
  });

  it('does NOT type an account with an EMPTY holdings array as investment (banks/cards send [])', () => {
    const { accounts } = normalizeForSync(setOf(account('ACT-bank', { holdings: [] })), {
      household: HOUSEHOLD,
      now: NOW,
    });
    expect(accounts[0]!.accountType).toBe('other');
  });

  it('leaves an account WITHOUT a holdings array at the default type', () => {
    const { accounts } = normalizeForSync(setOf(account('ACT-bank')), {
      household: HOUSEHOLD,
      now: NOW,
    });
    expect(accounts[0]!.accountType).toBe('other');
  });

  it('lets an explicit ACCOUNT_TYPES_JSON mapping win over the holdings inference', () => {
    const { accounts } = normalizeForSync(setOf(account('ACT-brk', { holdings: [POSITION] })), {
      household: HOUSEHOLD,
      now: NOW,
      accountTypes: { 'ACT-brk': 'checking' },
    });
    expect(accounts[0]!.accountType).toBe('checking');
  });
});

describe('normalizeForSync retirement contributions', () => {
  const contribution = {
    id: 'TXN-contrib',
    posted: epoch('2026-06-16T12:00:00Z'),
    amount: '-1762.50',
    payee: 'Contribution',
  };

  it('records an investment-account contribution as POSITIVE income under Retirement Contributions', () => {
    const { transactions } = normalizeForSync(
      setOf(account('ACT-401k', { holdings: [POSITION], transactions: [contribution] })),
      { household: HOUSEHOLD, now: NOW },
    );
    const txn = transactions.find((t) => t.simplefinTxnId === 'TXN-contrib');
    expect(txn).toBeDefined();
    expect(txn!.amountMinor).toBe(176250); // flipped from -176250
    expect(txn!.amountRaw).toBe('1762.50'); // leading minus stripped
    expect(txn!.categoryId).toBe(RETIREMENT_CONTRIBUTIONS_CATEGORY_ID);
    expect(txn!.isTransfer).toBe(false);
  });

  it('leaves a contribution on a NON-investment account untouched (negative, uncategorized)', () => {
    const { transactions } = normalizeForSync(
      setOf(account('ACT-checking', { transactions: [contribution] })), // no holdings -> not investment
      { household: HOUSEHOLD, now: NOW },
    );
    const txn = transactions.find((t) => t.simplefinTxnId === 'TXN-contrib');
    expect(txn!.amountMinor).toBe(-176250);
    expect(txn!.categoryId).toBeNull();
  });

  it('leaves a non-contribution investment txn untouched', () => {
    const dividend = {
      id: 'TXN-div',
      posted: epoch('2026-06-16T12:00:00Z'),
      amount: '12.34',
      payee: 'Dividend',
    };
    const { transactions } = normalizeForSync(
      setOf(account('ACT-401k', { holdings: [POSITION], transactions: [dividend] })),
      { household: HOUSEHOLD, now: NOW },
    );
    const txn = transactions.find((t) => t.simplefinTxnId === 'TXN-div');
    expect(txn!.amountMinor).toBe(1234);
    expect(txn!.categoryId).toBeNull();
  });
});
