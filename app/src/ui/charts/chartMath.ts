/**
 * Pure geometry helpers for the chart primitives.
 *
 * Money rule note: chart values are plain numbers used ONLY for pixel layout
 * (scales, tick placement). They are never money arithmetic -- callers pass
 * integer minor units in and produce display labels themselves (e.g. via
 * formatMinorAmount), so no float ever becomes a stored or displayed amount.
 */

export type LinearScale = (value: number) => number;

/** Map [domainMin, domainMax] linearly onto [rangeMin, rangeMax]. */
export function createLinearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): LinearScale {
  const span = domainMax - domainMin;
  if (span === 0) {
    const mid = (rangeMin + rangeMax) / 2;
    return () => mid;
  }
  return (value: number) =>
    rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

/** Heckbert's "nice numbers": a pleasant step size near `range / slots`. */
function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  } else {
    niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  }
  return niceFraction * 10 ** exponent;
}

/**
 * Rounded tick values spanning [min, max] (inclusive of nice bounds beyond
 * them). Degenerate ranges are widened so a flat series still gets an axis.
 */
export function niceTicks(min: number, max: number, maxTicks = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
    lo -= pad;
    hi += pad;
  }
  const range = niceNum(hi - lo, false);
  const step = niceNum(range / Math.max(1, maxTicks - 1), true);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  // Guard against FP drift accumulating across additions.
  const count = Math.round((end - start) / step);
  for (let i = 0; i <= count; i += 1) {
    const value = start + i * step;
    ticks.push(Math.abs(value) < step * 1e-9 ? 0 : value);
  }
  return ticks;
}

/**
 * Indices to label on a categorical x axis: at most `maxLabels`, always
 * including the first and last category.
 */
export function sampledLabelIndexes(count: number, maxLabels = 6): Set<number> {
  const indexes = new Set<number>();
  if (count <= 0) return indexes;
  if (count <= maxLabels) {
    for (let i = 0; i < count; i += 1) indexes.add(i);
    return indexes;
  }
  const step = Math.ceil((count - 1) / (maxLabels - 1));
  for (let i = 0; i < count; i += step) indexes.add(i);
  indexes.add(count - 1);
  return indexes;
}

/**
 * Per-direction chart treatment (design-spec/charts.md section 1):
 * meridian -> area, quant -> grid, studio -> block, halo -> soft.
 */
export type ChartVariant = 'area' | 'grid' | 'block' | 'soft';

export interface ChartPoint {
  x: number;
  y: number;
}

/**
 * Safety factor applied to `polylineLength` when sizing the dash used by the
 * draw-on entrance animation (charts.md 2.3): react-native-svg exposes no
 * getTotalLength()/pathLength on native, and for the smooth (Catmull-Rom)
 * variants the true Bezier length slightly exceeds the chord length.
 * Overshooting is harmless -- the resting state is strokeDashoffset 0 with a
 * dash length >= the path length, i.e. a fully drawn line.
 */
export const CURVE_LENGTH_FACTOR = 1.08;

const fx = (value: number): string => value.toFixed(2);

/** Index access clamped to [0, length - 1]; callers guarantee length >= 1. */
function pointAt(pts: readonly ChartPoint[], index: number): ChartPoint {
  const clamped = Math.min(Math.max(index, 0), pts.length - 1);
  return pts[clamped] as ChartPoint;
}

/**
 * Catmull-Rom -> cubic Bezier smoothing, ported verbatim from the prototype's
 * smoothPath (charts.md 2.1). Coordinates are emitted with toFixed(2) (kit
 * convention; the prototype emits raw floats, which bloats the path string
 * for no visual gain). Returns '' for fewer than 2 points.
 */
export function smoothPath(pts: readonly ChartPoint[], smooth = 0.6): string {
  if (pts.length < 2) return '';
  const start = pointAt(pts, 0);
  let d = `M ${fx(start.x)} ${fx(start.y)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pointAt(pts, i - 1);
    const p1 = pointAt(pts, i);
    const p2 = pointAt(pts, i + 1);
    const p3 = pointAt(pts, i + 2);
    const c1x = p1.x + ((p2.x - p0.x) / 6) * smooth;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * smooth;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * smooth;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * smooth;
    d += ` C ${fx(c1x)} ${fx(c1y)} ${fx(c2x)} ${fx(c2y)} ${fx(p2.x)} ${fx(p2.y)}`;
  }
  return d;
}

/**
 * Straight polyline path (`M x0 y0 L x1 y1 ...`) for the grid/block variants
 * (charts.md 2.2). Returns '' for fewer than 2 points, matching smoothPath.
 */
export function linePath(pts: readonly ChartPoint[]): string {
  if (pts.length < 2) return '';
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${fx(p.x)} ${fx(p.y)}`)
    .join(' ');
}

/**
 * Total chord length over consecutive points (charts.md 2.3); the draw-on
 * animation multiplies this by CURVE_LENGTH_FACTOR.
 */
export function polylineLength(pts: readonly ChartPoint[]): number {
  let length = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1] as ChartPoint;
    const b = pts[i] as ChartPoint;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

export interface DonutSegmentGeometry {
  /** SVG strokeDasharray [visibleLength, circumference]. */
  dash: readonly [number, number];
  /** SVG strokeDashoffset (negative accumulated fraction of C). */
  offset: number;
}

/**
 * Donut segment dash geometry, ported from the prototype loop (charts.md
 * 2.4): `total = sum || 1`, per segment `len = C * frac`, visible
 * `max(len - gap, 0.5)`, offset `-acc * C`. Zero/negative amounts contribute
 * a zero-fraction segment (callers filter them; the function stays total).
 */
export function donutSegments(
  amounts: readonly number[],
  circumference: number,
  gapDegrees: number,
): DonutSegmentGeometry[] {
  const clamped = amounts.map((amount) => Math.max(0, amount));
  const total = clamped.reduce((sum, amount) => sum + amount, 0) || 1;
  const gap = (gapDegrees / 360) * circumference;
  let acc = 0;
  return clamped.map((amount) => {
    const frac = amount / total;
    const len = circumference * frac;
    const segment: DonutSegmentGeometry = {
      dash: [Math.max(len - gap, 0.5), circumference],
      offset: -acc * circumference,
    };
    acc += frac;
    return segment;
  });
}

/**
 * Progress-ring dashoffset: `C * (1 - clamp(pct, 0, 1))` (charts.md 2.5).
 * Fractions above 1 clamp to a full ring (server percentComplete semantics).
 */
export function ringDashOffset(pct: number, circumference: number): number {
  const clamped = Math.min(Math.max(pct, 0), 1);
  return circumference * (1 - clamped);
}

// ---------------------------------------------------------------------------
// Pointer interaction geometry (PHASE9-DECISIONS P9-2 items 4/5): pure
// hit-testing shared by the crosshair scrubber (web hover + native drag) and
// the donut segment swell. No money math -- indexes and angles only.
// ---------------------------------------------------------------------------

/**
 * Nearest data index for a pointer x (the crosshair scrubber's snap): `xs`
 * are the per-index pixel centers in ascending order. Returns null for empty
 * input or a non-finite pointer.
 */
export function nearestIndexForX(
  x: number,
  xs: readonly number[],
): number | null {
  if (xs.length === 0 || !Number.isFinite(x)) return null;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < xs.length; i += 1) {
    const distance = Math.abs((xs[i] as number) - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Pointer slop around the donut ring band, dp (finger-friendly on native). */
export const DONUT_HIT_SLOP = 6;

/**
 * Donut ring hit test: (dx, dy) is the pointer relative to the ring center,
 * `radius`/`strokeWidth` the stroked-circle geometry, `amounts` the same
 * positive magnitudes handed to donutSegments. Angle is measured CLOCKWISE
 * from 12 o'clock, matching the -90deg segment rotation. Pointers off the
 * band (beyond the stroke +- DONUT_HIT_SLOP) and zero totals return null.
 * Gaps between segments attribute to the segment that owns the fraction.
 */
export function donutHitSegment(
  dx: number,
  dy: number,
  radius: number,
  strokeWidth: number,
  amounts: readonly number[],
): number | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const clamped = amounts.map((amount) => Math.max(0, amount));
  const total = clamped.reduce((sum, amount) => sum + amount, 0);
  if (total <= 0) return null;
  const distance = Math.hypot(dx, dy);
  const band = strokeWidth / 2 + DONUT_HIT_SLOP;
  if (distance < radius - band || distance > radius + band) return null;
  // atan2(dx, -dy): 0 at 12 o'clock, increasing clockwise; normalize [0, 1).
  const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
  let acc = 0;
  for (let i = 0; i < clamped.length; i += 1) {
    acc += (clamped[i] as number) / total;
    if (turn < acc) return i;
  }
  // turn can graze 1.0 - epsilon past the accumulated rounding error.
  return clamped.length - 1;
}

/**
 * Mid-angle of one donut segment in radians CLOCKWISE from 12 o'clock (the
 * value-flag anchor). Null for a bad index, zero totals, or a zero-fraction
 * segment (nothing visible to anchor to).
 */
export function donutSegmentMidAngle(
  amounts: readonly number[],
  index: number,
): number | null {
  if (!Number.isInteger(index) || index < 0 || index >= amounts.length) {
    return null;
  }
  const clamped = amounts.map((amount) => Math.max(0, amount));
  const total = clamped.reduce((sum, amount) => sum + amount, 0);
  if (total <= 0) return null;
  const fraction = (clamped[index] as number) / total;
  if (fraction <= 0) return null;
  let acc = 0;
  for (let i = 0; i < index; i += 1) {
    acc += (clamped[i] as number) / total;
  }
  return (acc + fraction / 2) * 2 * Math.PI;
}
