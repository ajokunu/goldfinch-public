/**
 * The chart kit's single theme-token boundary (design-spec/charts.md 1.2).
 *
 * The kit never reads `useTheme()` fields directly; every primitive resolves
 * its tokens through `resolveChartTheme`. The resolver accepts BOTH theme
 * shapes structurally:
 *
 * - the currently shipped `Theme` (app/src/ui/theme.ts: textPrimary /
 *   textSecondary / positive / danger, no chart tokens), and
 * - the incoming extended theme from the tokens spec
 *   (ops/design-spec/tokens.md section 9: text / dim / faint / accent2 /
 *   grid / pos / neg, `cats` category palette, per-cut font sets, `chart`
 *   treatment field) as well as the charts-spec field names
 *   (`chartVariant`, `colors.categories`, `colors.categoryOther`).
 *
 * Until the extended theme lands, the documented fallback chain reproduces
 * today's rendering (grid -> border, faint -> textSecondary, system fonts),
 * so live users see no half-themed regression; once the theme ships, the
 * extended tokens win automatically with no chart-kit change. This module is
 * pure (no React/RN imports) and is in StrykerJS mutation-testing scope.
 */

import type { ChartVariant } from './chartMath';

/** Per-weight font family names (tokens.md FontCutSet, all cuts optional
 *  here except regular so partial sets still resolve). */
export interface FontCutSetLike {
  regular: string;
  medium?: string;
  semibold?: string;
  bold?: string;
  extrabold?: string;
}

/** A theme font token: a plain family string (charts.md 1.2 shape) or a
 *  per-cut set (tokens.md shape). */
export type ChartFontToken = string | FontCutSetLike;

interface CategoryPaletteLike {
  c1?: string;
  c2?: string;
  c3?: string;
  c4?: string;
  c5?: string;
  c6?: string;
  c7?: string;
  c8?: string;
  c9?: string;
  c0?: string;
  other?: string;
}

/**
 * Structural superset of every theme shape the kit can receive. The shipped
 * `Theme` and the planned extended theme are both assignable to this, so
 * `resolveChartTheme(useTheme())` compiles before and after the theme-engine
 * work lands.
 */
export interface ChartThemeSource {
  colors: {
    surface: string;
    surfaceAlt: string;
    border: string;
    accent: string;
    accent2?: string;
    grid?: string;
    faint?: string;
    text?: string;
    textPrimary?: string;
    dim?: string;
    textSecondary?: string;
    pos?: string;
    positive?: string;
    neg?: string;
    danger?: string;
    categories?: readonly string[];
    categoryOther?: string;
  };
  cats?: CategoryPaletteLike;
  fonts?: {
    display?: ChartFontToken;
    sans?: ChartFontToken;
    mono?: ChartFontToken;
    /** Per-cut sets (theme engine shape). Preferred over the single-family
     *  tokens above: loaded custom fonts must select weight via the cut
     *  family, never via fontWeight (no synthesized weights on Android). */
    displaySet?: FontCutSetLike;
    sansSet?: FontCutSetLike;
    monoSet?: FontCutSetLike;
  };
  chartVariant?: ChartVariant;
  chart?: ChartVariant;
}

/** Fully resolved tokens the chart primitives consume. */
export interface ChartTheme {
  variant: ChartVariant;
  accent: string;
  accent2: string;
  positive: string;
  negative: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  grid: string;
  text: string;
  dim: string;
  faint: string;
  categories: readonly string[];
  categoryOther: string;
  fonts: {
    display?: ChartFontToken;
    sans?: ChartFontToken;
    mono?: ChartFontToken;
  };
}

/**
 * Interim categorical palette used ONLY until the extended theme lands: the
 * meridian direction's `cats` c1..c9, c0 (tokens.md section 3), matching the
 * app's default direction. The theme's own palette supersedes this the
 * moment `colors.categories` or `cats` exists on the theme object.
 */
export const DEFAULT_CATEGORY_PALETTE: readonly string[] = [
  '#2E6E54',
  '#B07D2B',
  '#4E7A8A',
  '#9A5E7A',
  '#A65A3C',
  '#6B7A45',
  '#3E8A78',
  '#8A6BA0',
  '#5C6B8A',
  '#2E7D55',
];

/** Interim "other" color (meridian `cats.other`), same supersession rule. */
export const DEFAULT_CATEGORY_OTHER = '#8C8579';

function flattenCats(
  cats: CategoryPaletteLike | undefined,
): readonly string[] | undefined {
  if (cats === undefined) return undefined;
  // Prototype CSS-var order: --cat-c1 ... --cat-c9, --cat-c0 (charts.md 1.2).
  const ordered = [
    cats.c1,
    cats.c2,
    cats.c3,
    cats.c4,
    cats.c5,
    cats.c6,
    cats.c7,
    cats.c8,
    cats.c9,
    cats.c0,
  ].filter((color): color is string => color !== undefined);
  return ordered.length > 0 ? ordered : undefined;
}

/** Pure token resolution; see the module doc for the fallback rationale. */
export function resolveChartTheme(source: ChartThemeSource): ChartTheme {
  const c = source.colors;
  const text = c.textPrimary ?? c.text ?? c.accent;
  const dim = c.textSecondary ?? c.dim ?? text;
  const faint = c.faint ?? dim;
  return {
    variant: source.chartVariant ?? source.chart ?? 'area',
    accent: c.accent,
    accent2: c.accent2 ?? c.accent,
    positive: c.positive ?? c.pos ?? c.accent,
    negative: c.danger ?? c.neg ?? c.accent,
    surface: c.surface,
    surfaceAlt: c.surfaceAlt,
    border: c.border,
    grid: c.grid ?? c.border,
    text,
    dim,
    faint,
    categories:
      c.categories ?? flattenCats(source.cats) ?? DEFAULT_CATEGORY_PALETTE,
    categoryOther: c.categoryOther ?? source.cats?.other ?? DEFAULT_CATEGORY_OTHER,
    fonts: {
      display: source.fonts?.displaySet ?? source.fonts?.display,
      sans: source.fonts?.sansSet ?? source.fonts?.sans,
      mono: source.fonts?.monoSet ?? source.fonts?.mono,
    },
  };
}

/** Font props ready to spread onto an SVG `<Text>`. */
export interface SvgFontProps {
  fontFamily?: string;
  fontWeight?: string;
}

function pickCut(set: FontCutSetLike, weight: 400 | 600 | 700): string {
  if (weight === 700) {
    return set.bold ?? set.extrabold ?? set.semibold ?? set.regular;
  }
  if (weight === 600) {
    return set.semibold ?? set.bold ?? set.medium ?? set.regular;
  }
  return set.regular;
}

/**
 * Map a theme font token + CSS weight to SVG text props. Per-cut sets encode
 * the weight in the family name (RN custom fonts do not synthesize weights,
 * tokens.md 8.3), so no fontWeight is emitted for them; plain families and
 * the system font get an explicit fontWeight for non-regular weights.
 */
export function svgFontProps(
  token: ChartFontToken | undefined,
  weight: 400 | 600 | 700,
): SvgFontProps {
  if (token === undefined) {
    return weight === 400 ? {} : { fontWeight: String(weight) };
  }
  if (typeof token === 'string') {
    return weight === 400
      ? { fontFamily: token }
      : { fontFamily: token, fontWeight: String(weight) };
  }
  return { fontFamily: pickCut(token, weight) };
}
