/**
 * Small lookup queries the transactions feature needs alongside the list:
 * accounts (for the account filter + row labels) and categories (for the
 * category chip labels + the reassignment picker).
 *
 * Both use the shared query-key factory so the accounts/budget features and
 * this one share a single cache entry per resource.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AccountDto, CategoryDto } from '@goldfinch/shared/types';

import { listAccounts, listCategories } from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';

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

/** Active (non-archived) categories sorted for picker display. */
export function useActiveCategories(): CategoryDto[] {
  const { data } = useCategoriesQuery();
  return useMemo(() => {
    if (!data) return [];
    return data
      .filter((category) => !category.archived)
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      );
  }, [data]);
}

/** categoryId -> display name (archived included so old rows still label). */
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

/** accountId -> account (for filter labels and row subtitles). */
export function useAccountsById(): ReadonlyMap<string, AccountDto> {
  const { data } = useAccountsQuery();
  return useMemo(() => {
    const map = new Map<string, AccountDto>();
    for (const account of data ?? []) {
      map.set(account.accountId, account);
    }
    return map;
  }, [data]);
}
