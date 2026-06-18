/**
 * Infinite transaction list query.
 *
 * - queryKey comes from the shared factory (queryKeys.transactions.list);
 *   the cursor is the page param, never part of the key.
 * - getNextPageParam returns the server's opaque nextCursor; an absent/null
 *   cursor is the ONLY end-of-list signal (never items.length < limit --
 *   filter expressions legally return short pages with more data behind).
 * - listTransactions() routes to /accounts/{id}/transactions automatically
 *   when filters.accountId is set (GSI1 on the server).
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import type { ListTransactionsResponse } from '@goldfinch/shared/types';

import { listTransactions } from '../../../src/api/endpoints';
import { queryKeys, type TransactionListFilters } from '../../../src/api/queryKeys';

export function useTransactionsQuery(filters: TransactionListFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.transactions.list(filters),
    queryFn: ({ pageParam, signal }) =>
      listTransactions(
        pageParam === undefined ? filters : { ...filters, cursor: pageParam },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: ListTransactionsResponse) =>
      lastPage.nextCursor ?? undefined,
  });
}
