/**
 * Sync hooks: read the last bank-sync status and trigger an on-demand run.
 *
 * Bank-data freshness reality (verified 2026-06-11): GoldFinch pulls everything
 * SimpleFIN has, but SimpleFIN refreshes from your banks on its own cadence, so
 * "Sync now" re-pulls SimpleFIN's current data -- it does NOT force SimpleFIN to
 * re-poll the bank. When SimpleFIN itself is stale, a fresh pull from the
 * SimpleFIN Bridge portal is required. The dashboard freshness line surfaces
 * how old the bank data is so a stale feed is obvious rather than mistaken for
 * a missing transaction.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { SyncRunResponse, SyncStatusResponse } from '@goldfinch/shared/types';

import { getSyncStatus, runSync } from './endpoints';
import { logger } from '../lib/logger';
import { queryKeys } from './queryKeys';

const log = logger.child({ module: 'api.sync' });

export function useSyncStatus(): UseQueryResult<SyncStatusResponse> {
  return useQuery({
    queryKey: queryKeys.syncStatus(),
    queryFn: ({ signal }) => getSyncStatus(signal),
    staleTime: 60_000,
  });
}

/**
 * Trigger an on-demand sync. On success the bank-fed queries are invalidated so
 * any newly pulled transactions/balances appear without a manual refresh.
 */
export function useRunSync(): UseMutationResult<SyncRunResponse, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => runSync(),
    onSuccess: (result) => {
      // A debounced/in-flight refusal is a normal outcome, not an error.
      if (!result.accepted) {
        log.info('sync run not started (already running or debounced)', {
          alreadyRunning: result.alreadyRunning ?? false,
        });
        return;
      }
      // The run is async on the backend; invalidate so the next focus/refetch
      // pulls fresh data once it lands.
      void queryClient.invalidateQueries({ queryKey: queryKeys.summary() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus() });
    },
    onError: (error) => {
      log.error('on-demand sync failed to start', { error });
    },
  });
}
