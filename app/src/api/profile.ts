/**
 * Profile (display name) query + mutation hooks, shared by the dashboard
 * greeting and the Settings display-name field.
 *
 * Contract notes:
 * - GET /profile 404s when the caller has no profile item yet. Absence is
 *   DATA here, not an error: the query maps 404 to { displayName: null } so
 *   consumers fall back to the claim-derived label without surfacing an
 *   error state (and without useQuery retry noise).
 * - PATCH is optimistic: the cached profile flips to the new name
 *   immediately, rolls back on error (logged -- never silent, P7-10), and a
 *   settled invalidation reconciles with the server either way.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { PatchProfileRequest, ProfileDto } from '@goldfinch/shared/types';

import { logger } from '../lib/logger';
import { getProfile, patchProfile } from './endpoints';
import { ApiError } from './errors';
import { queryKeys } from './queryKeys';

/** Profile data changes only when one of two users edits it; cache hard. */
export const PROFILE_STALE_TIME_MS = 5 * 60_000;

export function useProfile(): UseQueryResult<ProfileDto> {
  return useQuery({
    queryKey: queryKeys.profile(),
    queryFn: async ({ signal }): Promise<ProfileDto> => {
      try {
        return await getProfile(signal);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // No profile item yet -- the user has never set a display name.
          return { displayName: null };
        }
        throw error;
      }
    },
    staleTime: PROFILE_STALE_TIME_MS,
  });
}

interface PatchProfileContext {
  previous: ProfileDto | undefined;
}

export function usePatchProfile(): UseMutationResult<
  ProfileDto,
  Error,
  PatchProfileRequest,
  PatchProfileContext
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PatchProfileRequest) => patchProfile(body),
    onMutate: async (body): Promise<PatchProfileContext> => {
      await queryClient.cancelQueries({ queryKey: queryKeys.profile() });
      const previous = queryClient.getQueryData<ProfileDto>(queryKeys.profile());
      queryClient.setQueryData<ProfileDto>(queryKeys.profile(), {
        ...(previous ?? {}),
        displayName: body.displayName.trim(),
      });
      return { previous };
    },
    onError: (error, _body, context) => {
      logger.error('display-name save failed; rolling back optimistic name', {
        error,
      });
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKeys.profile(), context.previous);
      }
    },
    // Reconcile with the server on success AND after a rollback (a 409
    // VERSION_CONFLICT means another device won; pull the winning name).
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile() });
    },
  });
}
