/**
 * Recent-transaction sample for the live rule preview: one page (the server
 * max of 100 rows) of the last 90 days, newest first, via the shared
 * transactions endpoint and key factory. The window is pinned at mount so
 * the query key stays stable across a midnight rollover.
 *
 * The key lives under queryKeys.transactions.*, so useApplyRule's
 * transactions invalidation refreshes the preview sample automatically
 * after an apply-now recategorizes rows.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { listTransactions } from '../../../src/api/endpoints';
import {
  queryKeys,
  type TransactionListFilters,
} from '../../../src/api/queryKeys';
import { isoDateDaysAgo, toIsoDate } from '../../../src/lib/dates';

export const PREVIEW_WINDOW_DAYS = 90;
/** Server page-size cap; the preview uses a single page. */
export const PREVIEW_SAMPLE_LIMIT = 100;

export function useRecentTransactionsQuery() {
  const [filters] = useState<TransactionListFilters>(() => ({
    from: isoDateDaysAgo(PREVIEW_WINDOW_DAYS),
    to: toIsoDate(new Date()),
    limit: PREVIEW_SAMPLE_LIMIT,
  }));

  return useQuery({
    queryKey: queryKeys.transactions.list(filters),
    queryFn: ({ signal }) => listTransactions(filters, signal),
    select: (response) => response.items,
  });
}
