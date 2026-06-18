/**
 * Deterministic presentation-only category coloring (charts.md 1.3).
 *
 * CategoryDto has no color field and the data layer is untouchable, so
 * colors are assigned client-side from a stable non-crypto hash of the
 * category id: djb2 over UTF-16 code units, unsigned, modulo the palette
 * length. Guaranteed properties (unit + mutation tested):
 *
 * - same id -> same color across screens and sessions within a direction;
 * - no dependence on list order, so a renamed or newly archived category
 *   never recolors its neighbors.
 *
 * Synthetic nodes never use the palette: consumers map "Other" to
 * `categoryOther` and "Unallocated" to `border` (FlowSection semantics).
 * Pure module; StrykerJS mutation-testing scope.
 */

export function categoryColor(
  categoryId: string,
  palette: readonly string[],
): string {
  if (palette.length === 0) {
    throw new RangeError('categoryColor requires a non-empty palette');
  }
  // djb2: hash = hash * 33 + code, kept in 32-bit space via Math.imul.
  let hash = 5381;
  for (let i = 0; i < categoryId.length; i += 1) {
    hash = (Math.imul(hash, 33) + categoryId.charCodeAt(i)) | 0;
  }
  const index = (hash >>> 0) % palette.length;
  return palette[index] as string;
}
