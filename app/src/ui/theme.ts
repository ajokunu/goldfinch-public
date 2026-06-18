/**
 * Design tokens: four theme directions (meridian / quant / studio / halo),
 * each with light + dark token sets, per ops/design-spec/tokens.md and the
 * component-kit contract (ops/design-spec/components.md section 2). Feature
 * parts consume these via useTheme(); no hard-coded colors in screens.
 *
 * The theme engine landed: data and pure resolvers live in ./themeResolve
 * (zero-import module so it is node --test- and StrykerJS-testable); this
 * file is the stable import surface plus pre-redesign aliases. The token
 * vocabulary the kit compiles against is unchanged: direction-dependent
 * structural variants (token/chip/sheet radii, segmented active treatment,
 * density) are theme FIELDS so components never branch on a direction at
 * call sites; keyed category reads go through `theme.cats`, the chart kit's
 * ordered series through `colors.categories` / `colors.categoryOther`.
 */
import {
  resolveTheme,
  type CategoryPalette,
  type GFTheme,
  type ThemeMode,
} from './themeResolve';

export * from './themeResolve';

/** @deprecated pre-redesign name; use GFTheme. */
export type Theme = GFTheme;

/** @deprecated pre-redesign name; use ThemeMode. */
export type ColorSchemeName = ThemeMode;

/** Component-kit name for the keyed category palette type. */
export type CategoryColors = CategoryPalette;

/**
 * @deprecated pre-redesign single-scheme themes; these are the meridian
 * (default direction) themes. Use useTheme() / resolveTheme() instead.
 */
export const lightTheme: Theme = resolveTheme('meridian', 'light');
/** @deprecated see lightTheme. */
export const darkTheme: Theme = resolveTheme('meridian', 'dark');
