/**
 * Category GLYPH precedence (ops/PHASE10-DECISIONS.md P10-4), the app side of
 * the icon contract whose key-level half lives in
 * `@goldfinch/shared/categoryStyle` (`GLYPH_KEYS` / `isGlyphKey` /
 * `ICON_PRECEDENCE_DOC`). One pure, unit-tested helper, consumed by both
 * `CategoryIcon` and `CategoryGlyph` so the rule has a SINGLE source:
 *
 *   user `iconKey` (if set + a valid GLYPH_KEYS member) ELSE the existing
 *   keyword/slug fallback (`resolveCategoryIcon`).
 *
 * The shared layer deliberately owns only the KEY contract (its fallback
 * returns a phosphor component, which must not exist in the platform-neutral
 * package); this module composes the two halves. An absent or unknown
 * `iconKey` degrades cleanly to today's auto behavior — never a blank well —
 * so every pre-Phase-10 category renders unchanged.
 */
import { isGlyphKey } from '@goldfinch/shared/categoryStyle';

import { resolveCategoryIcon } from './categoryIconMap';
import { GLYPH_MAP, type PhosphorIcon } from './glyphs';

/**
 * Resolve the identity glyph for a category honoring an explicit `iconKey`
 * first, then the keyword/slug fallback. PURE: no react, no theme — keyword
 * resolution and the GLYPH_MAP lookup are both data-only, so the precedence is
 * unit-testable in isolation (P10-4/P10-6 bar).
 *
 * @param iconKey      the user's chosen curated glyph key, or null/undefined
 * @param categoryId   stable category id (a name slug) for the fallback pass
 * @param categoryName display name; the fallback's second-chance resolution
 */
export function resolveCategoryGlyph(
  iconKey: string | null | undefined,
  categoryId?: string | null,
  categoryName?: string | null,
): PhosphorIcon {
  if (isGlyphKey(iconKey)) {
    return GLYPH_MAP[iconKey].glyph;
  }
  return resolveCategoryIcon(categoryId, categoryName);
}
