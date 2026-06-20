/**
 * Category reassignment mutation: PATCH /transactions/{txnId} with an
 * optimistic cache update and rollback.
 *
 * - onMutate cancels in-flight transaction queries, snapshots EVERY cached
 *   transaction list (all filter combinations and all loaded infinite pages),
 *   and patches the target transaction in place.
 * - onError restores the snapshots verbatim. A 409 VERSION_CONFLICT (someone
 *   else edited the row -- we send the optimistic-lock version) additionally
 *   invalidates so the fresh server state is refetched.
 * - onSettled invalidates transactions plus the GSI2-derived views (budgets,
 *   cashflow) so spend-by-category rollups never show a stale category.
 */
import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import type {
  IsoDate,
  PatchTransactionCategoryRequest,
  PatchTransactionCategoryResponse,
} from '@goldfinch/shared/types';

import { patchTransactionCategory } from '../../../src/api/endpoints';
import { ApiError } from '../../../src/api/errors';
import { queryKeys } from '../../../src/api/queryKeys';
import { logger } from '../../../src/lib/logger';
import { patchCachedTransaction, type TransactionListData } from '../lib/cachePatch';

export interface CategorizeTransactionVars {
  txnId: string;
  /** The transaction's current date -- the server builds the SK from it. */
  date: IsoDate;
  /**
   * Category to (re)assign. Omit for a note-only edit: the category, the
   * userCategorized flag, and the spend index are left untouched.
   */
  categoryId?: string;
  /**
   * Note text. Absent = leave unchanged; empty string = clear it. At least one
   * of categoryId or note must be present.
   */
  note?: string;
  /** Current item version; engages the server's optimistic lock (409). */
  version: number;
}

type Snapshot = Array<[QueryKey, TransactionListData | undefined]>;

export interface CategorizeContext {
  snapshot: Snapshot;
}

export function isVersionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'VERSION_CONFLICT';
}

export function useCategorizeTransaction() {
  const queryClient = useQueryClient();

  return useMutation<
    PatchTransactionCategoryResponse,
    Error,
    CategorizeTransactionVars,
    CategorizeContext
  >({
    mutationFn: (vars) => {
      // The shared request type omits version; the API accepts it as an
      // optional optimistic lock. Widen via a typed variable (no cast).
      // categoryId is only sent on a category (re)assignment, so a note-only
      // edit reaches the server with no categoryId and leaves it untouched.
      const body: PatchTransactionCategoryRequest & { version: number } = {
        date: vars.date,
        version: vars.version,
        ...(vars.categoryId !== undefined ? { categoryId: vars.categoryId } : {}),
        ...(vars.note !== undefined ? { note: vars.note } : {}),
      };
      return patchTransactionCategory(vars.txnId, body);
    },

    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.transactions.all() });
      const snapshot: Snapshot = queryClient.getQueriesData<TransactionListData>({
        queryKey: queryKeys.transactions.all(),
      });
      for (const [key, data] of snapshot) {
        if (!data) continue;
        queryClient.setQueryData<TransactionListData>(
          key,
          patchCachedTransaction(data, vars),
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
      // The optimistic update is rolled back; the failure itself must still
      // be visible somewhere (P7-10) -- callers surface mutation.isError.
      logger.warn('transaction categorization failed; optimistic update rolled back', {
        txnId: vars.txnId,
        categoryId: vars.categoryId,
        error,
      });
      if (isVersionConflict(error)) {
        // Someone else already edited this transaction; pull server truth.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.transactions.all(),
        });
      }
    },

    onSuccess: (response) => {
      // Write the canonical server item (authoritative version number) into
      // every cached list before the background invalidation lands.
      const item = response.item;
      const entries = queryClient.getQueriesData<TransactionListData>({
        queryKey: queryKeys.transactions.all(),
      });
      for (const [key, data] of entries) {
        if (!data) continue;
        queryClient.setQueryData<TransactionListData>(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((txn) =>
              txn.txnId === item.txnId ? item : txn,
            ),
          })),
        });
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.transactions.all(),
      });
      // Category moved GSI2 partitions server-side; refresh derived rollups.
      void queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all() });
      void queryClient.invalidateQueries({
        queryKey: [...queryKeys.root, 'cashflow'],
      });
    },
  });
}
