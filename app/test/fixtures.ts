/**
 * Shared DTO fixtures for the per-screen integration tests.
 *
 * Where @goldfinch/testing has a factory for the underlying entity (accounts,
 * transactions, categories, budgets), the fixture builds the DynamoDB item
 * through it and maps the item to its wire DTO -- so these fixtures inherit
 * the shared package's canonical values ('Everyday Checking', -4215 minor
 * Whole Foods spend, the 60_000 groceries limit, TEST_BALANCE_EPOCH) and
 * break loudly if the entity contract drifts. Domains with no item factory
 * (recurring, goals, reports) are built directly against the DTO types.
 *
 * Every decimal-string/minor-unit pair is derived with the shared
 * toCurrencyDecimalString helper -- one money source, no hand-typed decimal
 * strings that could drift from their minor units.
 */
import {
  makeAccountItem,
  makeBudgetItem,
  makeCategoryItem,
  makeTransactionItem,
  TEST_BALANCE_EPOCH,
  TEST_NOW_ISO,
  type AccountFactoryInput,
  type BudgetFactoryInput,
  type CategoryFactoryInput,
  type TransactionFactoryInput,
} from '@goldfinch/testing';
import {
  effectiveAccountName,
  effectiveAccountType,
  effectiveInstitution,
  effectiveIsLiability,
} from '@goldfinch/shared/accountTypes';
import { toCurrencyDecimalString } from '@goldfinch/shared/money';
import { periodWindow } from '@goldfinch/shared/periodWindow';
import type {
  AccountDto,
  BudgetDto,
  BudgetPeriod,
  CashflowResponse,
  CategoryDto,
  CurrencyCode,
  EpochSeconds,
  FlowCategoryDto,
  GoalDto,
  HoldingDto,
  IsoDate,
  IsoMonth,
  ListAccountsResponse,
  ListHoldingsResponse,
  ListBudgetsResponse,
  ListCategoriesResponse,
  ListGoalsResponse,
  ListRecurringResponse,
  ListTransactionsResponse,
  MinorUnits,
  NetWorthHistoryResponse,
  NetWorthSnapshotDto,
  RecurringSeriesDto,
  ReportsFlowResponse,
  ReportsTrendsResponse,
  SummaryResponse,
  TransactionDto,
  TrendMonthDto,
} from '@goldfinch/shared/types';

/** Decimal/minor pair from one integer source (shared scale rules). */
function pair(
  minor: MinorUnits,
  currency: CurrencyCode,
): { decimal: string; minor: MinorUnits } {
  return { decimal: toCurrencyDecimalString(minor, currency), minor };
}

// ---------------------------------------------------------------------------
// Accounts (factory-backed)
// ---------------------------------------------------------------------------

export function makeAccountDto(
  input: AccountFactoryInput = {},
): AccountDto {
  const item = makeAccountItem(input);
  const balance = pair(item.balanceMinor, item.currency);
  // Effective values ride the SAME shared helpers the server uses (P8-4):
  // overrides injected through input.overrides flow through automatically,
  // and the fixture can never disagree with the precedence rule.
  const dto: AccountDto = {
    accountId: item.simplefinAccountId,
    // EFFECTIVE name/institution ride the SAME shared helpers the server uses
    // (label/institution overrides injected through input.overrides flow through
    // automatically); the raw synced values stay available for the subtitle.
    name: effectiveAccountName(item),
    syncedName: item.name,
    institution: effectiveInstitution(item),
    syncedInstitution: item.institution,
    accountType: item.accountType,
    balance: balance.decimal,
    balanceMinor: balance.minor,
    currency: item.currency,
    balanceDate: item.balanceDate,
    lastSyncedAt: item.lastSyncedAt,
    accountTypeId: effectiveAccountType(item),
    isLiability: effectiveIsLiability(item),
  };
  if (item.nameOverride !== undefined) {
    dto.nameOverride = item.nameOverride;
  }
  if (item.institutionOverride !== undefined) {
    dto.institutionOverride = item.institutionOverride;
  }
  if (item.availableBalanceMinor !== undefined) {
    const available = pair(item.availableBalanceMinor, item.currency);
    dto.availableBalance = available.decimal;
    dto.availableBalanceMinor = available.minor;
  }
  return dto;
}

// ---------------------------------------------------------------------------
// Transactions (factory-backed)
// ---------------------------------------------------------------------------

export function makeTransactionDto(
  input: TransactionFactoryInput = {},
): TransactionDto {
  const item = makeTransactionItem(input);
  const date: IsoDate = input.date ?? '2026-06-05';
  const amount = pair(item.amountMinor, item.currency);
  const dto: TransactionDto = {
    txnId: item.simplefinTxnId,
    date,
    amount: amount.decimal,
    amountMinor: amount.minor,
    currency: item.currency,
    payee: item.payee,
    categoryId: item.categoryId,
    accountId: item.accountId,
    pending: item.pending,
    isTransfer: item.isTransfer,
    userCategorized: item.userCategorized,
    categorizedBy: item.categorizedBy,
    version: item.version,
  };
  if (item.note !== undefined) {
    dto.note = item.note;
  }
  return dto;
}

// ---------------------------------------------------------------------------
// Categories + budgets (factory-backed)
// ---------------------------------------------------------------------------

export function makeCategoryDto(input: CategoryFactoryInput = {}): CategoryDto {
  const item = makeCategoryItem(input);
  return {
    categoryId: item.categoryId,
    name: item.name,
    type: item.type,
    groupId: item.groupId,
    sortOrder: item.sortOrder,
    archived: item.archived,
  };
}

export interface BudgetDtoInput extends BudgetFactoryInput {
  /** Server-computed actual for the open period. */
  spentMinor?: MinorUnits;
  categoryName?: string;
  currency?: CurrencyCode;
  /**
   * Budget cadence (P11-1). Mirrors the server contract: a stored item with no
   * period is surfaced as `'monthly'`, and `periodFrom`/`periodTo` are derived
   * from the SAME shared `periodWindow` the API uses (computed at TEST_NOW), so
   * the fixture cannot disagree with the production spend window.
   */
  period?: BudgetPeriod;
}

export function makeBudgetDto(input: BudgetDtoInput = {}): BudgetDto {
  // Thread the period through the entity factory's overrides so the underlying
  // BudgetItem carries it too (the contract-drift suite reads the item).
  const item = makeBudgetItem(
    input.period === undefined
      ? input
      : { ...input, overrides: { period: input.period, ...input.overrides } },
  );
  const currency = input.currency ?? 'USD';
  const spentMinor = input.spentMinor ?? 0;
  // Absent stored period reads as 'monthly' (back-compat, mirrors the server).
  const period: BudgetPeriod = item.period ?? 'monthly';
  const { from, to } = periodWindow(period, new Date(TEST_NOW_ISO));
  const limit = pair(item.limitMinor, currency);
  const spent = pair(spentMinor, currency);
  const remaining = pair(item.limitMinor - spentMinor, currency);
  const dto: BudgetDto = {
    categoryId: item.categoryId,
    period,
    periodFrom: from,
    periodTo: to,
    limit: limit.decimal,
    limitMinor: limit.minor,
    rollover: item.rollover,
    spent: spent.decimal,
    spentMinor: spent.minor,
    remaining: remaining.decimal,
    remainingMinor: remaining.minor,
    version: item.version,
  };
  if (input.categoryName !== undefined) {
    dto.categoryName = input.categoryName;
  }
  return dto;
}

// ---------------------------------------------------------------------------
// Summary (assembled from factory-backed account DTOs)
// ---------------------------------------------------------------------------

export interface SummaryGroupInput {
  type: AccountDto['accountType'];
  label: string;
  isLiability: boolean;
  /** Signed contribution to net worth (liability groups negative). */
  totalMinor: MinorUnits;
  accounts: AccountDto[];
}

export interface SummaryInstitutionInput {
  institution: string;
  totalMinor: MinorUnits;
  accounts: AccountDto[];
}

export interface SummaryInput {
  netWorthMinor: MinorUnits;
  assetsTotalMinor: MinorUnits;
  liabilitiesTotalMinor: MinorUnits;
  currency?: CurrencyCode;
  byType: SummaryGroupInput[];
  byInstitution?: SummaryInstitutionInput[];
}

function summaryAccount(account: AccountDto): SummaryResponse['byType'][number]['accounts'][number] {
  return {
    accountId: account.accountId,
    name: account.name,
    institution: account.institution,
    accountType: account.accountType,
    accountTypeId: account.accountTypeId,
    balance: account.balance,
    balanceMinor: account.balanceMinor,
    currency: account.currency,
    balanceDate: account.balanceDate,
    isLiability: account.isLiability,
  };
}

export function makeSummaryResponse(input: SummaryInput): SummaryResponse {
  const currency = input.currency ?? 'USD';
  const net = pair(input.netWorthMinor, currency);
  const assets = pair(input.assetsTotalMinor, currency);
  const liabilities = pair(input.liabilitiesTotalMinor, currency);
  return {
    netWorth: net.decimal,
    netWorthMinor: net.minor,
    currency,
    asOf: TEST_BALANCE_EPOCH,
    assetsTotal: assets.decimal,
    assetsTotalMinor: assets.minor,
    liabilitiesTotal: liabilities.decimal,
    liabilitiesTotalMinor: liabilities.minor,
    byType: input.byType.map((group) => {
      const total = pair(group.totalMinor, currency);
      return {
        type: group.type,
        label: group.label,
        isLiability: group.isLiability,
        total: total.decimal,
        totalMinor: total.minor,
        accounts: group.accounts.map(summaryAccount),
      };
    }),
    byInstitution: (input.byInstitution ?? []).map((group) => {
      const total = pair(group.totalMinor, currency);
      return {
        institution: group.institution,
        total: total.decimal,
        totalMinor: total.minor,
        accounts: group.accounts.map(summaryAccount),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Recurring (DTO-typed; no item factory exists for this domain)
// ---------------------------------------------------------------------------

export interface RecurringSeriesInput {
  seriesId: string;
  payee: string;
  cadence: RecurringSeriesDto['cadence'];
  avgAmountMinor: MinorUnits;
  currency?: CurrencyCode;
  lastDate: IsoDate;
  nextExpectedDate: IsoDate;
  accountId?: string;
  status: RecurringSeriesDto['status'];
  occurrenceCount?: number;
}

export function makeRecurringSeriesDto(
  input: RecurringSeriesInput,
): RecurringSeriesDto {
  const currency = input.currency ?? 'USD';
  const avg = pair(input.avgAmountMinor, currency);
  return {
    seriesId: input.seriesId,
    payee: input.payee,
    cadence: input.cadence,
    avgAmount: avg.decimal,
    avgAmountMinor: avg.minor,
    currency,
    lastDate: input.lastDate,
    nextExpectedDate: input.nextExpectedDate,
    accountId: input.accountId ?? 'acct-checking',
    status: input.status,
    occurrenceCount: input.occurrenceCount ?? 4,
  };
}

// ---------------------------------------------------------------------------
// Goals (DTO-typed; no item factory exists for this domain)
// ---------------------------------------------------------------------------

export interface GoalInput {
  goalId: string;
  name: string;
  targetMinor: MinorUnits;
  progressMinor: MinorUnits;
  currency?: CurrencyCode;
  targetDate?: IsoDate | null;
  fundingMode: GoalDto['fundingMode'];
  linkedAccountId?: string | null;
  version?: number;
}

export function makeGoalDto(input: GoalInput): GoalDto {
  const currency = input.currency ?? 'USD';
  const target = pair(input.targetMinor, currency);
  const progress = pair(input.progressMinor, currency);
  return {
    goalId: input.goalId,
    name: input.name,
    target: target.decimal,
    targetMinor: target.minor,
    currency,
    targetDate: input.targetDate ?? null,
    fundingMode: input.fundingMode,
    linkedAccountId: input.linkedAccountId ?? null,
    progress: progress.decimal,
    progressMinor: progress.minor,
    percentComplete:
      input.targetMinor === 0
        ? 0
        : Math.floor((input.progressMinor / input.targetMinor) * 100),
    version: input.version ?? 1,
    createdAt: '2026-06-01T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Holdings (DTO-typed; no item factory exists for this domain). Every
// decimal/minor money pair rides the shared toCurrencyDecimalString helper so
// the fixture cannot drift from its minor units; shares stay exact strings.
// ---------------------------------------------------------------------------

export interface HoldingInput {
  holdingId: string;
  accountId?: string;
  symbol?: string;
  description?: string;
  shares?: string;
  marketValueMinor: MinorUnits;
  /** Omit to model a holding with no reported cost basis. */
  costBasisMinor?: MinorUnits;
  /** Source of the effective cost basis (present iff costBasisMinor is). */
  costBasisSource?: 'manual' | 'feed';
  /** Current price per share in minor units (Investments enrichment, Part B). */
  currentPriceMinor?: MinorUnits;
  currency?: CurrencyCode;
  asOf?: EpochSeconds;
}

export function makeHoldingDto(input: HoldingInput): HoldingDto {
  const currency = input.currency ?? 'USD';
  const marketValue = pair(input.marketValueMinor, currency);
  const dto: HoldingDto = {
    holdingId: input.holdingId,
    accountId: input.accountId ?? 'acct-brokerage',
    description: input.description ?? 'Position',
    shares: input.shares ?? '1',
    marketValue: marketValue.decimal,
    marketValueMinor: marketValue.minor,
    currency,
    asOf: input.asOf ?? TEST_BALANCE_EPOCH,
  };
  if (input.symbol !== undefined) dto.symbol = input.symbol;
  if (input.costBasisMinor !== undefined) {
    const costBasis = pair(input.costBasisMinor, currency);
    dto.costBasis = costBasis.decimal;
    dto.costBasisMinor = costBasis.minor;
    // Default a present basis to a feed source so fixtures model the common
    // "synced basis" case; tests set 'manual' explicitly when needed.
    dto.costBasisSource = input.costBasisSource ?? 'feed';
    // Server emits gain/percentReturn whenever an effective basis exists.
    const gainMinor = marketValue.minor - costBasis.minor;
    const gain = pair(gainMinor, currency);
    dto.gain = gain.decimal;
    dto.gainMinor = gain.minor;
    if (costBasis.minor !== 0) {
      dto.percentReturn = Number((BigInt(gainMinor) * 100n) / BigInt(costBasis.minor));
    }
  }
  if (input.currentPriceMinor !== undefined) {
    const price = pair(input.currentPriceMinor, currency);
    dto.currentPrice = price.decimal;
    dto.currentPriceMinor = price.minor;
  }
  return dto;
}

/** GET /accounts/{id}/holdings response. `supported:false` => no positions. */
export function makeHoldingsResponse(
  items: HoldingDto[],
  holdingsSupported = true,
): ListHoldingsResponse {
  return { items, holdingsSupported };
}

// ---------------------------------------------------------------------------
// Reports: net-worth history, trends, flow, cashflow (DTO-typed)
// ---------------------------------------------------------------------------

export interface SnapshotInput {
  date: IsoDate;
  assetsMinor: MinorUnits;
  liabilitiesMinor: MinorUnits;
  currency?: CurrencyCode;
}

export function makeNetWorthSnapshotDto(
  input: SnapshotInput,
): NetWorthSnapshotDto {
  const currency = input.currency ?? 'USD';
  const netMinor = input.assetsMinor - input.liabilitiesMinor;
  const assets = pair(input.assetsMinor, currency);
  const liabilities = pair(input.liabilitiesMinor, currency);
  const net = pair(netMinor, currency);
  return {
    date: input.date,
    currency,
    assets: assets.decimal,
    assetsMinor: assets.minor,
    liabilities: liabilities.decimal,
    liabilitiesMinor: liabilities.minor,
    net: net.decimal,
    netMinor: net.minor,
    perCurrency: [
      {
        currency,
        assets: assets.decimal,
        assetsMinor: assets.minor,
        liabilities: liabilities.decimal,
        liabilitiesMinor: liabilities.minor,
        net: net.decimal,
        netMinor: net.minor,
      },
    ],
  };
}

export function makeNetWorthHistoryResponse(
  snapshots: SnapshotInput[],
): NetWorthHistoryResponse {
  const items = snapshots.map(makeNetWorthSnapshotDto);
  return {
    items,
    firstSnapshotDate: items.length > 0 ? (items[0]?.date ?? null) : null,
  };
}

export interface CashflowSliceInput {
  incomeMinor: MinorUnits;
  expenseMinor: MinorUnits;
  currency?: CurrencyCode;
}

function cashflowSlice(input: CashflowSliceInput): {
  currency: CurrencyCode;
  income: string;
  incomeMinor: MinorUnits;
  expense: string;
  expenseMinor: MinorUnits;
  net: string;
  netMinor: MinorUnits;
} {
  const currency = input.currency ?? 'USD';
  const income = pair(input.incomeMinor, currency);
  const expense = pair(input.expenseMinor, currency);
  const net = pair(input.incomeMinor - input.expenseMinor, currency);
  return {
    currency,
    income: income.decimal,
    incomeMinor: income.minor,
    expense: expense.decimal,
    expenseMinor: expense.minor,
    net: net.decimal,
    netMinor: net.minor,
  };
}

export function makeTrendMonthDto(
  month: IsoMonth,
  slice: CashflowSliceInput,
): TrendMonthDto {
  const { currency, ...flow } = cashflowSlice(slice);
  return { month, perCurrency: [{ currency, ...flow }] };
}

export function makeReportsTrendsResponse(
  months: Array<{ month: IsoMonth; slice: CashflowSliceInput }>,
): ReportsTrendsResponse {
  return {
    months: months.map(({ month, slice }) => makeTrendMonthDto(month, slice)),
  };
}

export interface FlowCategoryInput {
  categoryId: string | null;
  categoryName: string;
  amountMinor: MinorUnits;
}

export function makeReportsFlowResponse(
  month: IsoMonth,
  slice: CashflowSliceInput,
  categories: FlowCategoryInput[],
): ReportsFlowResponse {
  const currency = slice.currency ?? 'USD';
  const group = cashflowSlice(slice);
  const flowCategories: FlowCategoryDto[] = categories.map((category) => {
    const amount = pair(category.amountMinor, currency);
    return {
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      amount: amount.decimal,
      amountMinor: amount.minor,
    };
  });
  return {
    month,
    perCurrency: [{ ...group, categories: flowCategories }],
  };
}

export function makeCashflowResponse(
  months: Array<{ month: IsoMonth; slice: CashflowSliceInput }>,
): CashflowResponse {
  const currency = months[0]?.slice.currency ?? 'USD';
  let incomeTotal = 0;
  let expenseTotal = 0;
  for (const { slice } of months) {
    incomeTotal += slice.incomeMinor;
    expenseTotal += slice.expenseMinor;
  }
  const totals = cashflowSlice({
    incomeMinor: incomeTotal,
    expenseMinor: expenseTotal,
    currency,
  });
  return {
    months: months.map(({ month, slice }) => {
      const { currency: _sliceCurrency, ...flow } = cashflowSlice(slice);
      return { month, ...flow };
    }),
    totals: {
      income: totals.income,
      incomeMinor: totals.incomeMinor,
      expense: totals.expense,
      expenseMinor: totals.expenseMinor,
      net: totals.net,
      netMinor: totals.netMinor,
    },
    currency,
  };
}

// ---------------------------------------------------------------------------
// List wrappers
// ---------------------------------------------------------------------------

export function listOf<T>(items: T[]): { items: T[] } {
  return { items };
}

export type {
  ListAccountsResponse,
  ListBudgetsResponse,
  ListCategoriesResponse,
  ListGoalsResponse,
  ListHoldingsResponse,
  ListRecurringResponse,
  ListTransactionsResponse,
};
