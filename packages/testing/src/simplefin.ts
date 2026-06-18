/**
 * SimpleFIN wire-payload fixtures matching the real /accounts protocol shapes
 * in @goldfinch/shared/simplefin: `posted` is epoch seconds (0 while pending),
 * `amount`/`balance` are NUMERIC STRINGS (never floats), `pending` is boolean,
 * and `errors`/`errlist` may be present even on HTTP 200.
 *
 * The canned household fixture below feeds the cross-workspace contract-drift
 * suite: two accounts (checking asset + credit liability), posted and pending
 * transactions, and a day-two payload where the pending transaction posts into
 * a DIFFERENT date bucket (the dominant idempotency risk, master plan R8).
 */

import type {
  SimpleFinAccount,
  SimpleFinAccountSet,
  SimpleFinErrlistEntry,
  SimpleFinOrg,
  SimpleFinTransaction,
} from '@goldfinch/shared/simplefin';

export function makeSimpleFinOrg(
  overrides: Partial<SimpleFinOrg> = {},
): SimpleFinOrg {
  return {
    domain: 'testcu.example.com',
    name: 'Test Credit Union',
    'sfin-url': 'https://bridge.simplefin.org/simplefin',
    id: 'org-testcu',
    ...overrides,
  };
}

export function makeSimpleFinTransaction(
  overrides: Partial<SimpleFinTransaction> = {},
): SimpleFinTransaction {
  return {
    id: 'txn-0001',
    // 2026-06-05T16:00:00Z
    posted: 1_780_675_200,
    amount: '-42.15',
    description: 'WHOLE FOODS MARKET #123',
    payee: 'Whole Foods Market',
    pending: false,
    ...overrides,
  };
}

/** Pending transaction: posted=0, pending=true, dated via transacted_at. */
export function makePendingSimpleFinTransaction(
  overrides: Partial<SimpleFinTransaction> = {},
): SimpleFinTransaction {
  return makeSimpleFinTransaction({
    id: 'txn-pending',
    posted: 0,
    pending: true,
    // 2026-06-07T15:30:00Z
    transacted_at: 1_780_846_200,
    amount: '-6.50',
    description: 'PENDING COFFEE',
    payee: 'Blue Bottle Coffee',
    ...overrides,
  });
}

export function makeSimpleFinAccount(
  overrides: Partial<SimpleFinAccount> = {},
): SimpleFinAccount {
  return {
    id: 'sf-acct-checking',
    name: 'Everyday Checking',
    currency: 'USD',
    balance: '5230.55',
    'available-balance': '5180.55',
    // 2026-06-09T12:00:00Z
    'balance-date': 1_781_006_400,
    org: makeSimpleFinOrg(),
    transactions: [],
    ...overrides,
  };
}

export function makeSimpleFinAccountSet(
  accounts: SimpleFinAccount[],
  extra: { errors?: string[]; errlist?: SimpleFinErrlistEntry[] } = {},
): SimpleFinAccountSet {
  const set: SimpleFinAccountSet = { errors: extra.errors ?? [], accounts };
  if (extra.errlist !== undefined) {
    set.errlist = extra.errlist;
  }
  return set;
}

// ---------------------------------------------------------------------------
// Canned household fixture (drives the contract-drift integration suite)
// ---------------------------------------------------------------------------

export const FIXTURE_CHECKING_ID = 'sf-acct-checking';
export const FIXTURE_CREDIT_ID = 'sf-acct-credit';

export const FIXTURE_TXN_GROCERIES = 'txn-groceries-001';
export const FIXTURE_TXN_PAYCHECK = 'txn-paycheck-001';
export const FIXTURE_TXN_COFFEE = 'txn-coffee-001';
export const FIXTURE_TXN_CREDIT_GAS = 'txn-credit-gas-001';

/** Dates the fixture transactions land on (UTC date buckets). */
export const FIXTURE_DATES = {
  groceries: '2026-06-05',
  paycheck: '2026-06-06',
  /** transacted_at bucket while the coffee txn is pending (day one). */
  coffeePending: '2026-06-07',
  /** posted bucket after the pending -> posted shift (day two). */
  coffeePosted: '2026-06-08',
  creditGas: '2026-06-06',
} as const;

/** SimpleFIN account id -> GoldFinch account type map (NormalizeContext.accountTypes). */
export const FIXTURE_ACCOUNT_TYPES = {
  [FIXTURE_CHECKING_ID]: 'checking',
  [FIXTURE_CREDIT_ID]: 'credit',
} as const;

function fixtureCheckingAccount(
  transactions: SimpleFinTransaction[],
): SimpleFinAccount {
  return makeSimpleFinAccount({
    id: FIXTURE_CHECKING_ID,
    name: 'Everyday Checking',
    balance: '5230.55',
    'available-balance': '5180.55',
    transactions,
  });
}

function fixtureCreditAccount(
  transactions: SimpleFinTransaction[],
): SimpleFinAccount {
  return makeSimpleFinAccount({
    id: FIXTURE_CREDIT_ID,
    name: 'Rewards Card',
    currency: 'USD',
    balance: '-500.00',
    org: makeSimpleFinOrg({
      domain: 'megabank.example.com',
      name: 'MegaBank',
      id: 'org-megabank',
    }),
    transactions,
  });
}

/**
 * Day one: two posted checking transactions, one PENDING coffee transaction
 * (posted=0, bucketed by transacted_at on 2026-06-07), one credit-card spend.
 */
export function makeHouseholdPayloadDayOne(): SimpleFinAccountSet {
  return makeSimpleFinAccountSet([
    fixtureCheckingAccount([
      makeSimpleFinTransaction({
        id: FIXTURE_TXN_GROCERIES,
        // 2026-06-05T16:00:00Z
        posted: 1_780_675_200,
        amount: '-42.15',
        description: 'WHOLE FOODS MARKET #123',
        payee: 'Whole Foods Market',
      }),
      makeSimpleFinTransaction({
        id: FIXTURE_TXN_PAYCHECK,
        // 2026-06-06T13:00:00Z
        posted: 1_780_750_800,
        amount: '2500.00',
        description: 'DIRECT DEPOSIT PAYROLL',
        payee: 'ACME Payroll',
      }),
      makePendingSimpleFinTransaction({ id: FIXTURE_TXN_COFFEE }),
    ]),
    fixtureCreditAccount([
      makeSimpleFinTransaction({
        id: FIXTURE_TXN_CREDIT_GAS,
        // 2026-06-06T18:00:00Z
        posted: 1_780_768_800,
        amount: '-38.40',
        description: 'SHELL OIL 5551212',
        payee: 'Shell',
      }),
    ]),
  ]);
}

/**
 * Day two: identical payload except the pending coffee transaction has POSTED
 * with a shifted date bucket (2026-06-08, not its pending 2026-06-07 bucket)
 * and a slightly different settled amount. Same stable SimpleFIN id.
 */
export function makeHouseholdPayloadDayTwo(): SimpleFinAccountSet {
  return makeSimpleFinAccountSet([
    fixtureCheckingAccount([
      makeSimpleFinTransaction({
        id: FIXTURE_TXN_GROCERIES,
        posted: 1_780_675_200,
        amount: '-42.15',
        description: 'WHOLE FOODS MARKET #123',
        payee: 'Whole Foods Market',
      }),
      makeSimpleFinTransaction({
        id: FIXTURE_TXN_PAYCHECK,
        posted: 1_780_750_800,
        amount: '2500.00',
        description: 'DIRECT DEPOSIT PAYROLL',
        payee: 'ACME Payroll',
      }),
      makeSimpleFinTransaction({
        id: FIXTURE_TXN_COFFEE,
        // 2026-06-08T11:00:00Z — pending bucket was 2026-06-07.
        posted: 1_780_916_400,
        amount: '-7.10',
        description: 'BLUE BOTTLE COFFEE',
        payee: 'Blue Bottle Coffee',
        pending: false,
        transacted_at: 1_780_846_200,
      }),
    ]),
    fixtureCreditAccount([
      makeSimpleFinTransaction({
        id: FIXTURE_TXN_CREDIT_GAS,
        posted: 1_780_768_800,
        amount: '-38.40',
        description: 'SHELL OIL 5551212',
        payee: 'Shell',
      }),
    ]),
  ]);
}
