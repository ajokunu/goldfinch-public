/**
 * Typed endpoint functions, one per API route. Paths and DTOs follow
 * @goldfinch/shared (API_ROUTES route keys; DTOs from /types). Feature parts
 * consume these from their TanStack Query hooks together with queryKeys.
 *
 * Money convention: every response money field is a pair -- decimal string
 * `x` for display plus integer `xMinor` for arithmetic. Request bodies carry
 * decimal strings. Floats never appear.
 */
import type {
  ApplyRuleRequest,
  ApplyRuleResponse,
  ArchiveCategoryResponse,
  BudgetResponse,
  CashflowQuery,
  CashflowResponse,
  CategoryDto,
  CreateAccountRequest,
  CreateAccountResponse,
  CreateAttachmentRequest,
  CreateAttachmentResponse,
  CreateBudgetRequest,
  CreateCategoryRequest,
  CreateGoalContributionRequest,
  CreateGoalContributionResponse,
  CreateGoalRequest,
  CreateRuleRequest,
  GetAccountResponse,
  GetAttachmentDownloadResponse,
  GoalResponse,
  HealthResponse,
  HoldingPriceHistoryQuery,
  HoldingPriceHistoryResponse,
  ImportTransactionsRequest,
  ImportTransactionsResponse,
  ListAccountsResponse,
  ListAttachmentsResponse,
  ListBudgetsQuery,
  ListBudgetsResponse,
  ListCategoriesResponse,
  ListGoalsResponse,
  ListHoldingsResponse,
  ListRecurringResponse,
  ListRulesResponse,
  ListTransactionsResponse,
  NetWorthHistoryQuery,
  NetWorthHistoryResponse,
  PatchAccountRequest,
  PatchAccountResponse,
  SetHoldingCostBasisRequest,
  PatchBudgetRequest,
  PatchCategoryRequest,
  PatchGoalRequest,
  PatchRecurringRequest,
  PatchRecurringResponse,
  PatchRuleRequest,
  GetProfileResponse,
  PatchProfileRequest,
  PatchProfileResponse,
  PatchTransactionCategoryRequest,
  PatchTransactionCategoryResponse,
  RegisterPushTokenRequest,
  RegisterPushTokenResponse,
  ReportsFlowQuery,
  ReportsFlowResponse,
  ReportsTrendsQuery,
  ReportsTrendsResponse,
  RuleResponse,
  SummaryResponse,
  SyncRunResponse,
  SyncStatusResponse,
} from '@goldfinch/shared/types';

import { apiFetch } from './client';
import type { TransactionListFilters } from './queryKeys';

// ---------------------------------------------------------------------------
// Accounts & summary
// ---------------------------------------------------------------------------

export function listAccounts(signal?: AbortSignal): Promise<ListAccountsResponse> {
  return apiFetch<ListAccountsResponse>('/accounts', { signal });
}

export function getAccount(
  accountId: string,
  signal?: AbortSignal,
): Promise<GetAccountResponse> {
  return apiFetch<GetAccountResponse>(
    `/accounts/${encodeURIComponent(accountId)}`,
    { signal },
  );
}

/**
 * PATCH /accounts/{accountId} (P8-4, API_ROUTES.patchAccount): sets the
 * USER-OWNED override fields (typeOverride / isLiabilityOverride). The
 * response is the account with EFFECTIVE values applied -- a liability flip
 * immediately reclassifies net worth server-side.
 */
export function patchAccount(
  accountId: string,
  body: PatchAccountRequest,
): Promise<PatchAccountResponse> {
  return apiFetch<PatchAccountResponse>(
    `/accounts/${encodeURIComponent(accountId)}`,
    { method: 'PATCH', body },
  );
}

export function getSummary(signal?: AbortSignal): Promise<SummaryResponse> {
  return apiFetch<SummaryResponse>('/summary', { signal });
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * GET /transactions (or the per-account GSI1 variant). Accepts the app-side
 * filter shape so the P8-3 `categoryId` filter (server GSI2) rides the query
 * string alongside the shared wire params.
 */
export function listTransactions(
  query: TransactionListFilters & { cursor?: string } = {},
  signal?: AbortSignal,
): Promise<ListTransactionsResponse> {
  const { accountId, ...rest } = query;
  const path = accountId
    ? `/accounts/${encodeURIComponent(accountId)}/transactions`
    : '/transactions';
  return apiFetch<ListTransactionsResponse>(path, { query: rest, signal });
}

export function patchTransactionCategory(
  txnId: string,
  body: PatchTransactionCategoryRequest,
): Promise<PatchTransactionCategoryResponse> {
  return apiFetch<PatchTransactionCategoryResponse>(
    `/transactions/${encodeURIComponent(txnId)}`,
    { method: 'PATCH', body },
  );
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/**
 * GET /budgets (budget-range feature, Decision 3). With no query: every budget
 * is windowed by its own cadence and `limitMinor` is the stored one-period cap.
 * With both `from`/`to` (inclusive yyyy-mm-dd): every budget is windowed to that
 * range and `limitMinor` carries the server-prorated range target. The shared
 * `ListBudgetsQuery` is the single definition both this producer and the route
 * (`services/api/src/routes/budgets.ts`, consumer) reference.
 */
export function listBudgets(
  query: ListBudgetsQuery = {},
  signal?: AbortSignal,
): Promise<ListBudgetsResponse> {
  return apiFetch<ListBudgetsResponse>('/budgets', { query: { ...query }, signal });
}

export function createBudget(body: CreateBudgetRequest): Promise<BudgetResponse> {
  return apiFetch<BudgetResponse>('/budgets', { method: 'POST', body });
}

export function patchBudget(
  categoryId: string,
  body: PatchBudgetRequest,
): Promise<BudgetResponse> {
  return apiFetch<BudgetResponse>(`/budgets/${encodeURIComponent(categoryId)}`, {
    method: 'PATCH',
    body,
  });
}

export function deleteBudget(categoryId: string): Promise<void> {
  return apiFetch<void>(`/budgets/${encodeURIComponent(categoryId)}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function listCategories(
  signal?: AbortSignal,
): Promise<ListCategoriesResponse> {
  return apiFetch<ListCategoriesResponse>('/categories', { signal });
}

export function createCategory(body: CreateCategoryRequest): Promise<CategoryDto> {
  return apiFetch<CategoryDto>('/categories', { method: 'POST', body });
}

export function patchCategory(
  categoryId: string,
  body: PatchCategoryRequest,
): Promise<CategoryDto> {
  return apiFetch<CategoryDto>(`/categories/${encodeURIComponent(categoryId)}`, {
    method: 'PATCH',
    body,
  });
}

export function archiveCategory(
  categoryId: string,
): Promise<ArchiveCategoryResponse> {
  return apiFetch<ArchiveCategoryResponse>(
    `/categories/${encodeURIComponent(categoryId)}`,
    { method: 'DELETE' },
  );
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

export function getCashflow(
  query: CashflowQuery,
  signal?: AbortSignal,
): Promise<CashflowResponse> {
  return apiFetch<CashflowResponse>('/cashflow', { query: { ...query }, signal });
}

// ---------------------------------------------------------------------------
// Recurring (P7-1) -- GET /recurring, PATCH /recurring/{seriesId}
// ---------------------------------------------------------------------------

export function listRecurring(signal?: AbortSignal): Promise<ListRecurringResponse> {
  return apiFetch<ListRecurringResponse>('/recurring', { signal });
}

export function patchRecurring(
  seriesId: string,
  body: PatchRecurringRequest,
): Promise<PatchRecurringResponse> {
  return apiFetch<PatchRecurringResponse>(
    `/recurring/${encodeURIComponent(seriesId)}`,
    { method: 'PATCH', body },
  );
}

// ---------------------------------------------------------------------------
// Goals (P7-2) -- GET/POST /goals, PATCH/DELETE /goals/{goalId},
// POST /goals/{goalId}/contributions
// ---------------------------------------------------------------------------

export function listGoals(signal?: AbortSignal): Promise<ListGoalsResponse> {
  return apiFetch<ListGoalsResponse>('/goals', { signal });
}

export function createGoal(body: CreateGoalRequest): Promise<GoalResponse> {
  return apiFetch<GoalResponse>('/goals', { method: 'POST', body });
}

export function patchGoal(
  goalId: string,
  body: PatchGoalRequest,
): Promise<GoalResponse> {
  return apiFetch<GoalResponse>(`/goals/${encodeURIComponent(goalId)}`, {
    method: 'PATCH',
    body,
  });
}

export function deleteGoal(goalId: string): Promise<void> {
  return apiFetch<void>(`/goals/${encodeURIComponent(goalId)}`, {
    method: 'DELETE',
  });
}

export function createGoalContribution(
  goalId: string,
  body: CreateGoalContributionRequest,
): Promise<CreateGoalContributionResponse> {
  return apiFetch<CreateGoalContributionResponse>(
    `/goals/${encodeURIComponent(goalId)}/contributions`,
    { method: 'POST', body },
  );
}

// ---------------------------------------------------------------------------
// Holdings (P7-3) -- GET /accounts/{accountId}/holdings
// ---------------------------------------------------------------------------

export function listAccountHoldings(
  accountId: string,
  signal?: AbortSignal,
): Promise<ListHoldingsResponse> {
  return apiFetch<ListHoldingsResponse>(
    `/accounts/${encodeURIComponent(accountId)}/holdings`,
    { signal },
  );
}

/**
 * POST /accounts/{accountId}/holdings/{symbol}/cost-basis
 * (API_ROUTES.setHoldingCostBasis): sets or clears the USER-OWNED manual TOTAL
 * cost basis for a position. `amount` is the decimal string the user typed
 * (parsed server-side against the holding's currency); `null` clears the basis
 * (deletes the HOLDING_BASIS item). The response is the full refreshed holdings
 * list with gain/percentReturn re-derived through the shared helper.
 */
export function setHoldingCostBasis(
  accountId: string,
  symbol: string,
  body: SetHoldingCostBasisRequest,
): Promise<ListHoldingsResponse> {
  return apiFetch<ListHoldingsResponse>(
    `/accounts/${encodeURIComponent(accountId)}/holdings/${encodeURIComponent(symbol)}/cost-basis`,
    { method: 'POST', body },
  );
}

/**
 * GET /accounts/{accountId}/holdings/{symbol}/price-history?from&to
 * (API_ROUTES.holdingPriceHistory): the daily price-per-share snapshot series
 * for one position, plus `firstSnapshotDate` (null before the first snapshot).
 * The server stays a dumb history (like /networth/history) -- the client
 * NORMALIZES `items` to a % return series via the shared holdingReturn helper.
 * Defaults: `to` = today, `from` = earliest snapshot (both inclusive yyyy-mm-dd).
 */
export function holdingPriceHistory(
  accountId: string,
  symbol: string,
  query: HoldingPriceHistoryQuery = {},
  signal?: AbortSignal,
): Promise<HoldingPriceHistoryResponse> {
  return apiFetch<HoldingPriceHistoryResponse>(
    `/accounts/${encodeURIComponent(accountId)}/holdings/${encodeURIComponent(symbol)}/price-history`,
    { query: { ...query }, signal },
  );
}

// ---------------------------------------------------------------------------
// Net-worth history + reports (P7-4)
// ---------------------------------------------------------------------------

export function getNetWorthHistory(
  query: NetWorthHistoryQuery = {},
  signal?: AbortSignal,
): Promise<NetWorthHistoryResponse> {
  return apiFetch<NetWorthHistoryResponse>('/networth/history', {
    query: { ...query },
    signal,
  });
}

export function getReportsTrends(
  query: ReportsTrendsQuery = {},
  signal?: AbortSignal,
): Promise<ReportsTrendsResponse> {
  return apiFetch<ReportsTrendsResponse>('/reports/trends', {
    query: { ...query },
    signal,
  });
}

export function getReportsFlow(
  query: ReportsFlowQuery,
  signal?: AbortSignal,
): Promise<ReportsFlowResponse> {
  return apiFetch<ReportsFlowResponse>('/reports/flow', {
    query: { ...query },
    signal,
  });
}

// ---------------------------------------------------------------------------
// Rules (P7-5) -- GET/POST /rules, PATCH/DELETE /rules/{ruleId},
// POST /rules/{ruleId}/apply
// ---------------------------------------------------------------------------

export function listRules(signal?: AbortSignal): Promise<ListRulesResponse> {
  return apiFetch<ListRulesResponse>('/rules', { signal });
}

export function createRule(body: CreateRuleRequest): Promise<RuleResponse> {
  return apiFetch<RuleResponse>('/rules', { method: 'POST', body });
}

export function patchRule(
  ruleId: string,
  body: PatchRuleRequest,
): Promise<RuleResponse> {
  return apiFetch<RuleResponse>(`/rules/${encodeURIComponent(ruleId)}`, {
    method: 'PATCH',
    body,
  });
}

export function deleteRule(ruleId: string): Promise<void> {
  return apiFetch<void>(`/rules/${encodeURIComponent(ruleId)}`, {
    method: 'DELETE',
  });
}

export function applyRule(
  ruleId: string,
  body: ApplyRuleRequest = {},
): Promise<ApplyRuleResponse> {
  return apiFetch<ApplyRuleResponse>(
    `/rules/${encodeURIComponent(ruleId)}/apply`,
    { method: 'POST', body },
  );
}

// ---------------------------------------------------------------------------
// CSV import + manual accounts (P7-6) -- POST /import/transactions,
// POST /accounts
// ---------------------------------------------------------------------------

/**
 * Idempotent per (importId, rowHash); the rows array ORDER is part of the
 * contract because computeRowHashes assigns occurrence indexes in request
 * order. Batches are capped at IMPORT_MAX_ROWS_PER_BATCH server-side.
 */
export function importTransactions(
  body: ImportTransactionsRequest,
): Promise<ImportTransactionsResponse> {
  return apiFetch<ImportTransactionsResponse>('/import/transactions', {
    method: 'POST',
    body,
  });
}

export function createAccount(
  body: CreateAccountRequest,
): Promise<CreateAccountResponse> {
  return apiFetch<CreateAccountResponse>('/accounts', { method: 'POST', body });
}

// ---------------------------------------------------------------------------
// Attachments (P7-9) -- /transactions/{txnId}/attachments[/{attachId}]
// ---------------------------------------------------------------------------

/** Returns metadata + a presigned PUT URL; the client uploads bytes to S3. */
export function createAttachment(
  txnId: string,
  body: CreateAttachmentRequest,
): Promise<CreateAttachmentResponse> {
  return apiFetch<CreateAttachmentResponse>(
    `/transactions/${encodeURIComponent(txnId)}/attachments`,
    { method: 'POST', body },
  );
}

export function listAttachments(
  txnId: string,
  signal?: AbortSignal,
): Promise<ListAttachmentsResponse> {
  return apiFetch<ListAttachmentsResponse>(
    `/transactions/${encodeURIComponent(txnId)}/attachments`,
    { signal },
  );
}

/** Returns a short-lived presigned GET URL, not the bytes themselves. */
export function getAttachmentDownload(
  txnId: string,
  attachId: string,
  signal?: AbortSignal,
): Promise<GetAttachmentDownloadResponse> {
  return apiFetch<GetAttachmentDownloadResponse>(
    `/transactions/${encodeURIComponent(txnId)}/attachments/${encodeURIComponent(attachId)}`,
    { signal },
  );
}

export function deleteAttachment(txnId: string, attachId: string): Promise<void> {
  return apiFetch<void>(
    `/transactions/${encodeURIComponent(txnId)}/attachments/${encodeURIComponent(attachId)}`,
    { method: 'DELETE' },
  );
}

// ---------------------------------------------------------------------------
// Push token registration (P7-8; POST /devices/push-token,
// DELETE /devices/push-token/{deviceId}). DTOs come from @goldfinch/shared.
// ---------------------------------------------------------------------------

export function registerPushToken(
  body: RegisterPushTokenRequest,
): Promise<RegisterPushTokenResponse> {
  return apiFetch<RegisterPushTokenResponse>('/devices/push-token', {
    method: 'POST',
    body,
  });
}

export function unregisterPushToken(deviceId: string): Promise<void> {
  return apiFetch<void>(`/devices/push-token/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// User profile -- GET /profile, PATCH /profile. The API derives the user
// (Cognito sub) from the JWT, so no identifier is ever sent from the client.
// ---------------------------------------------------------------------------

/** 404 NOT_FOUND when the caller has no profile item yet (treat as null name). */
export function getProfile(signal?: AbortSignal): Promise<GetProfileResponse> {
  return apiFetch<GetProfileResponse>('/profile', { signal });
}

export function patchProfile(
  body: PatchProfileRequest,
): Promise<PatchProfileResponse> {
  return apiFetch<PatchProfileResponse>('/profile', { method: 'PATCH', body });
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health', { signal });
}

// ---------------------------------------------------------------------------
// Sync (bank-data freshness + on-demand run)
// ---------------------------------------------------------------------------

export function getSyncStatus(
  signal?: AbortSignal,
): Promise<SyncStatusResponse> {
  return apiFetch<SyncStatusResponse>('/sync/status', { signal });
}

export function runSync(): Promise<SyncRunResponse> {
  return apiFetch<SyncRunResponse>('/sync/run', { method: 'POST' });
}
