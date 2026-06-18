/**
 * Realistic API fixtures for the route-mocked walkthrough, shaped exactly to
 * the DTOs in @goldfinch/shared/types/api.ts.
 *
 * Money discipline (mirrors the shared package contract): every money field
 * is a decimal-string / integer-minor-units PAIR derived from one integer
 * cents value, so the two renderings can never disagree. Floats never appear;
 * all arithmetic here is integer cents.
 *
 * Dates are computed relative to "today" in LOCAL time, matching the client's
 * local-calendar date helpers (app/src/lib/dates.ts), so the dashboard's
 * rolling 30-day window and Today/Yesterday grouping always have data.
 */

import { FIXTURE_IDENTITY } from './jwt';

// ---------------------------------------------------------------------------
// Money + date helpers (integer cents; local-calendar dates)
// ---------------------------------------------------------------------------

export interface MoneyPair {
  text: string;
  minor: number;
}

/** Integer cents -> lossless decimal-string/minor pair ("-1800.00", -180000). */
export function money(cents: number): MoneyPair {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`fixture money must be integer cents, got ${cents}`);
  }
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = (abs % 100).toString().padStart(2, '0');
  return { text: `${sign}${whole}.${fraction}`, minor: cents };
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Local-calendar yyyy-mm-dd, matching app/src/lib/dates.ts toIsoDate. */
export function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function isoDaysFromToday(days: number, now: Date = new Date()): string {
  return localIsoDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days),
  );
}

export function currentIsoMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

/** yyyy-mm shifted by `delta` whole months. */
export function shiftIsoMonth(month: string, delta: number): string {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const shifted = new Date(year, monthIndex + delta, 1);
  return currentIsoMonth(shifted);
}

/** Inclusive yyyy-mm range, ascending. */
export function listIsoMonths(from: string, to: string): string[] {
  const months: string[] = [];
  let cursor = from;
  for (let guard = 0; guard < 240 && cursor <= to; guard += 1) {
    months.push(cursor);
    cursor = shiftIsoMonth(cursor, 1);
  }
  return months;
}

const NOW_EPOCH_SECONDS = Math.floor(Date.now() / 1000);
/** "Last sync" instant: 6 hours ago, like the nightly sync would produce. */
const LAST_SYNC_EPOCH = NOW_EPOCH_SECONDS - 6 * 3600;
const LAST_SYNC_ISO = new Date(LAST_SYNC_EPOCH * 1000).toISOString();

const USD = 'USD';

// ---------------------------------------------------------------------------
// Accounts + summary
// ---------------------------------------------------------------------------

interface AccountSeed {
  accountId: string;
  name: string;
  accountType: 'checking' | 'savings' | 'credit' | 'investment' | 'loan' | 'other';
  institution: string;
  balanceCents: number;
  isLiability: boolean;
  holdingsSupported?: boolean;
}

const ACCOUNT_SEEDS: readonly AccountSeed[] = [
  {
    accountId: 'acc-chk-1',
    name: 'Everyday Checking',
    accountType: 'checking',
    institution: 'Pacific Trust Bank',
    balanceCents: 483012,
    isLiability: false,
  },
  {
    accountId: 'acc-sav-1',
    name: 'High-Yield Savings',
    accountType: 'savings',
    institution: 'Pacific Trust Bank',
    balanceCents: 1240000,
    isLiability: false,
  },
  {
    accountId: 'acc-cc-1',
    name: 'Sapphire Card',
    accountType: 'credit',
    institution: 'Meridian Card Services',
    balanceCents: -64255,
    isLiability: true,
  },
  {
    accountId: 'acc-inv-1',
    name: 'Brokerage',
    accountType: 'investment',
    institution: 'Birch Securities',
    balanceCents: 2895040,
    isLiability: false,
    holdingsSupported: true,
  },
];

function accountDto(seed: AccountSeed): Record<string, unknown> {
  const balance = money(seed.balanceCents);
  return {
    accountId: seed.accountId,
    name: seed.name,
    accountType: seed.accountType,
    institution: seed.institution,
    balance: balance.text,
    balanceMinor: balance.minor,
    currency: USD,
    balanceDate: LAST_SYNC_EPOCH,
    lastSyncedAt: LAST_SYNC_ISO,
    isLiability: seed.isLiability,
    source: 'simplefin',
    ...(seed.holdingsSupported === undefined
      ? {}
      : { holdingsSupported: seed.holdingsSupported }),
  };
}

export function listAccountsResponse(): Record<string, unknown> {
  return { items: ACCOUNT_SEEDS.map(accountDto) };
}

export function getAccountResponse(accountId: string): Record<string, unknown> | null {
  const seed = ACCOUNT_SEEDS.find((account) => account.accountId === accountId);
  return seed === undefined ? null : accountDto(seed);
}

function summaryAccount(seed: AccountSeed): Record<string, unknown> {
  const balance = money(seed.balanceCents);
  return {
    accountId: seed.accountId,
    name: seed.name,
    institution: seed.institution,
    accountType: seed.accountType,
    balance: balance.text,
    balanceMinor: balance.minor,
    currency: USD,
    balanceDate: LAST_SYNC_EPOCH,
    isLiability: seed.isLiability,
  };
}

const TYPE_LABELS: Readonly<Record<AccountSeed['accountType'], string>> = {
  checking: 'Cash',
  savings: 'Savings',
  credit: 'Credit Cards',
  investment: 'Investments',
  loan: 'Loans',
  other: 'Other',
};

export function summaryResponse(): Record<string, unknown> {
  const assetsCents = ACCOUNT_SEEDS.filter((a) => !a.isLiability).reduce(
    (sum, account) => sum + account.balanceCents,
    0,
  );
  const liabilitiesCents = ACCOUNT_SEEDS.filter((a) => a.isLiability).reduce(
    (sum, account) => sum + Math.abs(account.balanceCents),
    0,
  );
  const netCents = assetsCents - liabilitiesCents;

  const types = [...new Set(ACCOUNT_SEEDS.map((a) => a.accountType))];
  const byType = types.map((type) => {
    const members = ACCOUNT_SEEDS.filter((a) => a.accountType === type);
    const first = members[0];
    const isLiability = first !== undefined && first.isLiability;
    const total = money(members.reduce((sum, a) => sum + a.balanceCents, 0));
    return {
      type,
      label: TYPE_LABELS[type],
      isLiability,
      total: total.text,
      totalMinor: total.minor,
      accounts: members.map(summaryAccount),
    };
  });

  const institutions = [...new Set(ACCOUNT_SEEDS.map((a) => a.institution))];
  const byInstitution = institutions.map((institution) => {
    const members = ACCOUNT_SEEDS.filter((a) => a.institution === institution);
    const total = money(members.reduce((sum, a) => sum + a.balanceCents, 0));
    return {
      institution,
      total: total.text,
      totalMinor: total.minor,
      accounts: members.map(summaryAccount),
    };
  });

  const netWorth = money(netCents);
  const assets = money(assetsCents);
  const liabilities = money(liabilitiesCents);
  return {
    netWorth: netWorth.text,
    netWorthMinor: netWorth.minor,
    currency: USD,
    asOf: LAST_SYNC_EPOCH,
    assetsTotal: assets.text,
    assetsTotalMinor: assets.minor,
    liabilitiesTotal: liabilities.text,
    liabilitiesTotalMinor: liabilities.minor,
    byType,
    byInstitution,
  };
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

interface CategorySeed {
  categoryId: string;
  name: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
}

const CATEGORY_SEEDS: readonly CategorySeed[] = [
  { categoryId: 'salary', name: 'Salary', type: 'INCOME' },
  { categoryId: 'rent', name: 'Rent', type: 'EXPENSE' },
  { categoryId: 'groceries', name: 'Groceries', type: 'EXPENSE' },
  { categoryId: 'dining', name: 'Dining', type: 'EXPENSE' },
  { categoryId: 'coffee', name: 'Coffee', type: 'EXPENSE' },
  { categoryId: 'utilities', name: 'Utilities', type: 'EXPENSE' },
  { categoryId: 'entertainment', name: 'Entertainment', type: 'EXPENSE' },
  { categoryId: 'transport', name: 'Transport', type: 'EXPENSE' },
  { categoryId: 'transfer', name: 'Transfer', type: 'TRANSFER' },
];

export function listCategoriesResponse(): Record<string, unknown> {
  return {
    items: CATEGORY_SEEDS.map((seed, index) => ({
      categoryId: seed.categoryId,
      name: seed.name,
      type: seed.type,
      groupId: null,
      sortOrder: (index + 1) * 10,
      archived: false,
    })),
  };
}

function categoryName(categoryId: string): string {
  const seed = CATEGORY_SEEDS.find((c) => c.categoryId === categoryId);
  if (seed === undefined) {
    throw new Error(`fixture references unknown category ${categoryId}`);
  }
  return seed.name;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

interface TransactionSeed {
  txnId: string;
  daysAgo: number;
  amountCents: number;
  payee: string;
  categoryId: string | null;
  accountId: string;
  pending?: boolean;
  isTransfer?: boolean;
  categorizedBy: 'rule' | 'ai' | 'user' | null;
}

const TRANSACTION_SEEDS: readonly TransactionSeed[] = [
  {
    txnId: 'txn-001',
    daysAgo: 0,
    amountCents: -475,
    payee: 'Blue Bottle Coffee',
    categoryId: 'coffee',
    accountId: 'acc-chk-1',
    categorizedBy: 'user',
  },
  {
    txnId: 'txn-002',
    daysAgo: 0,
    amountCents: -8621,
    payee: 'Whole Foods Market',
    categoryId: 'groceries',
    accountId: 'acc-chk-1',
    categorizedBy: 'rule',
  },
  {
    txnId: 'txn-003',
    daysAgo: 1,
    amountCents: -1599,
    payee: 'Netflix',
    categoryId: 'entertainment',
    accountId: 'acc-cc-1',
    categorizedBy: 'rule',
  },
  {
    txnId: 'txn-004',
    daysAgo: 3,
    amountCents: -12000,
    payee: 'Pacific Gas & Electric',
    categoryId: 'utilities',
    accountId: 'acc-chk-1',
    categorizedBy: 'rule',
  },
  {
    txnId: 'txn-005',
    daysAgo: 5,
    amountCents: 245000,
    payee: 'Acme Corp Payroll',
    categoryId: 'salary',
    accountId: 'acc-chk-1',
    categorizedBy: 'rule',
  },
  {
    txnId: 'txn-006',
    daysAgo: 7,
    amountCents: -4210,
    payee: 'Sushi Katsu',
    categoryId: 'dining',
    accountId: 'acc-cc-1',
    categorizedBy: 'user',
  },
  {
    txnId: 'txn-007',
    daysAgo: 9,
    amountCents: -50000,
    payee: 'Transfer to High-Yield Savings',
    categoryId: 'transfer',
    accountId: 'acc-chk-1',
    isTransfer: true,
    categorizedBy: 'rule',
  },
  {
    txnId: 'txn-008',
    daysAgo: 12,
    amountCents: -1200,
    payee: 'City Parking',
    categoryId: null,
    accountId: 'acc-chk-1',
    pending: true,
    categorizedBy: null,
  },
  {
    txnId: 'txn-009',
    daysAgo: 15,
    amountCents: -180000,
    payee: 'Maple Court Apartments',
    categoryId: 'rent',
    accountId: 'acc-chk-1',
    categorizedBy: 'rule',
  },
  {
    txnId: 'txn-010',
    daysAgo: 21,
    amountCents: -6380,
    payee: 'Lyft',
    categoryId: 'transport',
    accountId: 'acc-chk-1',
    categorizedBy: 'rule',
  },
];

function transactionDto(seed: TransactionSeed): Record<string, unknown> {
  const amount = money(seed.amountCents);
  const account = ACCOUNT_SEEDS.find((a) => a.accountId === seed.accountId);
  return {
    txnId: seed.txnId,
    date: isoDaysFromToday(-seed.daysAgo),
    amount: amount.text,
    amountMinor: amount.minor,
    currency: USD,
    payee: seed.payee,
    categoryId: seed.categoryId,
    accountId: seed.accountId,
    ...(account === undefined ? {} : { accountName: account.name }),
    pending: seed.pending === true,
    isTransfer: seed.isTransfer === true,
    userCategorized: seed.categorizedBy === 'user',
    categorizedBy: seed.categorizedBy,
    version: 1,
    source: 'simplefin',
  };
}

export interface TransactionFilter {
  from?: string;
  to?: string;
  accountId?: string;
  q?: string;
  pendingOnly?: boolean;
  limit?: number;
}

/** Filtered, newest-first, single page (nextCursor null = done). */
export function listTransactionsResponse(
  filter: TransactionFilter,
): Record<string, unknown> {
  const limit = filter.limit ?? 50;
  const items = TRANSACTION_SEEDS.map(transactionDto)
    .filter((txn) => {
      const date = txn['date'] as string;
      if (filter.from !== undefined && date < filter.from) return false;
      if (filter.to !== undefined && date > filter.to) return false;
      if (
        filter.accountId !== undefined &&
        txn['accountId'] !== filter.accountId
      ) {
        return false;
      }
      if (filter.pendingOnly === true && txn['pending'] !== true) return false;
      if (filter.q !== undefined && filter.q !== '') {
        const payee = (txn['payee'] as string).toLowerCase();
        if (!payee.includes(filter.q.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => (b['date'] as string).localeCompare(a['date'] as string))
    .slice(0, limit);
  return { items, nextCursor: null };
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

interface BudgetSeed {
  categoryId: string;
  limitCents: number;
  spentCents: number;
  rollover: boolean;
}

const BUDGET_SEEDS: readonly BudgetSeed[] = [
  { categoryId: 'groceries', limitCents: 60000, spentCents: 8621, rollover: false },
  { categoryId: 'dining', limitCents: 25000, spentCents: 4210, rollover: false },
  { categoryId: 'coffee', limitCents: 8000, spentCents: 475, rollover: true },
  { categoryId: 'entertainment', limitCents: 5000, spentCents: 1599, rollover: false },
  { categoryId: 'transport', limitCents: 15000, spentCents: 6380, rollover: false },
];

export function listBudgetsResponse(): Record<string, unknown> {
  return {
    items: BUDGET_SEEDS.map((seed) => {
      const limit = money(seed.limitCents);
      const spent = money(seed.spentCents);
      const remaining = money(seed.limitCents - seed.spentCents);
      return {
        categoryId: seed.categoryId,
        categoryName: categoryName(seed.categoryId),
        period: 'monthly',
        limit: limit.text,
        limitMinor: limit.minor,
        rollover: seed.rollover,
        spent: spent.text,
        spentMinor: spent.minor,
        remaining: remaining.text,
        remainingMinor: remaining.minor,
        version: 1,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Cash flow (deterministic per-month variation; no randomness)
// ---------------------------------------------------------------------------

/** Stable per-month variation in cents derived from the month string. */
function monthWiggle(month: string, scaleCents: number): number {
  let hash = 0;
  for (const char of month) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return Math.round(((hash / 997) * 2 - 1) * scaleCents);
}

function monthCashflowCents(month: string): { income: number; expense: number } {
  return {
    income: 490000 + monthWiggle(`${month}-income`, 25000),
    expense: 370000 + monthWiggle(`${month}-expense`, 45000),
  };
}

export function cashflowResponse(from: string, to: string): Record<string, unknown> {
  const months = listIsoMonths(from, to).map((month) => {
    const { income, expense } = monthCashflowCents(month);
    const incomePair = money(income);
    const expensePair = money(expense);
    const net = money(income - expense);
    return {
      month,
      income: incomePair.text,
      incomeMinor: incomePair.minor,
      expense: expensePair.text,
      expenseMinor: expensePair.minor,
      net: net.text,
      netMinor: net.minor,
    };
  });
  const incomeTotal = months.reduce((sum, m) => sum + (m.incomeMinor as number), 0);
  const expenseTotal = months.reduce((sum, m) => sum + (m.expenseMinor as number), 0);
  const incomePair = money(incomeTotal);
  const expensePair = money(expenseTotal);
  const netPair = money(incomeTotal - expenseTotal);
  return {
    months,
    totals: {
      income: incomePair.text,
      incomeMinor: incomePair.minor,
      expense: expensePair.text,
      expenseMinor: expensePair.minor,
      net: netPair.text,
      netMinor: netPair.minor,
    },
    currency: USD,
  };
}

// ---------------------------------------------------------------------------
// Recurring
// ---------------------------------------------------------------------------

interface RecurringSeed {
  seriesId: string;
  payee: string;
  cadence: 'weekly' | 'biweekly' | 'monthly' | 'yearly';
  avgCents: number;
  lastDaysAgo: number;
  nextInDays: number;
  accountId: string;
  status: 'detected' | 'confirmed' | 'ignored';
  occurrenceCount: number;
}

const RECURRING_SEEDS: readonly RecurringSeed[] = [
  {
    seriesId: 'rec-netflix',
    payee: 'Netflix',
    cadence: 'monthly',
    avgCents: -1599,
    lastDaysAgo: 1,
    nextInDays: 29,
    accountId: 'acc-cc-1',
    status: 'confirmed',
    occurrenceCount: 9,
  },
  {
    seriesId: 'rec-pge',
    payee: 'Pacific Gas & Electric',
    cadence: 'monthly',
    avgCents: -11850,
    lastDaysAgo: 3,
    nextInDays: 27,
    accountId: 'acc-chk-1',
    status: 'detected',
    occurrenceCount: 6,
  },
  {
    seriesId: 'rec-rent',
    payee: 'Maple Court Apartments',
    cadence: 'monthly',
    avgCents: -180000,
    lastDaysAgo: 15,
    nextInDays: 15,
    accountId: 'acc-chk-1',
    status: 'confirmed',
    occurrenceCount: 14,
  },
  {
    seriesId: 'rec-payroll',
    payee: 'Acme Corp Payroll',
    cadence: 'biweekly',
    avgCents: 245000,
    lastDaysAgo: 5,
    nextInDays: 9,
    accountId: 'acc-chk-1',
    status: 'confirmed',
    occurrenceCount: 22,
  },
];

export function listRecurringResponse(): Record<string, unknown> {
  const items = RECURRING_SEEDS.map((seed) => {
    const avg = money(seed.avgCents);
    const account = ACCOUNT_SEEDS.find((a) => a.accountId === seed.accountId);
    return {
      seriesId: seed.seriesId,
      payee: seed.payee,
      cadence: seed.cadence,
      avgAmount: avg.text,
      avgAmountMinor: avg.minor,
      currency: USD,
      lastDate: isoDaysFromToday(-seed.lastDaysAgo),
      nextExpectedDate: isoDaysFromToday(seed.nextInDays),
      accountId: seed.accountId,
      ...(account === undefined ? {} : { accountName: account.name }),
      status: seed.status,
      occurrenceCount: seed.occurrenceCount,
    };
  }).sort((a, b) =>
    (a.nextExpectedDate as string).localeCompare(b.nextExpectedDate as string),
  );
  return { items };
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export function listGoalsResponse(): Record<string, unknown> {
  const emergencyTarget = money(1000000);
  const emergencyProgress = money(620000);
  const tripTarget = money(2000000);
  const tripProgress = money(1240000);
  return {
    items: [
      {
        goalId: 'goal-emergency',
        name: 'Emergency fund',
        target: emergencyTarget.text,
        targetMinor: emergencyTarget.minor,
        currency: USD,
        targetDate: null,
        fundingMode: 'manual',
        linkedAccountId: null,
        progress: emergencyProgress.text,
        progressMinor: emergencyProgress.minor,
        percentComplete: 62,
        version: 3,
        createdAt: new Date(
          Date.now() - 200 * 24 * 3600 * 1000,
        ).toISOString(),
      },
      {
        goalId: 'goal-japan',
        name: 'Japan trip 2027',
        target: tripTarget.text,
        targetMinor: tripTarget.minor,
        currency: USD,
        targetDate: isoDaysFromToday(400),
        fundingMode: 'linked-account',
        linkedAccountId: 'acc-sav-1',
        progress: tripProgress.text,
        progressMinor: tripProgress.minor,
        percentComplete: 62,
        version: 1,
        createdAt: new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString(),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

export function listHoldingsResponse(accountId: string): Record<string, unknown> {
  if (accountId !== 'acc-inv-1') {
    return { items: [], holdingsSupported: false };
  }
  const vtiValue = money(2400040);
  const vtiCost = money(1985000);
  const cashValue = money(495000);
  return {
    items: [
      {
        holdingId: 'hold-vti',
        accountId,
        symbol: 'VTI',
        description: 'Vanguard Total Stock Market ETF',
        shares: '82.5000',
        costBasis: vtiCost.text,
        costBasisMinor: vtiCost.minor,
        marketValue: vtiValue.text,
        marketValueMinor: vtiValue.minor,
        currency: USD,
        asOf: LAST_SYNC_EPOCH,
      },
      {
        holdingId: 'hold-cash',
        accountId,
        description: 'Cash & sweep',
        shares: '1.0000',
        marketValue: cashValue.text,
        marketValueMinor: cashValue.minor,
        currency: USD,
        asOf: LAST_SYNC_EPOCH,
      },
    ],
    holdingsSupported: true,
  };
}

// ---------------------------------------------------------------------------
// Net-worth history + reports
// ---------------------------------------------------------------------------

const NET_WORTH_TODAY_CENTS = 4553797;
const LIABILITIES_CENTS = 64255;
const HISTORY_WEEKS = 26;

export function netWorthHistoryResponse(): Record<string, unknown> {
  const items = [];
  for (let week = HISTORY_WEEKS - 1; week >= 0; week -= 1) {
    // Older snapshots are lower; deterministic gentle ripple, ending exactly
    // at today's summary net worth so the hero figure and chart agree.
    const progress = (HISTORY_WEEKS - 1 - week) / (HISTORY_WEEKS - 1);
    const ripple =
      week === 0 ? 0 : Math.round(Math.sin(week * 1.7) * 35000);
    const netCents =
      Math.round(
        3790000 + (NET_WORTH_TODAY_CENTS - 3790000) * progress,
      ) + ripple;
    const net = money(netCents);
    const assets = money(netCents + LIABILITIES_CENTS);
    const liabilities = money(LIABILITIES_CENTS);
    items.push({
      date: isoDaysFromToday(-7 * week),
      currency: USD,
      assets: assets.text,
      assetsMinor: assets.minor,
      liabilities: liabilities.text,
      liabilitiesMinor: liabilities.minor,
      net: net.text,
      netMinor: net.minor,
      perCurrency: [
        {
          currency: USD,
          assets: assets.text,
          assetsMinor: assets.minor,
          liabilities: liabilities.text,
          liabilitiesMinor: liabilities.minor,
          net: net.text,
          netMinor: net.minor,
        },
      ],
    });
  }
  const first = items[0];
  return {
    items,
    firstSnapshotDate: first === undefined ? null : first.date,
  };
}

export function reportsTrendsResponse(monthsBack: number): Record<string, unknown> {
  const current = currentIsoMonth();
  const months = [];
  for (let offset = monthsBack - 1; offset >= 0; offset -= 1) {
    const month = shiftIsoMonth(current, -offset);
    const { income, expense } = monthCashflowCents(month);
    const incomePair = money(income);
    const expensePair = money(expense);
    const net = money(income - expense);
    months.push({
      month,
      perCurrency: [
        {
          currency: USD,
          income: incomePair.text,
          incomeMinor: incomePair.minor,
          expense: expensePair.text,
          expenseMinor: expensePair.minor,
          net: net.text,
          netMinor: net.minor,
        },
      ],
    });
  }
  return { months };
}

const FLOW_CATEGORY_CENTS: ReadonlyArray<readonly [string | null, string, number]> = [
  ['rent', 'Rent', 180000],
  ['groceries', 'Groceries', 61240],
  ['dining', 'Dining', 31025],
  ['utilities', 'Utilities', 22000],
  ['transport', 'Transport', 14260],
  ['entertainment', 'Entertainment', 9530],
  ['coffee', 'Coffee', 6380],
  [null, 'Uncategorized', 9120],
];

export function reportsFlowResponse(month: string): Record<string, unknown> {
  const incomeCents = 490000;
  const expenseCents = FLOW_CATEGORY_CENTS.reduce(
    (sum, [, , cents]) => sum + cents,
    0,
  );
  const incomePair = money(incomeCents);
  const expensePair = money(expenseCents);
  const net = money(incomeCents - expenseCents);
  return {
    month,
    perCurrency: [
      {
        currency: USD,
        income: incomePair.text,
        incomeMinor: incomePair.minor,
        expense: expensePair.text,
        expenseMinor: expensePair.minor,
        net: net.text,
        netMinor: net.minor,
        categories: FLOW_CATEGORY_CENTS.map(([categoryId, name, cents]) => {
          const amount = money(cents);
          return {
            categoryId,
            categoryName: name,
            amount: amount.text,
            amountMinor: amount.minor,
          };
        }),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function listRulesResponse(): Record<string, unknown> {
  return {
    items: [
      {
        ruleId: 'rule-payroll',
        matchType: 'exact',
        pattern: 'acme corp payroll',
        amountMin: null,
        amountMinMinor: null,
        amountMax: null,
        amountMaxMinor: null,
        categoryId: 'salary',
        priority: 50,
        enabled: true,
        version: 1,
      },
      {
        ruleId: 'rule-bluebottle',
        matchType: 'prefix',
        pattern: 'blue bottle',
        amountMin: null,
        amountMinMinor: null,
        amountMax: null,
        amountMaxMinor: null,
        categoryId: 'coffee',
        priority: 100,
        enabled: true,
        version: 2,
      },
      {
        ruleId: 'rule-netflix',
        matchType: 'contains',
        pattern: 'netflix',
        amountMin: null,
        amountMinMinor: null,
        amountMax: null,
        amountMaxMinor: null,
        categoryId: 'entertainment',
        priority: 100,
        enabled: true,
        version: 1,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * GET /profile (ProfileDto). The display name mirrors the injected JWT
 * fixture's given name so the dashboard greeting assertion has exactly one
 * source of truth ("Good morning, Robin" via the profile-driven path; the
 * claim fallback would render the same text). `email` is omitted because the
 * DTO marks it present only when the access token carries an email claim,
 * and the e2e access token (lib/jwt.ts) carries none.
 */
export function profileResponse(): Record<string, unknown> {
  return { displayName: FIXTURE_IDENTITY.givenName };
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function healthResponse(): Record<string, unknown> {
  return { ok: true };
}
