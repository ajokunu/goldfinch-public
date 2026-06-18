/**
 * Confirm/ignore review mutation: PATCH /recurring/{seriesId} with an
 * optimistic cache update and rollback, following the established pattern
 * from features/transactions/hooks/useCategorizeTransaction.ts.
 *
 * - onMutate cancels in-flight recurring queries, snapshots the cached list,
 *   and flips the target series' status in place so the row moves between
 *   review sections instantly.
 * - onError restores the snapshot verbatim, logs with context, and
 *   invalidates: a 404 means the series was re-detected or removed on the
 *   server, so the next render must come from server truth (this mirrors the
 *   shared usePatchRecurring invalidation contract in src/api/mutations.ts).
 * - onSuccess writes the canonical server item into the cache; onSettled
 *   invalidates so any concurrent writer's result wins eventually.
 */
import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from '@tanstack/react-query';
import type {
  ListRecurringResponse,
  PatchRecurringRequest,
  PatchRecurringResponse,
  RecurringSeriesDto,
} from '@goldfinch/shared/types';

import { patchRecurring } from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';
import { logger } from '../../../src/lib/logger';

export interface ReviewSeriesVars {
  seriesId: string;
  status: PatchRecurringRequest['status'];
}

type Snapshot = Array<[QueryKey, ListRecurringResponse | undefined]>;

export interface ReviewSeriesContext {
  snapshot: Snapshot;
}

function patchCachedStatus(
  data: ListRecurringResponse,
  vars: ReviewSeriesVars,
): ListRecurringResponse {
  if (!data.items.some((item) => item.seriesId === vars.seriesId)) return data;
  return {
    items: data.items.map(
      (item): RecurringSeriesDto =>
        item.seriesId === vars.seriesId ? { ...item, status: vars.status } : item,
    ),
  };
}

function replaceCachedItem(
  data: ListRecurringResponse,
  fresh: RecurringSeriesDto,
): ListRecurringResponse {
  return {
    items: data.items.map((item) =>
      item.seriesId === fresh.seriesId ? fresh : item,
    ),
  };
}

export function useReviewSeries(): UseMutationResult<
  PatchRecurringResponse,
  Error,
  ReviewSeriesVars,
  ReviewSeriesContext
> {
  const queryClient = useQueryClient();

  return useMutation<
    PatchRecurringResponse,
    Error,
    ReviewSeriesVars,
    ReviewSeriesContext
  >({
    mutationFn: (vars) => patchRecurring(vars.seriesId, { status: vars.status }),

    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.recurring.all() });
      const snapshot: Snapshot = queryClient.getQueriesData<ListRecurringResponse>({
        queryKey: queryKeys.recurring.all(),
      });
      for (const [key, data] of snapshot) {
        if (!data) continue;
        queryClient.setQueryData<ListRecurringResponse>(
          key,
          patchCachedStatus(data, vars),
        );
      }
      return { snapshot };
    },

    onError: (error, vars, context) => {
      if (context) {
        for (const [key, data] of context.snapshot) {
          queryClient.setQueryData(key, data);
        }
      }
      logger.warn('recurring review action failed', {
        seriesId: vars.seriesId,
        status: vars.status,
        error,
      });
      // Re-detection/removal race: pull server truth before the next attempt.
      void queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all() });
    },

    onSuccess: (response) => {
      // Write the canonical server item into every cached list before the
      // background invalidation lands.
      const entries = queryClient.getQueriesData<ListRecurringResponse>({
        queryKey: queryKeys.recurring.all(),
      });
      for (const [key, data] of entries) {
        if (!data) continue;
        queryClient.setQueryData<ListRecurringResponse>(
          key,
          replaceCachedItem(data, response.item),
        );
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all() });
    },
  });
}
