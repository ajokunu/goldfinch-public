/**
 * Dashboard query hooks -- the three independent reads behind the screen
 * (master plan section 13 decision 2): summary, accounts, recent
 * transactions. Each card renders its own loading/empty/error state, so one
 * slow or failed call degrades only its card.
 *
 * Keys come exclusively from src/api/queryKeys.ts so the rest of the app
 * (sync-driven invalidation, pull-to-refresh, sign-out cache clear) stays
 * coherent. Endpoint functions come from src/api/endpoints.ts.
 */
import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  BudgetPeriod,
  ListAccountsResponse,
  ListTransactionsResponse,
  SummaryResponse,
} from '@goldfinch/shared/types';
import { periodWindow } from '@goldfinch/shared/periodWindow';

import { getSummary, listAccounts, listTransactions } from '../../src/api/endpoints';
import { queryKeys, type TransactionListFilters } from '../../src/api/queryKeys';

/**
 * Dashboard data changes once a day via the sync Lambda, so these queries use
 * a staleTime well above the shell's 30s default. Pull-to-refresh and the
 * sync-advance invalidation in index.tsx are the deliberate refresh paths.
 */
export const DASHBOARD_STALE_TIME_MS = 5 * 60_000;

/** Row cap for the recent-activity card (master plan section 13). */
export const RECENT_TRANSACTIONS_LIMIT = 15;

/**
 * Dashboard spending/recent scope (P11-5): This Week / This Month. Mapped onto
 * the shared BudgetPeriod so the recent slice and the spending figure resolve
 * through the SAME `periodWindow` the Activity scope and budgets use.
 */
export type PeriodScope = 'weekly' | 'monthly';

/** Default scope (P11-5): This Month preserves the pre-P11 card behavior. */
export const DEFAULT_PERIOD_SCOPE: PeriodScope = 'monthly';

/**
 * Filters for the dashboard's recent slice (also its query-key identity),
 * scoped to the selected period via the shared `periodWindow` (DEFAULT_TZ
 * calendar) so the same window drives the recent list and the spending figure.
 */
export function recentTransactionFilters(
  scope: PeriodScope = DEFAULT_PERIOD_SCOPE,
  now: Date = new Date(),
): TransactionListFilters {
  const { from, to } = periodWindow(scope satisfies BudgetPeriod, now);
  return {
    from,
    to,
    limit: RECENT_TRANSACTIONS_LIMIT,
  };
}

/** GET /summary -- server-computed net worth + grouped balances. */
export function useSummary(): UseQueryResult<SummaryResponse> {
  return useQuery({
    queryKey: queryKeys.summary(),
    queryFn: ({ signal }) => getSummary(signal),
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

/** GET /accounts -- powers the empty state and the account-name lookup. */
export function useAccounts(): UseQueryResult<ListAccountsResponse> {
  return useQuery({
    queryKey: queryKeys.accounts.all(),
    queryFn: ({ signal }) => listAccounts(signal),
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

/**
 * GET /transactions -- newest-first recent slice (server sorts descending),
 * scoped to the selected period (P11-5). Changing the scope rebuilds the
 * filters and lands a fresh key, so the recent list re-scopes immediately.
 */
export function useRecentTransactions(
  scope: PeriodScope = DEFAULT_PERIOD_SCOPE,
): UseQueryResult<ListTransactionsResponse> {
  // Filters are pinned per scope; the date strings only change at local
  // midnight, and the next mount/focus refetch picks the new window up.
  const filters = useMemo(() => recentTransactionFilters(scope), [scope]);
  return useQuery({
    queryKey: queryKeys.transactions.list(filters),
    queryFn: ({ signal }) => listTransactions(filters, signal),
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}

/**
 * The page size for the weekly spending sum (P11-5). The weekly figure is
 * derived from the periodWindow-scoped transactions because there is no weekly
 * flow route; a single week of two-user activity fits one page comfortably, so
 * one uncapped page (server max) yields a complete sum without paginating.
 */
export const WINDOW_SPEND_PAGE_LIMIT = 200;

/** Filters for the windowed spending sum (also its query-key identity). */
export function windowSpendFilters(
  scope: PeriodScope,
  now: Date = new Date(),
): TransactionListFilters {
  const { from, to } = periodWindow(scope satisfies BudgetPeriod, now);
  return { from, to, limit: WINDOW_SPEND_PAGE_LIMIT };
}

/**
 * GET /transactions over the selected period window, for the dashboard's
 * This Week spending figure (P11-5). Distinct key from the recent slice (a
 * larger page, no display cap) so the sum is complete; reuses the same
 * endpoint and key factory so sync/refresh invalidation stays coherent.
 */
export function useWindowTransactions(
  scope: PeriodScope,
): UseQueryResult<ListTransactionsResponse> {
  const filters = useMemo(() => windowSpendFilters(scope), [scope]);
  return useQuery({
    queryKey: queryKeys.transactions.list(filters),
    queryFn: ({ signal }) => listTransactions(filters, signal),
    staleTime: DASHBOARD_STALE_TIME_MS,
  });
}
