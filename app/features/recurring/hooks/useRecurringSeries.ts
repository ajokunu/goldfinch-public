/**
 * The single read behind every recurring view (P7-1): GET /recurring through
 * the shared key factory, so the screen, the dashboard card, and the review
 * mutation all share one cache entry.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ListRecurringResponse } from '@goldfinch/shared/types';

import { listRecurring } from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';

/**
 * Detection runs once a day inside the sync Lambda, so this read uses the
 * same elevated staleTime as the dashboard's queries. Pull-to-refresh and the
 * review mutation's invalidation are the deliberate refresh paths.
 */
export const RECURRING_STALE_TIME_MS = 5 * 60_000;

export function useRecurringSeries(): UseQueryResult<ListRecurringResponse> {
  return useQuery({
    queryKey: queryKeys.recurring.all(),
    queryFn: ({ signal }) => listRecurring(signal),
    staleTime: RECURRING_STALE_TIME_MS,
  });
}
