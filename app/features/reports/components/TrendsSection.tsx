/**
 * Monthly income/spend trend bars (P7-4, restyled per design-spec/screens.md
 * 4.3) over the selected trailing window, one paired-bar chart per currency
 * (P7-7: never merged) in the active direction's chart treatment. Income and
 * spending are positive magnitudes; months where a currency saw no activity
 * render as zero-height bars so every currency shares the same x axis.
 *
 * Series colors follow the kit rule (trendSeriesColors): income = pos token,
 * spend = accent -- except quant's grid variant where spend swaps to accent2.
 * Below each chart, the window totals row (Total income / Total spent /
 * Saved) carries the magnitudes as exact per-currency integer sums
 * (lib/series trendGroupTotals); the swatches double as the chart legend.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CurrencyCode, MinorUnits, TrendMonthDto } from '@goldfinch/shared/types';

import { localeTag, useLang, useT } from '../../../src/i18n';
import { BarChart, trendSeriesColors } from '../../../src/ui/charts';
import { formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { useMaskMoney } from '../../../src/state/uiStore';
import { CountUp } from '../../../src/ui/motion';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { isoMonthShortLabel } from '../../../src/lib/dates';
import { trendCurrencyGroups, trendGroupTotals } from '../lib/series';
import { CurrencyHeading } from './CurrencyHeading';

export function TrendsSection({
  months,
  animationKey,
}: {
  months: TrendMonthDto[];
  /** Replays the chart entrance when the window toggles. */
  animationKey: string;
}) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  // The bar chart's y-axis tick labels (formatValue), the scrubber value
  // flags, and the chart's screen-reader summary are pre-formatted money
  // strings built outside the CountUp totals cells, so privacy mode masks
  // them here.
  const { mask } = useMaskMoney();
  const groups = useMemo(() => trendCurrencyGroups(months), [months]);
  const multiCurrency = groups.length > 1;
  const colors = trendSeriesColors(theme);

  return (
    <View style={{ gap: theme.spacing.md }}>
      {groups.map((group) => {
        const totals = trendGroupTotals(group.months);
        return (
          <View key={group.currency} style={{ gap: theme.spacing.sm }}>
            {multiCurrency ? (
              <CurrencyHeading currency={group.currency} />
            ) : null}
            <BarChart
              data={group.months.map((month) => ({
                label: isoMonthShortLabel(month.month, localeTag(lang)),
                bars: [
                  { value: month.incomeMinor, color: colors.income },
                  { value: month.expenseMinor, color: colors.spend },
                ],
              }))}
              height={180}
              animationKey={animationKey}
              // Ticks are layout numbers from niceTicks; rounding to integer
              // minor units before formatting keeps the label path exact.
              formatValue={(tick) =>
                mask(formatMinorAmount(Math.round(tick), group.currency))
              }
              accessibilityLabel={`${t('Monthly trends')}, ${group.currency}: ${t('Total income')} ${mask(formatMinorAmount(totals.incomeMinor, group.currency))}, ${t('Total spent')} ${mask(formatMinorAmount(totals.expenseMinor, group.currency))}`}
              // Crosshair scrubber (P9-2 item 5): web hover and native
              // touch-drag share one ChartScrubber overlay; one flag line
              // per series, prefixed to match the legend.
              scrub
              scrubSeriesLabels={[t('Income'), t('Spent')]}
              testID={`reports-trends-chart-${group.currency}`}
            />
            <View
              style={[styles.totalsRow, { borderTopColor: theme.colors.line }]}
            >
              <TotalsCell
                label={t('Total income')}
                swatch={colors.income}
                amountMinor={totals.incomeMinor}
                currency={group.currency}
              />
              <TotalsCell
                label={t('Total spent')}
                swatch={colors.spend}
                amountMinor={totals.expenseMinor}
                currency={group.currency}
              />
              <TotalsCell
                label={t('Saved')}
                amountMinor={totals.netMinor}
                currency={group.currency}
                colorBySign
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** One totals column: optional legend swatch + eyebrow label over the sum. */
function TotalsCell({
  label,
  amountMinor,
  currency,
  swatch,
  colorBySign = false,
}: {
  label: string;
  amountMinor: MinorUnits;
  currency: CurrencyCode;
  swatch?: string;
  colorBySign?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.cell}>
      <View style={styles.cellLabelRow}>
        {swatch !== undefined ? (
          <View style={[styles.swatch, { backgroundColor: swatch }]} />
        ) : null}
        <Text
          numberOfLines={1}
          style={{
            color: theme.colors.textSecondary,
            fontSize: 11.5,
            fontFamily: theme.fonts.sans,
          }}
        >
          {label}
        </Text>
      </View>
      {/* Window-total headline (PHASE9-DECISIONS P9-2 item 4): rolling-digit
          CountUp on mount and on value change. */}
      <CountUp
        amountMinor={amountMinor}
        currency={currency}
        colorBySign={colorBySign}
        style={{
          fontSize: 16,
          fontFamily: theme.fonts.monoSet.bold,
          // The mono family IS the weight cut; never synthesize on top of a
          // loaded custom font (tokens.md 8.3).
          fontWeight: 'normal',
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  totalsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingTop: 10,
    gap: 8,
  },
  cell: { flex: 1, gap: 3 },
  cellLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
});
