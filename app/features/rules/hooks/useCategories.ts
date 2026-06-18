/**
 * Category lookups for the rule editor: the shared categories cache entry
 * (same query key the budget and transactions features use), plus the
 * picker-ready sorted view and the id -> name map for list rows.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CategoryDto, CategoryType } from '@goldfinch/shared/types';

import { listCategories } from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';

export const CATEGORY_TYPE_ORDER: readonly CategoryType[] = [
  'EXPENSE',
  'INCOME',
  'TRANSFER',
];

export const CATEGORY_TYPE_LABELS: Record<CategoryType, string> = {
  EXPENSE: 'Expenses',
  INCOME: 'Income',
  TRANSFER: 'Transfers',
};

export function useCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.categories.all(),
    queryFn: ({ signal }) => listCategories(signal),
    select: (response) => response.items,
  });
}

/** Active categories grouped by type in picker order. */
export function useActiveCategoriesByType(): ReadonlyArray<{
  type: CategoryType;
  categories: CategoryDto[];
}> {
  const { data } = useCategoriesQuery();
  return useMemo(() => {
    const active = (data ?? []).filter((category) => !category.archived);
    return CATEGORY_TYPE_ORDER.map((type) => ({
      type,
      categories: active
        .filter((category) => category.type === type)
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder ||
            (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
        ),
    })).filter((group) => group.categories.length > 0);
  }, [data]);
}

/** categoryId -> display name (archived included so old rules still label). */
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

/** A category's user-chosen presentation keys (P10), absent = auto behavior. */
export interface CategoryStyle {
  iconKey?: string;
  color?: string;
}

/**
 * categoryId -> chosen icon/color keys (P10). Lets a rule row render its
 * assigned category's picked glyph + swatch even though `RuleDto` carries only
 * the categoryId (the fields live on `CategoryDto`, not denormalized onto
 * rules). Archived included so a rule on an archived category still styles.
 */
export function useCategoryStyleById(): ReadonlyMap<string, CategoryStyle> {
  const { data } = useCategoriesQuery();
  return useMemo(() => {
    const map = new Map<string, CategoryStyle>();
    for (const category of data ?? []) {
      map.set(category.categoryId, {
        iconKey: category.iconKey,
        color: category.color,
      });
    }
    return map;
  }, [data]);
}
