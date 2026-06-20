/**
 * Pure cache-patch logic for the category/note reassignment mutation
 * (hooks/useCategorizeTransaction.ts onMutate optimistic update). Extracted
 * here so it can be unit-tested with node --test / StrykerJS: the hook itself
 * pulls react-query and the RN/Expo endpoints layer at runtime, which a node
 * test harness cannot load.
 *
 * Pure module: every import is `import type`, so the emitted cachePatch.js has
 * zero runtime requires. Keep it that way -- a value import would drag
 * react-query/RN into the node harness and defeat the extract.
 */
import type { InfiniteData } from '@tanstack/react-query';
import type { ListTransactionsResponse, TransactionDto } from '@goldfinch/shared/types';

/** Shape of a cached infinite transaction list (one filter combination). */
export type TransactionListData = InfiniteData<ListTransactionsResponse, string | undefined>;

/**
 * The only fields patchCachedTransaction reads. CategorizeTransactionVars (the
 * hook's mutation vars) is a structural superset, so the hook's existing call
 * still typechecks against this narrower input -- and the lib never imports
 * back from the hook (no hook->lib->hook cycle).
 */
export interface CachePatchVars {
  txnId: string;
  categoryId?: string;
  note?: string;
}

export function patchCachedTransaction(
  data: TransactionListData,
  vars: CachePatchVars,
): TransactionListData {
  return {
    ...data,
    pages: data.pages.map((page) => {
      if (!page.items.some((txn) => txn.txnId === vars.txnId)) return page;
      return {
        ...page,
        items: page.items.map((txn): TransactionDto => {
          if (txn.txnId !== vars.txnId) return txn;
          return {
            ...txn,
            // Category fields only move on a category (re)assignment; a
            // note-only edit must NOT flip an uncategorized row to categorized
            // in the cache.
            ...(vars.categoryId !== undefined
              ? {
                  categoryId: vars.categoryId,
                  userCategorized: true,
                  categorizedBy: 'user' as const,
                }
              : {}),
            note: vars.note !== undefined ? vars.note : txn.note,
            version: txn.version + 1,
          };
        }),
      };
    }),
  };
}
