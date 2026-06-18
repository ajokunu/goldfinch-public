/**
 * Lookup queries the import wizard needs: accounts (target selection) and
 * categories (mapping raw category cells to slugs). Keys come from the
 * shell's query-key factory so this feature shares cache entries with the
 * dashboard/transactions/budget parts.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { listAccounts, listCategories } from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';
import { buildCategoryIndex } from '../lib/mapping';

export function useAccountsQuery() {
  return useQuery({
    queryKey: queryKeys.accounts.all(),
    queryFn: ({ signal }) => listAccounts(signal),
    select: (response) => response.items,
  });
}

export function useCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.categories.all(),
    queryFn: ({ signal }) => listCategories(signal),
    select: (response) => response.items,
  });
}

/** Raw category cell (lowercased) -> category slug, for prepareRows. */
export function useCategoryIndex(): ReadonlyMap<string, string> {
  const { data } = useCategoriesQuery();
  return useMemo(() => buildCategoryIndex(data ?? []), [data]);
}

/** categoryId -> display name for the mapping preview. */
export function useCategoryNames(): ReadonlyMap<string, string> {
  const { data } = useCategoriesQuery();
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const category of data ?? []) {
      map.set(category.categoryId, category.name);
    }
    return map;
  }, [data]);
}
