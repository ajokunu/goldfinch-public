/**
 * Read hooks for the budgeting feature. All keys come from the shell's
 * query-key factory so invalidation stays coherent with the transactions and
 * dashboard parts; all fetches go through src/api/endpoints.ts.
 */
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { IsoMonth, TransactionDto } from '@goldfinch/shared/types';

import {
  getCashflow,
  listBudgets,
  listCategories,
  listTransactions,
} from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';
import { monthDateRange } from '../../../src/lib/dates';

export function useCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.categories.all(),
    queryFn: ({ signal }) => listCategories(signal),
  });
}

export function useBudgetsQuery() {
  return useQuery({
    queryKey: queryKeys.budgets.all(),
    queryFn: ({ signal }) => listBudgets(signal),
  });
}

/** Inclusive yyyy-mm range; pass the same month twice for a single month. */
export function useCashflowQuery(from: IsoMonth, to: IsoMonth) {
  return useQuery({
    queryKey: queryKeys.cashflow.range(from, to),
    queryFn: ({ signal }) => getCashflow({ from, to }, signal),
  });
}

/** Page size for month drill-downs; max the API allows, fewest round trips. */
const MONTH_PAGE_LIMIT = 100;

/**
 * All transactions of one calendar month, paged on the server cursor and
 * flattened. Used by the recategorize drill-down; the per-category filter is
 * applied client-side (the list API has no category filter) -- at household
 * volume a month is at most a few pages.
 */
export function useMonthTransactions(month: IsoMonth, enabled = true) {
  const { from, to } = monthDateRange(month);
  const query = useInfiniteQuery({
    queryKey: queryKeys.transactions.list({ from, to, limit: MONTH_PAGE_LIMIT }),
    queryFn: ({ pageParam, signal }) =>
      listTransactions(
        pageParam
          ? { from, to, limit: MONTH_PAGE_LIMIT, cursor: pageParam }
          : { from, to, limit: MONTH_PAGE_LIMIT },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    // Done is signalled ONLY by an absent nextCursor (shell contract).
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  });

  const transactions: TransactionDto[] = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  return { ...query, transactions };
}
