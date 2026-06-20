/**
 * API request/response DTOs for every endpoint served by the app API Lambda
 * (master plan sections 8, 13, 14, 15).
 *
 * Money convention at the API boundary: every money field is carried as a PAIR —
 * an exact decimal string (`x`) for display plus the authoritative integer minor
 * units (`xMinor`) for arithmetic. The two are always lossless renderings of the
 * same value (see @goldfinch/shared/money). Floats never appear.
 *
 * Every non-2xx response body is the ErrorEnvelope from ./common.js.
 */

import type {
  CurrencyCode,
  DecimalString,
  EpochSeconds,
  IsoDate,
  IsoMonth,
  IsoTimestamp,
  MinorUnits,
} from './common.js';
import type {
  AccountSource,
  AccountType,
  AccountTypeId,
  AttachmentStatus,
  CategorizedBy,
  CategoryType,
  GoalFundingMode,
  PushPlatform,
  RecurringCadence,
  RecurringStatus,
  RuleMatchType,
  SyncAccountStatus,
  SyncRunStatus,
  TransactionSource,
} from './entities.js';
// Type-only import; erased at emit, so no runtime dependency on constants.
import type { AttachmentContentType } from '../constants.js';

// ---------------------------------------------------------------------------
// Accounts — GET /accounts, GET /accounts/{accountId}
// ---------------------------------------------------------------------------

export interface AccountDto {
  accountId: string;
  name: string;
  /**
   * Legacy synced-type field, kept for compatibility. It may lag the user's
   * P8-4 type override — new consumers must read `accountTypeId`.
   */
  accountType: AccountType;
  institution: string;
  balance: DecimalString;
  balanceMinor: MinorUnits;
  availableBalance?: DecimalString;
  availableBalanceMinor?: MinorUnits;
  currency: CurrencyCode;
  /** SimpleFIN balance-date, epoch seconds. */
  balanceDate: EpochSeconds;
  lastSyncedAt: IsoTimestamp;
  /**
   * P8-4: the EFFECTIVE account type (user override ?? synced), computed
   * server-side via the shared `effectiveAccountType()` helper only.
   */
  accountTypeId: AccountTypeId;
  /**
   * The EFFECTIVE liability classification, computed server-side via the
   * shared `effectiveIsLiability()` helper only (P8-4: user override ??
   * effective type's metadata default; pre-P8-4 behavior is unchanged when
   * no overrides exist).
   */
  isLiability: boolean;
  /** P7-6: absent == 'simplefin' (pre-Phase-7 servers/items). */
  source?: AccountSource;
  /** P7-3: false == institution provides no holdings via SimpleFIN; absent == unknown. */
  holdingsSupported?: boolean;
}

/** GET /accounts — no pagination; the account count is small. */
export interface ListAccountsResponse {
  items: AccountDto[];
}

/** GET /accounts/{accountId} — 404 NOT_FOUND when absent. */
export type GetAccountResponse = AccountDto;

// ---------------------------------------------------------------------------
// Summary / net worth — GET /summary
// ---------------------------------------------------------------------------

export interface SummaryAccount {
  accountId: string;
  name: string;
  institution: string;
  /** Legacy synced type, kept for compatibility; prefer `accountTypeId`. */
  accountType: AccountType;
  /** P8-4: effective type via shared `effectiveAccountType()`. Additive. */
  accountTypeId?: AccountTypeId;
  balance: DecimalString;
  balanceMinor: MinorUnits;
  currency: CurrencyCode;
  balanceDate: EpochSeconds;
  /** Effective classification via shared `effectiveIsLiability()` (P8-4). */
  isLiability: boolean;
}

export interface SummaryTypeGroup {
  /**
   * Legacy compatibility key. When the server groups by effective type
   * (P8-4), this carries `toLegacyAccountType(typeId)`; prefer `typeId`.
   */
  type: AccountType;
  /**
   * P8-4: the effective-type group id; groups are keyed by
   * `effectiveAccountType()` and labeled from ACCOUNT_TYPES. Additive.
   */
  typeId?: AccountTypeId;
  /** Display label, e.g. "Cash", "Credit Cards". */
  label: string;
  isLiability: boolean;
  /** Signed contribution to net worth (liability groups are negative). */
  total: DecimalString;
  totalMinor: MinorUnits;
  accounts: SummaryAccount[];
}

export interface SummaryInstitutionGroup {
  institution: string;
  total: DecimalString;
  totalMinor: MinorUnits;
  accounts: SummaryAccount[];
}

/**
 * GET /summary — net worth and grouped balances, computed entirely server-side
 * from one accounts Query. v1 is a single number + as-of date (trend snapshots
 * deferred to v1.1 per resolved decision D5).
 */
export interface SummaryResponse {
  netWorth: DecimalString;
  netWorthMinor: MinorUnits;
  currency: CurrencyCode;
  /** max(balance-date) across accounts, epoch seconds. */
  asOf: EpochSeconds;
  assetsTotal: DecimalString;
  assetsTotalMinor: MinorUnits;
  liabilitiesTotal: DecimalString;
  liabilitiesTotalMinor: MinorUnits;
  byType: SummaryTypeGroup[];
  byInstitution: SummaryInstitutionGroup[];
}

/** Alias: the summary endpoint IS the v1 net-worth endpoint. */
export type NetWorthResponse = SummaryResponse;

// ---------------------------------------------------------------------------
// Transactions — GET /transactions, GET /accounts/{accountId}/transactions,
// PATCH /transactions/{txnId}
// ---------------------------------------------------------------------------

export interface TransactionDto {
  /** The SimpleFIN transaction id. */
  txnId: string;
  /** SK date bucket: posted date once posted, transacted date while pending. */
  date: IsoDate;
  /** Signed; expense negative, income positive. */
  amount: DecimalString;
  amountMinor: MinorUnits;
  currency: CurrencyCode;
  payee: string;
  description?: string;
  memo?: string;
  note?: string;
  categoryId: string | null;
  accountId: string;
  /** Denormalized for list rendering when the server has it cheaply. */
  accountName?: string;
  pending: boolean;
  isTransfer: boolean;
  userCategorized: boolean;
  categorizedBy: CategorizedBy;
  version: number;
  /** P7-6: absent == 'simplefin' (pre-Phase-7 servers/items). */
  source?: TransactionSource;
  /** P7-9: cognito sub of the last manual editor, for "edited by Aaron" attribution. */
  lastEditedBy?: string | null;
}

/**
 * Query parameters for GET /transactions (and the per-account variant, where
 * accountId comes from the path and routes the query to GSI1).
 * Defaults: current calendar month when from/to omitted; limit 50 (max 100);
 * range capped at 366 days (400 RANGE_TOO_LARGE beyond).
 */
export interface ListTransactionsQuery {
  from?: IsoDate;
  to?: IsoDate;
  /** Routes the query to GSI1 when present. */
  accountId?: string;
  /**
   * P8-3 category filter. Must be a known category slug (400 VALIDATION_ERROR
   * otherwise). Expense categories are served from the sparse GSI2 spend
   * index (categorized, non-transfer expense rows — the spending drill-down
   * semantics); income/transfer categories filter the base/GSI1 query.
   * Combinable with accountId/q/pendingOnly.
   */
  categoryId?: string;
  /** Free-text search, lowercased server-side, contains() on payeeLower/noteLower. */
  q?: string;
  pendingOnly?: boolean;
  limit?: number;
  /** Opaque cursor from a previous page's nextCursor. 400 BAD_CURSOR if malformed. */
  cursor?: string;
}

/**
 * Done is signalled ONLY by an absent/null nextCursor — never by
 * items.length < limit (filter expressions can return short pages).
 */
export interface ListTransactionsResponse {
  items: TransactionDto[];
  nextCursor?: string | null;
}

/**
 * PATCH /transactions/{txnId} — manual category assignment AND/OR note edit.
 * The client sends the transaction's current date so the Lambda can build
 * SK = TXN#<date>#<txnId> directly with no extra read (master plan section 14).
 * When categoryId is present the write rewrites categoryId + GSI2 keys and sets
 * userCategorized; a note-only edit leaves all of that untouched. Either way it
 * stamps lastEditedBy from the JWT and bumps version.
 */
export interface PatchTransactionCategoryRequest {
  date: IsoDate;
  /**
   * Category slug to (re)assign. OPTIONAL: omit for a note-only edit, which
   * leaves the category, the userCategorized flag, and the spend index
   * untouched. When present it must be a known ACTIVE category slug (400
   * VALIDATION_ERROR otherwise). At least one of `categoryId` or `note` must
   * be provided.
   */
  categoryId?: string;
  /**
   * Note text. Absent = leave the stored note unchanged; empty string =
   * clear it; any other value sets it.
   */
  note?: string;
}

export interface PatchTransactionCategoryResponse {
  item: TransactionDto;
}

// ---------------------------------------------------------------------------
// Budgets — GET/POST /budgets, PATCH/DELETE /budgets/{categoryId}
// ---------------------------------------------------------------------------

/**
 * Budget cadence (P11-1). `limitMinor` is the cap for ONE period (e.g. weekly
 * $450 = 45000 minor for the week, not a monthly figure). Default `'monthly'`
 * so the pre-Phase-11 budgets and clients are unchanged; a stored budget with
 * no period is read as `'monthly'`.
 */
export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly';

/** Allowed BudgetPeriod values, in display order (Week / Month / Year). */
export const BUDGET_PERIODS = ['weekly', 'monthly', 'yearly'] as const;

/** Runtime guard: `value` is one of the BudgetPeriod literals. */
export function isBudgetPeriod(value: unknown): value is BudgetPeriod {
  return (
    value === 'weekly' || value === 'monthly' || value === 'yearly'
  );
}

export interface BudgetDto {
  categoryId: string;
  /** Display name resolved from the category definition. */
  categoryName?: string;
  /**
   * Budget cadence (P11-1). The server always emits this; a stored budget with
   * no period is surfaced as `'monthly'` (back-compat for pre-Phase-11 budgets).
   */
  period: BudgetPeriod;
  /**
   * Inclusive start of the window the `spent` figure covers, yyyy-mm-dd
   * (P11-3). It is `periodWindow(period).from` so the client can label the
   * window ("this week" / "June" / "2026") without recomputing.
   */
  periodFrom: IsoDate;
  /** Inclusive end of the spent window, yyyy-mm-dd; `periodWindow(period).to`. */
  periodTo: IsoDate;
  limit: DecimalString;
  limitMinor: MinorUnits;
  rollover: boolean;
  /** Current-period actuals, computed server-side from GSI2. */
  spent: DecimalString;
  spentMinor: MinorUnits;
  remaining: DecimalString;
  remainingMinor: MinorUnits;
  version: number;
}

export interface ListBudgetsResponse {
  items: BudgetDto[];
}

/** POST /budgets — 201, or 409 ALREADY_EXISTS if the category already has one. */
export interface CreateBudgetRequest {
  categoryId: string;
  limit: DecimalString;
  rollover?: boolean;
  /**
   * Budget cadence (P11-1). Optional; omitted means `'monthly'` so existing
   * clients keep creating monthly budgets unchanged. Validated server-side with
   * `isBudgetPeriod` (400 on an unknown value).
   */
  period?: BudgetPeriod;
}

/**
 * PATCH /budgets/{categoryId} — optimistic locking: version must match the
 * stored item or the server returns 409 VERSION_CONFLICT. 404 if absent.
 */
export interface PatchBudgetRequest {
  limit?: DecimalString;
  rollover?: boolean;
  /**
   * Budget cadence (P11-1). Optional; absent leaves the stored period unchanged.
   * Validated server-side with `isBudgetPeriod` (400 on an unknown value).
   */
  period?: BudgetPeriod;
  version: number;
}

/** Response body for POST (201) and PATCH (200). DELETE returns 204, no body. */
export type BudgetResponse = BudgetDto;

// ---------------------------------------------------------------------------
// Categories — GET/POST /categories, PATCH/DELETE /categories/{categoryId}
// ---------------------------------------------------------------------------

export interface CategoryDto {
  categoryId: string;
  name: string;
  type: CategoryType;
  groupId?: string | null;
  sortOrder: number;
  archived: boolean;
  /**
   * P10-1: USER-OWNED curated glyph key (a member of GLYPH_KEYS from
   * `@goldfinch/shared/categoryStyle`). Absent = auto keyword/slug glyph. Never
   * derived or overwritten server-side (categories are user-created; sync never
   * writes them). The app resolves it through app/src/ui/icons/glyphs.ts.
   */
  iconKey?: string;
  /**
   * P10-1: USER-OWNED category palette KEY ('c1'..'c0' | 'other' — a member of
   * CATEGORY_COLOR_KEYS), NOT a raw hex; stays coherent across all four themes
   * and resolves to the live hex via `theme.cats[color]` at render. Absent =
   * deterministic hash pick (see `resolveCategoryColorKey`). Never derived or
   * overwritten server-side.
   */
  color?: string;
}

export interface ListCategoriesResponse {
  items: CategoryDto[];
}

/**
 * POST /categories — server derives the slug categoryId from the name.
 *
 * P10-1: `iconKey` and `color` are optional, USER-OWNED. The route MUST
 * validate them with the shared guards (`isGlyphKey` / `isCategoryColorKey`
 * from `@goldfinch/shared/categoryStyle`) — an unknown key is a 400
 * VALIDATION_ERROR, never silently dropped. Omitting both preserves today's
 * auto behavior (keyword glyph, hashed color).
 */
export interface CreateCategoryRequest {
  name: string;
  type: CategoryType;
  groupId?: string;
  sortOrder?: number;
  /** Curated glyph key; validated server-side against GLYPH_KEYS (400 if unknown). */
  iconKey?: string;
  /** Palette KEY ('c1'..'c0' | 'other'); validated against CATEGORY_COLOR_KEYS (400 if unknown). */
  color?: string;
}

/**
 * PATCH /categories/{id}.
 *
 * P10-1: a present `iconKey` / `color` is validated with the shared guards
 * (unknown key -> 400 VALIDATION_ERROR). Both are USER-OWNED palette/glyph
 * keys, never hex; the server stores the key verbatim and never derives them.
 */
export interface PatchCategoryRequest {
  name?: string;
  groupId?: string | null;
  sortOrder?: number;
  archived?: boolean;
  /** Curated glyph key; validated server-side against GLYPH_KEYS (400 if unknown). */
  iconKey?: string;
  /** Palette KEY ('c1'..'c0' | 'other'); validated against CATEGORY_COLOR_KEYS (400 if unknown). */
  color?: string;
}

/** DELETE /categories/{categoryId} is a soft delete (archived: true). */
export interface ArchiveCategoryResponse {
  categoryId: string;
  archived: true;
}

// ---------------------------------------------------------------------------
// Cash flow — GET /cashflow?from=yyyy-mm&to=yyyy-mm
// ---------------------------------------------------------------------------

export interface CashflowQuery {
  from: IsoMonth;
  to: IsoMonth;
}

/** income and expense are positive magnitudes; net = income - expense. Transfers excluded. */
export interface CashflowMonth {
  month: IsoMonth;
  income: DecimalString;
  incomeMinor: MinorUnits;
  expense: DecimalString;
  expenseMinor: MinorUnits;
  net: DecimalString;
  netMinor: MinorUnits;
}

export interface CashflowTotals {
  income: DecimalString;
  incomeMinor: MinorUnits;
  expense: DecimalString;
  expenseMinor: MinorUnits;
  net: DecimalString;
  netMinor: MinorUnits;
}

export interface CashflowResponse {
  months: CashflowMonth[];
  totals: CashflowTotals;
  currency: CurrencyCode;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Client-facing view of the sync state (no internals like the SimpleFIN cursor). */
export interface SyncStateDto {
  lastRunAt: IsoTimestamp;
  lastRunStatus: SyncRunStatus;
  perAccount: Record<string, SyncAccountStatus>;
}

/** GET /health */
export interface HealthResponse {
  ok: true;
}

// ===========================================================================
// Phase 7 DTOs (PHASE7-DECISIONS.md P7-1..P7-9)
// ===========================================================================

// ---------------------------------------------------------------------------
// Per-currency grouped money shapes (P7-7)
//
// No FX conversion exists in v1, so any aggregate that can span currencies is
// carried as an ARRAY of per-currency entries — never a synthetic
// mixed-currency total. Single-currency households see one entry.
// ---------------------------------------------------------------------------

/** One money value with its currency, as the usual decimal/minor pair. */
export interface MoneyDto {
  amount: DecimalString;
  amountMinor: MinorUnits;
  currency: CurrencyCode;
}

/** One currency's subtotal inside a grouped aggregate. */
export interface PerCurrencyTotal {
  currency: CurrencyCode;
  total: DecimalString;
  totalMinor: MinorUnits;
}

/** One currency's income/expense/net slice (trends, flow). */
export interface PerCurrencyCashflow {
  currency: CurrencyCode;
  /** Positive magnitude. */
  income: DecimalString;
  incomeMinor: MinorUnits;
  /** Positive magnitude. */
  expense: DecimalString;
  expenseMinor: MinorUnits;
  /** income - expense; signed. */
  net: DecimalString;
  netMinor: MinorUnits;
}

/** One currency's assets/liabilities/net slice (net worth). */
export interface PerCurrencyNetWorth {
  currency: CurrencyCode;
  assets: DecimalString;
  assetsMinor: MinorUnits;
  liabilities: DecimalString;
  liabilitiesMinor: MinorUnits;
  net: DecimalString;
  netMinor: MinorUnits;
}

// ---------------------------------------------------------------------------
// Recurring (P7-1) — GET /recurring, PATCH /recurring/{seriesId}
// ---------------------------------------------------------------------------

export interface RecurringSeriesDto {
  seriesId: string;
  payee: string;
  cadence: RecurringCadence;
  avgAmount: DecimalString;
  avgAmountMinor: MinorUnits;
  currency: CurrencyCode;
  lastDate: IsoDate;
  nextExpectedDate: IsoDate;
  accountId: string;
  /** Denormalized for list rendering when the server has it cheaply. */
  accountName?: string;
  status: RecurringStatus;
  occurrenceCount: number;
}

/** GET /recurring — small set, no pagination. Sorted by nextExpectedDate asc. */
export interface ListRecurringResponse {
  items: RecurringSeriesDto[];
}

/** PATCH /recurring/{seriesId} — user review action only. 404 when absent. */
export interface PatchRecurringRequest {
  status: 'confirmed' | 'ignored';
}

export interface PatchRecurringResponse {
  item: RecurringSeriesDto;
}

// ---------------------------------------------------------------------------
// Goals (P7-2) — GET/POST /goals, PATCH/DELETE /goals/{goalId},
// POST /goals/{goalId}/contributions
// ---------------------------------------------------------------------------

export interface GoalDto {
  goalId: string;
  name: string;
  target: DecimalString;
  targetMinor: MinorUnits;
  currency: CurrencyCode;
  targetDate?: IsoDate | null;
  fundingMode: GoalFundingMode;
  linkedAccountId?: string | null;
  /**
   * Server-computed progress: the linked account's balance
   * ('linked-account') or the contribution sum ('manual').
   */
  progress: DecimalString;
  progressMinor: MinorUnits;
  /** floor(progress / target * 100) via percentUsed; may exceed 100. */
  percentComplete: number;
  version: number;
  createdAt: IsoTimestamp;
}

export interface ListGoalsResponse {
  items: GoalDto[];
}

/** POST /goals — 201. linkedAccountId required iff fundingMode 'linked-account'. */
export interface CreateGoalRequest {
  name: string;
  target: DecimalString;
  /** Defaults to the linked account's currency, else the household base currency. */
  currency?: CurrencyCode;
  targetDate?: IsoDate;
  fundingMode: GoalFundingMode;
  linkedAccountId?: string;
}

/** PATCH /goals/{goalId} — optimistic locking; 409 VERSION_CONFLICT on mismatch. */
export interface PatchGoalRequest {
  name?: string;
  target?: DecimalString;
  /** null clears the deadline. */
  targetDate?: IsoDate | null;
  fundingMode?: GoalFundingMode;
  /** null detaches the account (required non-null when switching to 'linked-account'). */
  linkedAccountId?: string | null;
  version: number;
}

/** Response body for POST (201) and PATCH (200). DELETE returns 204, no body. */
export type GoalResponse = GoalDto;

export interface GoalContributionDto {
  goalId: string;
  contributedAt: IsoTimestamp;
  /** Signed; negative entries are withdrawals/corrections. */
  amount: DecimalString;
  amountMinor: MinorUnits;
  currency: CurrencyCode;
  note?: string;
  /** Cognito sub of the contributing user. */
  createdBy: string;
}

/** POST /goals/{goalId}/contributions — 404 unless the goal is fundingMode 'manual'. */
export interface CreateGoalContributionRequest {
  amount: DecimalString;
  note?: string;
  /** Defaults to the server's now. */
  contributedAt?: IsoTimestamp;
}

/** 201 — returns the contribution and the goal with refreshed progress. */
export interface CreateGoalContributionResponse {
  item: GoalContributionDto;
  goal: GoalDto;
}

// ---------------------------------------------------------------------------
// Holdings (P7-3) — GET /accounts/{accountId}/holdings
// ---------------------------------------------------------------------------

export interface HoldingDto {
  holdingId: string;
  accountId: string;
  symbol?: string;
  description: string;
  /** Fractional share count as an exact decimal string (not money). */
  shares: DecimalString;
  costBasis?: DecimalString;
  costBasisMinor?: MinorUnits;
  marketValue: DecimalString;
  marketValueMinor: MinorUnits;
  currency: CurrencyCode;
  asOf: EpochSeconds;
}

/**
 * GET /accounts/{accountId}/holdings — `holdingsSupported: false` means the
 * institution does not provide holdings via SimpleFIN; the UI MUST render
 * that explicit state, never a silent blank (P7-3).
 */
export interface ListHoldingsResponse {
  items: HoldingDto[];
  holdingsSupported: boolean;
}

// ---------------------------------------------------------------------------
// Net-worth history (P7-4) — GET /networth/history?from&to
// ---------------------------------------------------------------------------

/** Defaults: to = today, from = earliest snapshot. Dates are yyyy-mm-dd. */
export interface NetWorthHistoryQuery {
  from?: IsoDate;
  to?: IsoDate;
}

export interface NetWorthSnapshotDto {
  date: IsoDate;
  /** Household base currency; the top-level totals are ITS slice (P7-7). */
  currency: CurrencyCode;
  assets: DecimalString;
  assetsMinor: MinorUnits;
  liabilities: DecimalString;
  liabilitiesMinor: MinorUnits;
  net: DecimalString;
  netMinor: MinorUnits;
  perCurrency: PerCurrencyNetWorth[];
}

/**
 * History accrues from first deploy — `firstSnapshotDate` is null until the
 * first snapshot exists, and the chart must state its start date (P7-4).
 */
export interface NetWorthHistoryResponse {
  items: NetWorthSnapshotDto[];
  firstSnapshotDate: IsoDate | null;
}

// ---------------------------------------------------------------------------
// Reports (P7-4) — GET /reports/trends?months=N, GET /reports/flow?month=
// ---------------------------------------------------------------------------

export interface ReportsTrendsQuery {
  /** Trailing whole months including the current one; server-capped. */
  months?: number;
}

export interface TrendMonthDto {
  month: IsoMonth;
  /** One entry per currency seen that month (P7-7). */
  perCurrency: PerCurrencyCashflow[];
}

export interface ReportsTrendsResponse {
  months: TrendMonthDto[];
}

export interface ReportsFlowQuery {
  month: IsoMonth;
}

/** One sankey edge: spend into a category. Positive magnitudes. */
export interface FlowCategoryDto {
  /** null bucket = uncategorized spend. */
  categoryId: string | null;
  /** Display name; "Uncategorized" for the null bucket. */
  categoryName: string;
  amount: DecimalString;
  amountMinor: MinorUnits;
}

/** One currency's income -> category flow for the month. */
export interface FlowCurrencyGroupDto {
  currency: CurrencyCode;
  income: DecimalString;
  incomeMinor: MinorUnits;
  expense: DecimalString;
  expenseMinor: MinorUnits;
  /** income - expense; the unallocated remainder of the flow. */
  net: DecimalString;
  netMinor: MinorUnits;
  /** Sorted by amountMinor desc. Transfers excluded throughout. */
  categories: FlowCategoryDto[];
}

export interface ReportsFlowResponse {
  month: IsoMonth;
  perCurrency: FlowCurrencyGroupDto[];
}

// ---------------------------------------------------------------------------
// Rules (P7-5) — GET/POST /rules, PATCH/DELETE /rules/{ruleId},
// POST /rules/{ruleId}/apply
// ---------------------------------------------------------------------------

export interface RuleDto {
  ruleId: string;
  matchType: RuleMatchType;
  /** Lowercased payee pattern. */
  pattern: string;
  /** Inclusive bound on abs(amount); null = unbounded. */
  amountMin?: DecimalString | null;
  amountMinMinor?: MinorUnits | null;
  amountMax?: DecimalString | null;
  amountMaxMinor?: MinorUnits | null;
  categoryId: string;
  /** Lower value = higher precedence within the same matchType. */
  priority: number;
  enabled: boolean;
  version: number;
}

/** GET /rules — full set, sorted by matchType precedence then priority. */
export interface ListRulesResponse {
  items: RuleDto[];
}

/** POST /rules — 201. Pattern is lowercased server-side. */
export interface CreateRuleRequest {
  matchType: RuleMatchType;
  pattern: string;
  amountMin?: DecimalString;
  amountMax?: DecimalString;
  categoryId: string;
  /** Defaults to 100. */
  priority?: number;
  /** Defaults to true. */
  enabled?: boolean;
}

/** PATCH /rules/{ruleId} — optimistic locking; 409 VERSION_CONFLICT on mismatch. */
export interface PatchRuleRequest {
  matchType?: RuleMatchType;
  pattern?: string;
  /** null clears the bound. */
  amountMin?: DecimalString | null;
  amountMax?: DecimalString | null;
  categoryId?: string;
  priority?: number;
  enabled?: boolean;
  version: number;
}

/** Response body for POST (201) and PATCH (200). DELETE returns 204, no body. */
export type RuleResponse = RuleDto;

/**
 * POST /rules/{ruleId}/apply — retroactive run over UNCATEGORIZED,
 * non-user-categorized transactions only (P7-5). Optional date window;
 * defaults to the server's full retroactive window.
 */
export interface ApplyRuleRequest {
  from?: IsoDate;
  to?: IsoDate;
}

export interface ApplyRuleResponse {
  ruleId: string;
  /** Transactions the rule matched in the window. */
  matchedCount: number;
  /** Transactions actually recategorized (matched minus skips/races). */
  updatedCount: number;
}

// ---------------------------------------------------------------------------
// CSV import + manual accounts (P7-6) — POST /import/transactions,
// POST /accounts
// ---------------------------------------------------------------------------

/**
 * One client-normalized CSV row (see `@goldfinch/shared/csv`). The server
 * recomputes the row hash from these exact fields; clients must send the
 * normalized forms, not raw CSV cells.
 */
export interface ImportRowDto {
  date: IsoDate;
  /** Signed exact decimal; expense negative, matching the TXN convention. */
  amount: DecimalString;
  payee: string;
  /** Pre-mapped category slug; null/absent = uncategorized. */
  categoryId?: string | null;
  note?: string;
  /**
   * Disambiguates legitimately identical rows in one file (same date,
   * amount, payee); see computeRowHashes. Defaults to 0.
   */
  occurrence?: number;
}

/**
 * POST /import/transactions — idempotent per (importId, rowHash): retrying a
 * batch can never double-import. Rows beyond IMPORT_MAX_ROWS_PER_BATCH are
 * rejected with 400 VALIDATION_ERROR. The target account must exist (manual
 * or synced); amounts are parsed in that account's currency.
 */
export interface ImportTransactionsRequest {
  /** Client-generated UUID identifying the whole import (stable across batches). */
  importId: string;
  accountId: string;
  rows: ImportRowDto[];
}

export interface ImportTransactionsResponse {
  importId: string;
  received: number;
  created: number;
  /** Rows skipped because their (importId, rowHash) pointer already existed. */
  duplicates: number;
}

/** POST /accounts — 201; creates a manual (source 'manual') account. */
export interface CreateAccountRequest {
  name: string;
  accountType: AccountType;
  currency: CurrencyCode;
  /** Defaults to "Manual". */
  institution?: string;
  /** Defaults to "0". */
  openingBalance?: DecimalString;
}

export type CreateAccountResponse = AccountDto;

// ---------------------------------------------------------------------------
// Attachments (P7-9) — POST/GET /transactions/{txnId}/attachments,
// GET/DELETE /transactions/{txnId}/attachments/{attachId}
// ---------------------------------------------------------------------------

export interface AttachmentDto {
  attachId: string;
  txnId: string;
  fileName: string;
  contentType: AttachmentContentType;
  sizeBytes: number;
  status: AttachmentStatus;
  /** Cognito sub of the uploader. */
  uploadedBy: string;
  createdAt: IsoTimestamp;
}

/**
 * POST /transactions/{txnId}/attachments — validates contentType against
 * ATTACHMENT_ALLOWED_CONTENT_TYPES and sizeBytes against ATTACHMENT_MAX_BYTES
 * (400 VALIDATION_ERROR), writes the metadata item, and returns a presigned
 * PUT URL. The client uploads the bytes directly to S3.
 */
export interface CreateAttachmentRequest {
  fileName: string;
  contentType: AttachmentContentType;
  sizeBytes: number;
}

export interface CreateAttachmentResponse {
  item: AttachmentDto;
  /** Presigned S3 PUT URL; expires after expiresInSeconds. */
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface ListAttachmentsResponse {
  items: AttachmentDto[];
}

/** GET .../attachments/{attachId} — returns a presigned GET URL, not bytes. */
export interface GetAttachmentDownloadResponse {
  attachId: string;
  downloadUrl: string;
  expiresInSeconds: number;
}

// DELETE .../attachments/{attachId} removes the S3 object + metadata; 204, no body.

// ---------------------------------------------------------------------------
// Push tokens (P7-8) — POST /devices/push-token,
// DELETE /devices/push-token/{deviceId}
// ---------------------------------------------------------------------------

/** POST /devices/push-token — upsert by deviceId (re-registration refreshes). */
export interface RegisterPushTokenRequest {
  /** Stable per-install device identifier (client-generated UUID). */
  deviceId: string;
  /** ExponentPushToken[...] from expo-notifications. */
  expoPushToken: string;
  platform: PushPlatform;
}

export interface RegisterPushTokenResponse {
  deviceId: string;
}

// DELETE /devices/push-token/{deviceId} — 204, no body; idempotent.

// ---------------------------------------------------------------------------
// User profile — GET /profile, PATCH /profile
//
// Per-user within the household: the server derives the Cognito sub from the
// JWT claims (NEVER from client input) and reads/writes PROFILE#<sub>, so
// each spouse has their own display name.
// ---------------------------------------------------------------------------

export interface ProfileDto {
  /**
   * The user-chosen display name (greeting name). null when the profile item
   * exists without one; GET /profile 404s when no profile item exists at all,
   * and clients treat that exactly like displayName null.
   */
  displayName: string | null;
  /** Present only when the access token carries an email claim. */
  email?: string;
}

/** GET /profile — 404 NOT_FOUND when the caller has no profile item yet. */
export type GetProfileResponse = ProfileDto;

/**
 * PATCH /profile — sets the caller's display name. The server trims the
 * value and enforces PROFILE_DISPLAY_NAME_MIN/MAX_LENGTH (1-40 chars after
 * trim; 400 VALIDATION_ERROR outside the bounds). Upserts the caller's
 * PROFILE#<sub> item, version-conditionally: a concurrent edit returns 409
 * VERSION_CONFLICT and the client refetches.
 */
export interface PatchProfileRequest {
  displayName: string;
}

/** 200 — the stored profile after the write. */
export type PatchProfileResponse = ProfileDto;

// ===========================================================================
// Phase 8 DTOs (ops/PHASE8-DECISIONS.md)
// ===========================================================================

// ---------------------------------------------------------------------------
// Account type editing (P8-4) — PATCH /accounts/{accountId}
// ---------------------------------------------------------------------------

/**
 * PATCH /accounts/{accountId} — sets the USER-OWNED override fields
 * (AccountItem.typeOverride / .isLiabilityOverride; sync never writes them).
 *
 * Validation (400 VALIDATION_ERROR): at least one field must be present;
 * `accountType` must satisfy the shared `isAccountTypeId()` guard — the
 * server must use that guard, never a hand-rolled list. 404 NOT_FOUND when
 * the account does not exist (the write conditions on item existence).
 *
 * A liability flip is allowed and immediately changes the account's
 * net-worth classification: the response carries the post-write EFFECTIVE
 * values (`accountTypeId`, `isLiability`), and /summary plus the next
 * net-worth snapshot reclassify on the same shared helpers.
 */
export interface PatchAccountRequest {
  /** Becomes the account's typeOverride (effective type wins over synced). */
  accountType?: AccountTypeId;
  /** Becomes the account's isLiabilityOverride (wins over the type default). */
  isLiability?: boolean;
}

/** 200 — the account after the write, with effective values applied. */
export type PatchAccountResponse = AccountDto;

// ---------------------------------------------------------------------------
// On-demand sync (Phase 8) — POST /sync/run, GET /sync/status
//
// Field shapes mirror the SYNC#STATE record as services/sync/src/state.ts
// actually writes it: run/account timestamps are ISO-8601 strings
// (IsoTimestamp), the success cursor is epoch SECONDS (EpochSeconds). The API
// converts nothing — it only maps record fields onto this DTO.
// ---------------------------------------------------------------------------

/**
 * POST /sync/run — asynchronously invokes the sync Lambda (fire-and-forget).
 *
 * 202 { accepted: true } when the invoke was dispatched. When SYNC#STATE
 * lastRunAt is within SYNC_RUN_DEBOUNCE_SECONDS, the handler does NOT invoke
 * and answers 200 { accepted: false, alreadyRunning: true } instead. 502
 * ErrorEnvelope when the invoke itself fails.
 */
export interface SyncRunResponse {
  accepted: boolean;
  /** Present (true) only on the debounce path. */
  alreadyRunning?: boolean;
}

/** One account's last-sync outcome inside SyncStatusResponse. */
export interface SyncStatusAccountDto {
  accountId: string;
  status: SyncRunStatus;
  /** When the account last appeared in a sync payload (ISO-8601); null if unknown. */
  lastSyncedAt?: IsoTimestamp | null;
  /** Human-readable failure reason when status is 'error'; null otherwise. */
  errorReason?: string | null;
}

/**
 * GET /sync/status — the SYNC#STATE singleton mapped for clients. A household
 * that has never synced has NO record yet; that is NOT a 404 — every field is
 * null and `accounts` is empty.
 */
export interface SyncStatusResponse {
  /** When the last sync run finished (ISO-8601), null before the first run. */
  lastRunAt: IsoTimestamp | null;
  lastRunStatus: SyncRunStatus | null;
  /**
   * Conservative success cursor (epoch SECONDS): the point before which every
   * account's data is known persisted. null until the first fully persisted run.
   */
  lastSuccessAt?: EpochSeconds | null;
  /** Sorted by accountId for deterministic rendering. */
  accounts: SyncStatusAccountDto[];
}

// ---------------------------------------------------------------------------
// SyncCompleted EventBridge wire contract (P7-8)
// ---------------------------------------------------------------------------

/**
 * Detail payload of the SyncCompleted event (source SYNC_EVENT_SOURCE,
 * detail-type SYNC_COMPLETED_DETAIL_TYPE — both in ../constants). This is THE
 * cross-service wire contract: services/sync emits it, services/notifications
 * consumes it. Required fields are what the consumer may rely on; the count
 * fields are optional extras — without one the consumer skips the
 * sync-complete push (budget evaluation still runs from the table).
 */
export interface SyncCompletedEventDetail {
  /** The sync run's correlation id (Lambda request id). */
  runId: string;
  status: SyncRunStatus;
  /** Must match the consumer's configured household or the event is ignored. */
  household: string;
  /** Accounts upserted by the run. Informational only. */
  accountsSynced?: number;
  /** Count of NEW transactions written by the run; drives the sync push. */
  newTxnCount?: number;
  /** Upserted-row fallback when the emitter has no new-row count. */
  txnsUpserted?: number;
  /** When the sync run finished. Informational only. */
  syncedAt?: IsoTimestamp;
}
