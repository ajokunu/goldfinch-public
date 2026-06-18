/**
 * Feature-local parameterized strings for the Reports screen (shell.md 8.3
 * pattern: Korean word order and particles forbid concatenating t()
 * fragments, so templated sentences are typed pure functions).
 *
 * These live here rather than in app/src/i18n/messages.ts because they are
 * reports-only compositions; the static vocabulary they reuse ("YTD" ->
 * '연초 대비') matches the shared table. Korean copy follows the table's
 * convention for spec-introduced strings: proposed, flagged for
 * native-speaker review before release.
 *
 * Arguments are pre-formatted display strings (month labels from
 * isoMonthLabel with the active localeTag; percent labels from
 * lib/series netWorthChange; date labels from formatTxnDate). These
 * functions never format money or dates themselves.
 */
import type { Lang } from '../../../src/i18n/strings';

/** Flow-card title: "Where June 2026 went" / "2026년 6월 지출 내역". */
export function whereMonthWent(lang: Lang, monthLabel: string): string {
  return lang === 'ko' ? `${monthLabel} 지출 내역` : `Where ${monthLabel} went`;
}

/**
 * Net-worth change pill (screens.md 4.2 honesty rule): "+9.0% YTD" when a
 * snapshot at or before Jan 1 exists, otherwise "+4.2% since Mar 12".
 * `baselineDateLabel` is required for (and only used by) the 'since' form.
 */
export function netWorthChangeLabel(
  lang: Lang,
  pctLabel: string,
  kind: 'ytd' | 'since',
  baselineDateLabel: string,
): string {
  if (kind === 'ytd') {
    return lang === 'ko' ? `연초 대비 ${pctLabel}` : `${pctLabel} YTD`;
  }
  return lang === 'ko'
    ? `${baselineDateLabel} 이후 ${pctLabel}`
    : `${pctLabel} since ${baselineDateLabel}`;
}
