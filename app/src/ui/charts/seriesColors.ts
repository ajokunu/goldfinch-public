/**
 * Income/spend series colors for the trends bar pairs (charts.md 4.4).
 *
 * Income is always the positive token. Spend is the accent, EXCEPT under the
 * quant direction's `grid` variant, where the lime accent reads as
 * "income-ish" and the prototype deliberately swaps the spend series to
 * accent2 (cyan). Kept as a tiny exported helper so the rule is testable and
 * never copy-pasted into screens. Pure module; StrykerJS scope.
 */

import { resolveChartTheme, type ChartThemeSource } from './chartTheme';

export interface TrendSeriesColors {
  income: string;
  spend: string;
}

export function trendSeriesColors(theme: ChartThemeSource): TrendSeriesColors {
  const resolved = resolveChartTheme(theme);
  return {
    income: resolved.positive,
    spend: resolved.variant === 'grid' ? resolved.accent2 : resolved.accent,
  };
}
