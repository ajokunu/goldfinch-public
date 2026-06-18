/**
 * Goals query hooks (P7-2). Keys come exclusively from src/api/queryKeys.ts
 * so the shared mutation hooks' invalidation sets (src/api/mutations.ts)
 * land on these caches; endpoint functions come from src/api/endpoints.ts.
 *
 * The accounts list powers the linked-account picker and the "Linked to ..."
 * labels; it shares the dashboard's cache entry (queryKeys.accounts.all()).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  ListAccountsResponse,
  ListGoalsResponse,
} from '@goldfinch/shared/types';

import { listAccounts, listGoals } from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';

/**
 * Goal progress moves once a day (linked balances via sync) or via this
 * screen's own mutations (which invalidate); a long staleTime avoids refetch
 * churn while keeping pull-in on focus after invalidation.
 */
export const GOALS_STALE_TIME_MS = 5 * 60_000;

/** GET /goals -- list with server-computed progress and percentComplete. */
export function useGoalsQuery(): UseQueryResult<ListGoalsResponse> {
  return useQuery({
    queryKey: queryKeys.goals.all(),
    queryFn: ({ signal }) => listGoals(signal),
    staleTime: GOALS_STALE_TIME_MS,
  });
}

/** GET /accounts -- for the linked-account picker and linked-goal labels. */
export function useAccountsQuery(): UseQueryResult<ListAccountsResponse> {
  return useQuery({
    queryKey: queryKeys.accounts.all(),
    queryFn: ({ signal }) => listAccounts(signal),
    staleTime: GOALS_STALE_TIME_MS,
  });
}
