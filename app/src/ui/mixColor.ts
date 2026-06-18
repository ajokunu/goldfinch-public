/**
 * Pure color-mix helpers replacing the prototype's CSS
 * `color-mix(in srgb, X N%, Y)` (design-spec components.md section 2).
 *
 * Pure logic, no imports: this module is a StrykerJS mutation-testing target
 * (DESIGN-INTEGRATION-DECISIONS item 6).
 */

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(color: string): Rgb | null {
  const value = color.trim();
  if (!HEX_RE.test(value)) return null;
  let hex = value.slice(1);
  if (hex.length === 3) {
    hex = `${hex.charAt(0)}${hex.charAt(0)}${hex.charAt(1)}${hex.charAt(1)}${hex.charAt(2)}${hex.charAt(2)}`;
  }
  // 8-digit hex carries alpha in the last two digits; the blend is
  // alpha-free by spec, so the alpha component is ignored.
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function toHex2(value: number): string {
  return value.toString(16).padStart(2, '0');
}

/**
 * Linear srgb blend of two hex colors: `pct` of `fg` over `(1 - pct)` of
 * `bg`. Output is always an opaque 6-digit hex string.
 *
 * Defensive on malformed input (category colors can arrive from live data):
 * an unparsable `fg` falls back to `bg`, an unparsable `bg` falls back to
 * `fg`; both unparsable returns `fg` verbatim. Never throws.
 */
export function mixColor(fg: string, pct: number, bg: string): string {
  const fore = parseHex(fg);
  const back = parseHex(bg);
  if (!fore && !back) return fg;
  if (!fore) return bg;
  if (!back) return fg;
  const p = clamp01(pct);
  const blend = (a: number, b: number): number => Math.round(a * p + b * (1 - p));
  return `#${toHex2(blend(fore.r, back.r))}${toHex2(blend(fore.g, back.g))}${toHex2(blend(fore.b, back.b))}`;
}

/**
 * Hex color at the given opacity as an `rgba(...)` string (used where the
 * prototype layers a token over an arbitrary parent, e.g. the pending badge
 * tint at 16% alpha). Falls back to the input verbatim on malformed hex.
 */
export function withAlpha(color: string, alpha: number): string {
  const parsed = parseHex(color);
  if (!parsed) return color;
  const a = clamp01(alpha);
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${a})`;
}
