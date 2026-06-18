/**
 * Presentation-only category coloring for the budget feature (design spec
 * screens.md 0.3): CategoryDto carries no color, so swatches come from the
 * deterministic theme-palette hash in the chart kit. The null/undefined id
 * (the uncategorized bucket) always gets the palette's `other` slot.
 */
import { categoryColor } from '../../../src/ui/charts';
import type { GFTheme } from '../../../src/ui/theme';

export function colorForCategory(
  categoryId: string | null | undefined,
  theme: GFTheme,
): string {
  if (!categoryId) return theme.colors.categoryOther;
  return categoryColor(categoryId, theme.colors.categories);
}
