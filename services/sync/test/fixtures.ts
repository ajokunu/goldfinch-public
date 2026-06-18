/**
 * Shared test fixtures: SimpleFIN wire payloads modeled on the documented
 * /accounts response shape (mixed hyphen/underscore field names, decimal
 * string money, epoch-second timestamps, posted === 0 while pending).
 */

import type {
  SimpleFinAccount,
  SimpleFinAccountSet,
  SimpleFinTransaction,
} from '@goldfinch/shared/simplefin';

export const HOUSEHOLD = 'goldfinch-home';
export const TABLE_NAME = 'GoldFinch-test';
export const ACCESS_URL = 'https://user:secret@bridge.example.com/simplefin';

/** Fixed "now" for deterministic SK dates: 2026-06-09T13:00:00Z. */
export const NOW = new Date('2026-06-09T13:00:00.000Z');

export function epoch(iso: string): number {
  return Math.trunc(new Date(iso).getTime() / 1000);
}

export function checkingAccount(
  transactions: SimpleFinTransaction[],
): SimpleFinAccount {
  return {
    id: 'ACT-checking-1',
    name: 'Everyday Checking',
    currency: 'USD',
    balance: '1234.56',
    'available-balance': '1200.00',
    'balance-date': epoch('2026-06-09T09:00:00Z'),
    org: {
      domain: 'examplebank.com',
      name: 'Example Bank',
      'sfin-url': 'https://bridge.example.com/simplefin',
      id: 'examplebank',
    },
    transactions,
  };
}

export function creditAccount(
  transactions: SimpleFinTransaction[],
): SimpleFinAccount {
  return {
    id: 'ACT-credit-1',
    name: 'Rewards Card',
    currency: 'USD',
    balance: '-432.10',
    'balance-date': epoch('2026-06-09T09:00:00Z'),
    org: {
      domain: 'examplecard.com',
      name: 'Example Card',
      'sfin-url': 'https://bridge.example.com/simplefin',
      id: 'examplecard',
    },
    transactions,
  };
}

export const POSTED_TXN: SimpleFinTransaction = {
  id: 'TXN-posted-1',
  posted: epoch('2026-06-05T12:00:00Z'),
  amount: '-33.27',
  description: 'WHOLEFDS #123',
  payee: 'Whole Foods',
  memo: 'card 1234',
  transacted_at: epoch('2026-06-04T18:30:00Z'),
};

/** Pending: posted === 0, date bucket keys off transacted_at (2026-06-07). */
export const PENDING_TXN: SimpleFinTransaction = {
  id: 'TXN-pending-1',
  posted: 0,
  amount: '-12.50',
  description: 'COFFEE BAR',
  payee: 'Coffee Bar',
  transacted_at: epoch('2026-06-07T08:15:00Z'),
  pending: true,
};

/**
 * The same transaction after posting. With a transacted_at present the SK
 * bucket STAYS at 2026-06-07 (the purchase week) -- only `pending` flips and
 * postedDate becomes the 2026-06-09 clearing date. No re-key. 12:00Z = 08:00 ET;
 * SK dates bucket in DEFAULT_TZ (America/New_York), so a near-midnight UTC epoch
 * would land on the previous ET day.
 */
export const PENDING_TXN_POSTED: SimpleFinTransaction = {
  id: 'TXN-pending-1',
  posted: epoch('2026-06-09T12:00:00Z'),
  amount: '-12.50',
  description: 'COFFEE BAR',
  payee: 'Coffee Bar',
  transacted_at: epoch('2026-06-07T08:15:00Z'),
};

export const CREDIT_TXN: SimpleFinTransaction = {
  id: 'TXN-credit-1',
  posted: epoch('2026-06-06T12:00:00Z'),
  amount: '-89.99',
  description: 'AIRLINE TICKETS',
  payee: 'Example Air',
};

export function baseAccountSet(): SimpleFinAccountSet {
  return {
    errors: [],
    errlist: [],
    accounts: [
      checkingAccount([POSTED_TXN, PENDING_TXN]),
      creditAccount([CREDIT_TXN]),
    ],
  };
}

export function postedAccountSet(): SimpleFinAccountSet {
  return {
    errors: [],
    errlist: [],
    accounts: [
      checkingAccount([POSTED_TXN, PENDING_TXN_POSTED]),
      creditAccount([CREDIT_TXN]),
    ],
  };
}

/**
 * A txn the feed delivers WITHOUT transacted_at. The SK falls back to the sync
 * time while pending (NOW = 2026-06-09) and to `posted` once cleared, so when
 * those land on different days the row genuinely re-keys. This is the ONLY
 * remaining re-key path: transacted_at txns keep a stable bucket from pending
 * through posted, so the crash-safe re-key machinery is exercised here.
 */
export const PENDING_NOTX: SimpleFinTransaction = {
  id: 'TXN-nodate-1',
  posted: 0,
  amount: '-21.00',
  description: 'HARDWARE STORE',
  payee: 'Hardware Store',
  pending: true,
};

/** The same no-transacted_at txn after posting on 2026-06-11: SK shifts 06-09 -> 06-11. */
export const PENDING_NOTX_POSTED: SimpleFinTransaction = {
  id: 'TXN-nodate-1',
  posted: epoch('2026-06-11T12:00:00Z'),
  amount: '-21.00',
  description: 'HARDWARE STORE',
  payee: 'Hardware Store',
};

/** Single-account set exercising the no-transacted_at re-key (pending state). */
export function noTxPendingAccountSet(): SimpleFinAccountSet {
  return {
    errors: [],
    errlist: [],
    accounts: [checkingAccount([PENDING_NOTX])],
  };
}

/** The same set after the txn posts on a later day (the SK genuinely shifts). */
export function noTxPostedAccountSet(): SimpleFinAccountSet {
  return {
    errors: [],
    errlist: [],
    accounts: [checkingAccount([PENDING_NOTX_POSTED])],
  };
}
