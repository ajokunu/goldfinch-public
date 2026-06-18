/**
 * Category icon + color contract (Phase 10 — ops/PHASE10-DECISIONS.md
 * P10-1/P10-2/P10-4). This module is the SINGLE SOURCE for:
 *
 *   - the canonical category color-palette KEY set (`CATEGORY_COLOR_KEYS`) and
 *     its runtime validator (`isCategoryColorKey`);
 *   - the canonical curated glyph-key set (`GLYPH_KEYS`) and its runtime
 *     validator (`isGlyphKey`) — the CONTRACT the app's glyph module mirrors;
 *   - the color precedence helper (`resolveCategoryColorKey`).
 *
 * Why KEYS, not values:
 *   - `color` is a palette KEY ('c1'..'c0' | 'other'), never a raw hex. The key
 *     stays coherent across all four themes; the app resolves it to a live hex
 *     via `theme.cats[key]` at render. Sending a hex would freeze one theme's
 *     swatch into stored data — a contract bug, not a feature.
 *   - `iconKey` is a curated glyph key; the app's
 *     app/src/ui/icons/glyphs.ts maps each key to a phosphor-react-native
 *     duotone component (the ONLY phosphor deep-import site).
 *
 * Both fields are USER-OWNED. Categories are user-created (sync never writes
 * categories), so the server never derives or overwrites these fields; absent
 * means "today's auto behavior" (keyword-matched glyph, hashed color), which
 * keeps every pre-Phase-10 category unchanged.
 *
 * Failure paths never throw: an invalid stored/user color key degrades to the
 * deterministic hash pick and is reported through the shared logger. The
 * route-validation layer rejects unknown keys up front with a 400 using the
 * validators here — never a hand-rolled list, so request validation can never
 * drift from the sets (single-source business rule).
 */

import { createLogger, type Logger } from './logger.js';

/** Module logger used when callers do not inject their own (P10-6 bar). */
const defaultLogger: Logger = createLogger({
  base: { service: 'shared.categoryStyle' },
});

// ---------------------------------------------------------------------------
// P10-3 / P10-1 — color palette keys
// ---------------------------------------------------------------------------

/**
 * The 11 canonical category palette KEYS, in the locked prototype order
 * (c1..c9, c0, then the catch-all `other`). This MIRRORS the keys of
 * `theme.cats` / the app `CategoryPalette` interface
 * (app/src/ui/themeResolve.ts): the two MUST stay equal — a parity test pins
 * `Object.keys(theme.cats)` to this array so neither side can drift. Values
 * are resolved per-theme by the app; the contract carries only the key.
 */
export const CATEGORY_COLOR_KEYS = [
  'c1',
  'c2',
  'c3',
  'c4',
  'c5',
  'c6',
  'c7',
  'c8',
  'c9',
  'c0',
  'other',
] as const;

/** A category color key — a member of {@link CATEGORY_COLOR_KEYS}. */
export type CategoryColorKey = (typeof CATEGORY_COLOR_KEYS)[number];

/** O(1) membership set for the color-key validator. */
const COLOR_KEY_SET: ReadonlySet<string> = new Set(CATEGORY_COLOR_KEYS);

/**
 * Runtime validator for untrusted input (the POST/PATCH /categories `color`
 * field). The API leg MUST use this — not a hand-rolled list — so request
 * validation can never drift from {@link CATEGORY_COLOR_KEYS}.
 */
export function isCategoryColorKey(value: unknown): value is CategoryColorKey {
  return typeof value === 'string' && COLOR_KEY_SET.has(value);
}

// ---------------------------------------------------------------------------
// P10-2 — curated glyph keys (THE icon contract)
// ---------------------------------------------------------------------------

/**
 * The curated, finance-relevant phosphor-duotone glyph KEYS shown in the icon
 * picker (P10-2). This set IS the cross-workspace contract: the app's
 * app/src/ui/icons/glyphs.ts MUST expose a total glyph map whose keys EQUAL
 * `GLYPH_KEYS` (a parity test pins `Object.keys(GLYPH_MAP)` to this array), so
 * a `CreateCategoryRequest.iconKey` validated here resolves to a real glyph on
 * the client — never a blank well. Keys are stable kebab-case strings derived
 * from the phosphor glyph name; they are persisted in `CategoryItem.iconKey`,
 * so a key, once shipped, is permanent (add, never rename/remove).
 *
 * Composition (the union P10-2 specifies): the glyphs already mapped for the
 * 31 default categories + a spread covering common user categories
 * (coffee, gift, pet, plane, car, house, fork-knife, bag, heart, barbell,
 * book, game-controller, music, wifi, phone, wrench, baby, leaf, paw, ticket,
 * etc.). The `circle-dashed` (uncategorized) and `tag` (terminal default)
 * resolution glyphs are included so the picker can also represent those
 * states explicitly.
 */
export const GLYPH_KEYS = [
  // --- default-category identity glyphs (mirror app CATEGORY_ICONS) ---
  'money', // paycheck / income
  'hand-coins', // other income / loans
  'basket', // groceries
  'fork-knife', // dining & drinks
  'coffee', // coffee shops
  'house', // rent / mortgage / home
  'lightbulb', // utilities
  'wifi-high', // internet / phone
  'broom', // home supplies
  'gas-pump', // gas / fuel
  'car', // auto / transport
  'garage', // parking / tolls
  'bus', // rideshare / transit
  'shopping-bag', // shopping / bag
  't-shirt', // clothing
  'devices', // electronics
  'arrows-clockwise', // subscriptions
  'film-slate', // entertainment
  'airplane-tilt', // travel / plane
  'first-aid-kit', // health / medical
  'barbell', // fitness
  'scissors', // personal care
  'shield-check', // insurance
  'receipt-x', // fees & charges
  'percent', // taxes
  'gift', // gifts / donations
  'paw-print', // pets / paw
  'graduation-cap', // education
  'credit-card', // credit-card payment
  'arrows-left-right', // transfers
  'shapes', // miscellaneous
  // --- fallback-rule extras for user-created categories ---
  'baby', // kids / baby
  'chart-line-up', // savings / investing
  'music-notes', // music
  'wrench', // repairs / maintenance
  // --- resolution-terminal glyphs (also pickable states) ---
  'circle-dashed', // uncategorized bucket
  'tag', // generic / default
  // --- P10-2 common-user-category spread (new curated additions) ---
  'heart', // health / relationships / charity
  'book', // books / reading / education
  'game-controller', // gaming
  'phone', // phone / mobile
  'leaf', // nature / sustainability / yard
  'ticket', // events / tickets
  'piggy-bank', // savings goals
  'cake', // celebrations / birthdays
  'hamburger', // fast food
  'wine', // drinks / bars
] as const;

/** A curated glyph key — a member of {@link GLYPH_KEYS}. */
export type GlyphKey = (typeof GLYPH_KEYS)[number];

/** O(1) membership set for the glyph-key validator. */
const GLYPH_KEY_SET: ReadonlySet<string> = new Set(GLYPH_KEYS);

/**
 * Runtime validator for untrusted input (the POST/PATCH /categories `iconKey`
 * field). The API leg MUST use this — not a hand-rolled list — so request
 * validation can never drift from {@link GLYPH_KEYS}, and an accepted key is
 * guaranteed renderable by the app's mirrored glyph map.
 */
export function isGlyphKey(value: unknown): value is GlyphKey {
  return typeof value === 'string' && GLYPH_KEY_SET.has(value);
}

// ---------------------------------------------------------------------------
// P10-4 — rendering precedence (color)
// ---------------------------------------------------------------------------

/**
 * Stable, non-crypto deterministic index for a category id over a fixed-length
 * palette: djb2 over UTF-16 code units, unsigned, modulo `length`. This is the
 * SAME algorithm the app chart kit uses (`categoryColor`,
 * app/src/ui/charts/categoryColor.ts) — kept byte-identical so a category's
 * auto color matches its donut segment / budget bar exactly. Reused here so
 * the auto branch of {@link resolveCategoryColorKey} and the app's value-level
 * picker agree on which swatch a key-less category gets.
 *
 * Properties (mutation-tested):
 *  - same id -> same index within a fixed palette length, across sessions;
 *  - no dependence on list order, so renaming/archiving a neighbor never
 *    recolors a category.
 */
function djb2Index(categoryId: string, length: number): number {
  let hash = 5381;
  for (let i = 0; i < categoryId.length; i += 1) {
    // hash = hash * 33 + code, kept in 32-bit space via Math.imul.
    hash = (Math.imul(hash, 33) + categoryId.charCodeAt(i)) | 0;
  }
  return (hash >>> 0) % length;
}

/**
 * THE category color-key precedence (P10-4), the SOLE source consumed
 * everywhere a category renders (transactions, budgets, pickers, dashboard
 * donut + legend, recurring, rules):
 *
 *   user `color` key (if set + valid) ELSE a deterministic hash pick from
 *   {@link CATEGORY_COLOR_KEYS}.
 *
 * The hash pick is taken over the FULL key set so a key-less category gets a
 * stable, well-distributed swatch (the `other` key participates — it is a real
 * palette color, not a sentinel). Pass the SAME `categoryId` the app feeds
 * `categoryColor` so the resolved swatch is identical on both legs.
 *
 * Failure path: a present-but-invalid `userColorKey` (dirty stored data or a
 * malformed body that slipped past validation) is IGNORED with a logged
 * warning and degrades to the hash pick — it never throws inside a render or a
 * GET handler.
 *
 * @param userColorKey the user's chosen palette key, or null/undefined for none
 * @param categoryId   stable category id (a name slug); drives the hash pick
 * @returns a guaranteed member of {@link CATEGORY_COLOR_KEYS}
 */
export function resolveCategoryColorKey(
  userColorKey: string | null | undefined,
  categoryId: string,
  logger: Logger = defaultLogger,
): CategoryColorKey {
  if (userColorKey !== null && userColorKey !== undefined) {
    if (isCategoryColorKey(userColorKey)) {
      return userColorKey;
    }
    logger.warn('ignoring invalid category color key; using hash pick', {
      userColorKey,
      categoryId,
    });
  }
  return CATEGORY_COLOR_KEYS[djb2Index(categoryId, CATEGORY_COLOR_KEYS.length)]!;
}

// ---------------------------------------------------------------------------
// P10-4 — rendering precedence (icon) — app-resolved, documented here
// ---------------------------------------------------------------------------

/**
 * ICON precedence is resolved IN THE APP, not here, by deliberate design.
 *
 * The rule is `userIconKey (if set + valid) ?? keyword/slug fallback`, but the
 * keyword fallback (`resolveCategoryIcon`, app/src/ui/icons/categoryIconMap.ts)
 * returns a phosphor COMPONENT — a value that does not (and must not) exist in
 * this platform-neutral shared package. So the shared layer owns only the
 * key-level contract (`GLYPH_KEYS` + {@link isGlyphKey}); the app composes:
 *
 *   const Glyph =
 *     (iconKey && isGlyphKey(iconKey) ? GLYPH_MAP[iconKey] : undefined)
 *       ?? resolveCategoryIcon(categoryId, categoryName);
 *
 * Keeping that one branch in the app — where the glyph map lives — avoids
 * dragging a react/phosphor dependency into `@goldfinch/shared`, while the
 * validator here still guarantees any persisted `iconKey` is a real glyph.
 */
export const ICON_PRECEDENCE_DOC =
  'userIconKey (validated via isGlyphKey) ?? keyword/slug fallback — resolved in the app (needs the phosphor glyph map).';
