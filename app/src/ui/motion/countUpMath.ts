/**
 * Pure digit-slicing logic for the CountUp rolling-digit money ticker
 * (PHASE9-DECISIONS P9-2 item 4, P9-3 "digit-roll slicing" mutation target).
 *
 * The component formats a money value with the shared formatting
 * (formatMinorAmount), then asks planColumns() how to render the formatted
 * string as a row of columns. ASCII digits become rolling columns (a 0-9
 * strip translated vertically); everything else (currency symbol, grouping
 * separators, decimal point, minus sign) renders as static glyphs.
 *
 * Columns are keyed by POSITION FROM THE RIGHT END so that value changes
 * which alter the string length ("$999.99" -> "$1,000.00") keep the cents /
 * decimal-point columns stable and let new columns enter on the left.
 *
 * No react-native / reanimated imports -- node:test + StrykerJS target.
 */

export type ColumnKind = 'digit' | 'static';

export interface CountUpColumn {
  /** Stable identity: `c{positionFromRight}` -- React key for the column. */
  key: string;
  kind: ColumnKind;
  /** The target character this column shows. */
  char: string;
  /** Target digit value for 'digit' columns; null for 'static'. */
  digit: number | null;
  /**
   * Digit the roll starts from on MOUNT: a number rolls the strip from that
   * digit to `digit`; null means the column enters in place (no roll).
   * Already-mounted columns ignore this and roll from wherever their strip
   * currently sits, which also handles interrupted rolls.
   */
  fromDigit: number | null;
  /** True when no character occupied this position in the previous value. */
  entering: boolean;
}

/** The vertical strip every rolling column renders, top to bottom. */
export const DIGIT_STRIP: readonly string[] = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
];

/** ASCII digits only: locale digits we cannot roll degrade to static glyphs. */
export function isAsciiDigit(char: string): boolean {
  return char.length === 1 && char >= '0' && char <= '9';
}

/** 0-9 for an ASCII digit character, null for anything else. */
export function digitValue(char: string): number | null {
  return isAsciiDigit(char) ? char.charCodeAt(0) - 48 : null;
}

/**
 * Plan the column row for `next`, aligned against `prev` (the previously
 * displayed formatted string, or null on first mount).
 *
 * - Equal-position digit -> digit: fromDigit = previous digit (roll).
 * - Kind change at a position (digit <-> static): fromDigit = null; the
 *   component remounts the column (different element type), so it enters in
 *   place rather than rolling through unrelated glyphs.
 * - Positions beyond the previous string: entering = true, no roll -- except
 *   on first mount with `initialFromZero` (the app-open ticker), where every
 *   digit column rolls up from 0.
 * - Positions the next string no longer covers simply drop out of the plan.
 */
export function planColumns(
  prev: string | null,
  next: string,
  initialFromZero = false,
): CountUpColumn[] {
  const nextChars = Array.from(next);
  const prevChars = prev === null ? null : Array.from(prev);
  const columns: CountUpColumn[] = [];

  for (let i = 0; i < nextChars.length; i += 1) {
    const char = nextChars[i] as string;
    const posFromRight = nextChars.length - 1 - i;
    const digit = digitValue(char);
    const kind: ColumnKind = digit === null ? 'static' : 'digit';

    const prevChar =
      prevChars === null
        ? undefined
        : prevChars[prevChars.length - 1 - posFromRight];
    const entering = prevChar === undefined;

    let fromDigit: number | null = null;
    if (digit !== null) {
      if (prevChars === null) {
        fromDigit = initialFromZero ? 0 : null;
      } else if (prevChar !== undefined) {
        fromDigit = digitValue(prevChar);
      }
    }

    columns.push({
      key: `c${posFromRight}`,
      kind,
      char,
      digit,
      fromDigit,
      entering,
    });
  }

  return columns;
}

/**
 * Vertical translation of the 0-9 strip so `digit` is visible inside a
 * window of `rowHeight`. Digits clamp to [0, 9]; junk heights read as 0.
 */
export function stripOffset(digit: number, rowHeight: number): number {
  const safeHeight =
    Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 0;
  const safeDigit = Number.isFinite(digit)
    ? Math.min(Math.max(Math.round(digit), 0), 9)
    : 0;
  return -safeDigit * safeHeight;
}

/**
 * The CountUp roll easing, kept pure so it is unit/mutation testable
 * (P9-3 "count-up easing"). The component drives Reanimated with
 * Easing.out(Easing.cubic), which is exactly this curve: 1 - (1 - t)^3.
 * Inputs clamp to [0, 1].
 */
export function easeOutCubic(t: number): number {
  const clamped = Number.isFinite(t) ? Math.min(Math.max(t, 0), 1) : 0;
  const inverted = 1 - clamped;
  return 1 - inverted * inverted * inverted;
}
