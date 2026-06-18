/**
 * Category grouping helpers. The API exposes groups only as a free-form
 * groupId attribute on each category (no group entities/endpoints), so the
 * client derives display sections from the ids: group by groupId, prettify
 * the slug for the header, order by member sortOrder.
 */
import type { CategoryDto, CategoryType } from '@goldfinch/shared/types';

export const UNGROUPED_KEY = '__ungrouped__';

/** "food-dining" / "food_dining" -> "Food Dining". */
export function groupLabel(groupId: string | null | undefined): string {
  if (!groupId) return 'Other';
  const words = groupId
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return 'Other';
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const CATEGORY_TYPE_LABELS: Record<CategoryType, string> = {
  INCOME: 'Income',
  EXPENSE: 'Expense',
  TRANSFER: 'Transfer',
};

export interface CategorySection {
  /** groupId, or UNGROUPED_KEY for categories without a group. */
  key: string;
  label: string;
  categories: CategoryDto[];
}

function bySortOrderThenName(a: CategoryDto, b: CategoryDto): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name);
}

/**
 * Build display sections from a flat category list. Sections are ordered by
 * the minimum sortOrder of their members (the seed data encodes group order
 * this way); the ungrouped bucket always sorts last.
 */
export function groupCategories(categories: CategoryDto[]): CategorySection[] {
  const buckets = new Map<string, CategoryDto[]>();
  for (const category of categories) {
    const key = category.groupId ?? UNGROUPED_KEY;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(category);
    } else {
      buckets.set(key, [category]);
    }
  }

  const sections: CategorySection[] = [];
  for (const [key, members] of buckets) {
    members.sort(bySortOrderThenName);
    sections.push({
      key,
      label: key === UNGROUPED_KEY ? 'Other' : groupLabel(key),
      categories: members,
    });
  }

  sections.sort((a, b) => {
    if (a.key === UNGROUPED_KEY) return 1;
    if (b.key === UNGROUPED_KEY) return -1;
    const aMin = a.categories[0]?.sortOrder ?? 0;
    const bMin = b.categories[0]?.sortOrder ?? 0;
    if (aMin !== bMin) return aMin - bMin;
    return a.label.localeCompare(b.label);
  });
  return sections;
}

/** Distinct, sorted list of existing group ids (for the editor's chips). */
export function distinctGroupIds(categories: CategoryDto[]): string[] {
  const ids = new Set<string>();
  for (const category of categories) {
    if (category.groupId) ids.add(category.groupId);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}
