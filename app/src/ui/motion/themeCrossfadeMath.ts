/**
 * Pure helpers for the theme crossfade (PHASE9-DECISIONS P9-2 item 8): the
 * web implementation animates the full palette by injecting a temporary
 * stylesheet that transitions every color-bearing CSS property while the
 * theme flips underneath it. Building that stylesheet text is pure string
 * math, so it lives here.
 *
 * No react-native / reanimated imports -- node:test target alongside
 * motionMath (src/ui/tsconfig.test.json).
 */

/**
 * The color-bearing properties the web palette transition covers. Layout
 * properties (radius, padding, fonts) deliberately snap: P9-2 item 8 is a
 * PALETTE interpolation, and transitioning layout would force continuous
 * reflow. box-shadow is also excluded -- shadow paints are too expensive to
 * re-rasterize per frame across the whole document.
 */
export const THEME_TRANSITION_PROPERTIES: readonly string[] = [
  'color',
  'background-color',
  'border-color',
  'outline-color',
  'fill',
  'stroke',
];

/**
 * Stylesheet text for one palette transition window: every element (and
 * pseudo-element) transitions the color properties for `durationMs` on the
 * given cubic-bezier. `!important` is deliberate -- the rule must win over
 * any component-level transition for the duration of the swap, and the
 * stylesheet is removed right after the window closes.
 *
 * Junk durations (NaN / non-finite / <= 0 after rounding) return '' so a
 * disabled transition can never inject a rule that animates at 0ms forever.
 */
export function themeTransitionCss(
  durationMs: number,
  bezier: readonly [number, number, number, number],
): string {
  const ms = Number.isFinite(durationMs) ? Math.round(durationMs) : 0;
  if (ms <= 0) return '';
  const easing = `cubic-bezier(${bezier.join(', ')})`;
  const transition = THEME_TRANSITION_PROPERTIES.map(
    (property) => `${property} ${ms}ms ${easing}`,
  ).join(', ');
  return `*, *::before, *::after { transition: ${transition} !important; }`;
}
