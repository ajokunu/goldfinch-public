/**
 * Category identity icon (ops/design-spec/icons.md section 4).
 *
 * - `CategoryIcon`: the design-system icon well -- `theme.radius.token`
 *   corner, background an 18% mix of the category accent over surface, glyph
 *   in the accent, duotone weight. Neutral mode (transfer rows, anything
 *   deliberately uncolored) renders `surfaceAlt` + `dim` instead.
 * - `CategoryGlyph`: the bare glyph for inline slots (chips, legends, budget
 *   head rows) where the caller owns the surrounding layout.
 *
 * Accent color is the deterministic chart-kit hash
 * (`categoryColor(categoryId, theme.colors.categories)`, charts.md 1.3), so
 * the icon can never disagree with the category's donut segment or budget
 * bar; the uncategorized bucket takes `theme.colors.categoryOther`.
 * Decorative by default -- the owning row carries the semantic label.
 */
import { StyleSheet, View } from 'react-native';
import { resolveCategoryColorKey } from '@goldfinch/shared/categoryStyle';

import { categoryColor } from '../charts/categoryColor';
import { logger } from '../../lib/logger';
import { mixColor } from '../mixColor';
import { useTheme } from '../ThemeProvider';
import { resolveCategoryGlyph } from './resolveCategoryGlyph';
import type { IconWeight } from './glyphs';

const log = logger.child({ ui: 'CategoryIcon' });

/** Glyph share of the well, tuned to the 18px-in-38px Tok precedent. */
const GLYPH_RATIO = 0.47;

export interface CategoryIconProps {
  /** Stable category id (a name slug); null/undefined = uncategorized. */
  categoryId: string | null | undefined;
  /** Display name; second-chance resolution for user-created categories. */
  categoryName?: string | null;
  /**
   * P10-4: user-chosen curated glyph key (a GLYPH_KEYS member). When set+valid
   * it WINS over the keyword/slug fallback; absent/unknown = today's auto glyph.
   */
  iconKey?: string | null;
  /**
   * P10-4: user-chosen palette KEY ('c1'..'c0' | 'other'), resolved to a live
   * hex via `theme.cats`. When set+valid it WINS over the deterministic hash;
   * absent/unknown = the hash pick. NOT a raw hex — see `color` for that.
   */
  colorKey?: string | null;
  /** Well edge length; default 38 (list-row token). */
  size?: number;
  /** Glyph size override; default round(size * 0.47). */
  iconSize?: number;
  /** Neutral (surfaceAlt/dim) treatment, e.g. transfer rows. */
  neutral?: boolean;
  /** Raw-hex accent override (takes precedence over colorKey + hash). */
  color?: string;
  /** Phosphor weight; identity icons default to duotone. */
  weight?: IconWeight;
}

/**
 * Resolve a category's accent (single source for color precedence at render):
 *   raw-hex `color` override ELSE user `colorKey` (resolved via `theme.cats`,
 *   honoring the shared `resolveCategoryColorKey` precedence) ELSE the
 *   deterministic chart-kit hash. The key path runs through the shared helper
 *   so the swatch a user picks here matches the API's stored key exactly; an
 *   invalid key degrades to the hash with a logged warning (never throws).
 */
function useCategoryAccent(
  categoryId: string | null | undefined,
  colorKey?: string | null,
  override?: string,
): string {
  const theme = useTheme();
  if (override) return override;
  if (categoryId) {
    if (colorKey !== null && colorKey !== undefined) {
      // Shared helper: valid key passes through, invalid degrades to its own
      // hash pick over the palette KEYS (logged); we then read the live hex.
      const resolvedKey = resolveCategoryColorKey(colorKey, categoryId, log);
      return theme.cats[resolvedKey];
    }
    return categoryColor(categoryId, theme.colors.categories);
  }
  return theme.colors.categoryOther;
}

export function CategoryIcon({
  categoryId,
  categoryName,
  iconKey,
  colorKey,
  size = 38,
  iconSize,
  neutral = false,
  color,
  weight = 'duotone',
}: CategoryIconProps) {
  const theme = useTheme();
  const Glyph = resolveCategoryGlyph(iconKey, categoryId, categoryName);
  const accent = useCategoryAccent(categoryId, colorKey, color);
  const background = neutral
    ? theme.colors.surfaceAlt
    : mixColor(accent, 0.18, theme.colors.surface);
  const foreground = neutral ? theme.colors.dim : accent;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.well,
        {
          width: size,
          height: size,
          borderRadius: theme.radius.token,
          backgroundColor: background,
        },
      ]}
    >
      <Glyph
        size={iconSize ?? Math.round(size * GLYPH_RATIO)}
        color={foreground}
        weight={weight}
      />
    </View>
  );
}

export interface CategoryGlyphProps {
  categoryId: string | null | undefined;
  categoryName?: string | null;
  /** P10-4: user-chosen curated glyph key; wins over the keyword fallback. */
  iconKey?: string | null;
  /** P10-4: user-chosen palette KEY; wins over the hash (resolved via theme.cats). */
  colorKey?: string | null;
  /** Glyph size; default 14 (chip/legend slot). */
  size?: number;
  /** Raw-hex accent override (takes precedence over colorKey + hash). */
  color?: string;
  weight?: IconWeight;
}

export function CategoryGlyph({
  categoryId,
  categoryName,
  iconKey,
  colorKey,
  size = 14,
  color,
  weight = 'duotone',
}: CategoryGlyphProps) {
  const Glyph = resolveCategoryGlyph(iconKey, categoryId, categoryName);
  const accent = useCategoryAccent(categoryId, colorKey, color);
  return <Glyph size={size} color={accent} weight={weight} />;
}

const styles = StyleSheet.create({
  well: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
