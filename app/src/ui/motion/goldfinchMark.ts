/**
 * The goldfinch mark silhouette as PURE PATH MATH (P9-2 item 7: the
 * pull-to-refresh indicator is a Skia path, never a decoded PNG and never a
 * Lottie dependency). The bird from assets/goldfinch-mark.png -- perched,
 * facing right, forked tail low-left -- is traced once here as scaled SVG
 * path data; the component hands the string to Skia a single time per size,
 * so nothing is decoded or rebuilt per frame.
 *
 * No react-native / skia imports -- node:test target.
 */

/**
 * Control points of the silhouette in a 100x100 box (y down), traced
 * clockwise from the beak tip: beak, crown, nape, back, forked tail (two
 * prongs with a notch), belly, chest, throat, back to the beak.
 */
const OUTLINE: ReadonlyArray<readonly number[]> = [
  [97, 33], // M: beak tip
  [84, 26], // L: top beak edge into the head
  [81, 12, 66, 6, 55, 13], // C: crown
  [49, 17, 45, 23, 44, 30], // C: back of head / nape
  [36, 32, 27, 38, 21, 47], // C: back sloping into the wing line
  [3, 62], // L: tail, upper prong tip
  [13, 63], // L: fork notch
  [7, 76], // L: tail, lower prong tip
  [20, 72, 30, 67, 37, 60], // C: under-tail back to the body
  [45, 70, 58, 74, 70, 70], // C: belly
  [80, 66, 86, 56, 87, 46], // C: chest
  [87, 42, 86, 38, 84, 35], // C: throat to the beak underside
];

/** Command letter for an outline row: 2 numbers = line, 6 = cubic. */
function command(index: number, coords: readonly number[]): string {
  if (index === 0) return 'M';
  return coords.length === 6 ? 'C' : 'L';
}

/**
 * SVG path data for the mark silhouette scaled into a size x size box.
 * Closed ('Z') so Skia can fill it as one solid shape. Junk sizes read as 0
 * (a degenerate point path -- still valid path data).
 */
export function goldfinchMarkPath(size: number): string {
  const scale = Number.isFinite(size) && size > 0 ? size / 100 : 0;
  const parts = OUTLINE.map((coords, index) => {
    const scaled = coords.map((value) => round2(value * scale)).join(' ');
    return `${command(index, coords)} ${scaled}`;
  });
  return `${parts.join(' ')} Z`;
}

/** Round to 2 decimals so path strings stay short and deterministic. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
