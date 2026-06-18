/**
 * Monthly cash-flow view (design spec screens.md 3.4): income vs spending as
 * a paired bar chart (shared chart kit, direction-variant treatment), the
 * Avg income / Avg spending / Net saved stat row, and the preserved
 * focused-month detail. The trailing window (3/6/12 months) ends at a
 * picker-selected month feeding the live useCashflowQuery(from, to).
 *
 * All amounts are server-computed decimal/minor pairs from GET /cashflow; the
 * only client math is integer minor-unit display averages (lib/amounts.ts).
 */
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { CashflowMonth, IsoMonth } from '@goldfinch/shared/types';

import { localeTag, useLang, useT } from '../../../src/i18n';
import { BarChart, trendSeriesColors } from '../../../src/ui/charts';
import {
  GoldfinchRefreshControl,
  GoldfinchRefreshMark,
} from '../../../src/ui/GoldfinchRefresh';
import { Card, CardHeader } from '../../../src/ui/Card';
import { formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { Money } from '../../../src/ui/Money';
import { useMaskMoney } from '../../../src/state/uiStore';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { averageMinor } from '../lib/amounts';
import {
  addIsoMonths,
  currentIsoMonth,
  isoMonthLabel,
  isoMonthShortLabel,
  listIsoMonths,
} from '../../../src/lib/dates';
import { useCashflowQuery } from '../hooks/useBudgetQueries';
import { EmptyState, ErrorState, LoadingState } from '../../../src/ui/States';
import { MonthPicker } from './MonthPicker';
import {
  FadeRise,
  stagger,
  staggerChildDelayMs,
} from '../../../src/ui/motion';
import { SegmentedTabs } from './SegmentedTabs';

const WINDOW_OPTIONS = [
  { key: '3', label: '3M' },
  { key: '6', label: '6M' },
  { key: '12', label: '1Y' },
] as const;

type WindowKey = (typeof WINDOW_OPTIONS)[number]['key'];

const CHART_HEIGHT = 176;

export function CashflowView() {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  const tag = localeTag(lang);
  // The stat cards render raw formatMinorAmount strings (visible Text +
  // accessibilityLabel); the focused-month detail rides the masked Money
  // primitive. Privacy mode masks the stat figures here.
  const { mask } = useMaskMoney();
  const thisMonth = currentIsoMonth();

  const [endMonth, setEndMonth] = useState<IsoMonth>(thisMonth);
  const [windowKey, setWindowKey] = useState<WindowKey>('6');
  const [focusedMonth, setFocusedMonth] = useState<IsoMonth>(thisMonth);

  const windowSize = Number.parseInt(windowKey, 10);
  const from = addIsoMonths(endMonth, -(windowSize - 1));
  const to = endMonth;

  const cashflowQuery = useCashflowQuery(from, to);

  // The server returns only months that exist in range; render the full
  // window so empty months show as gaps rather than disappearing.
  const monthsInWindow = useMemo(() => listIsoMonths(from, to), [from, to]);
  const byMonth = useMemo(() => {
    const map = new Map<IsoMonth, CashflowMonth>();
    for (const entry of cashflowQuery.data?.months ?? []) {
      map.set(entry.month, entry);
    }
    return map;
  }, [cashflowQuery.data]);

  const currency = cashflowQuery.data?.currency ?? 'USD';
  const totals = cashflowQuery.data?.totals;
  const monthCount = cashflowQuery.data?.months.length ?? 0;
  const focused = byMonth.get(focusedMonth);

  const handleEndMonthChange = (month: IsoMonth) => {
    setEndMonth(month);
    setFocusedMonth(month);
  };

  const series = trendSeriesColors(theme);
  const chartData = useMemo(
    () =>
      monthsInWindow.map((month) => {
        const entry = byMonth.get(month);
        return {
          label: isoMonthShortLabel(month, tag),
          bars: [
            { value: entry?.incomeMinor ?? 0, color: series.income },
            { value: entry?.expenseMinor ?? 0, color: series.spend },
          ],
        };
      }),
    [monthsInWindow, byMonth, series.income, series.spend, tag],
  );

  const windowLabel = `${isoMonthLabel(from, tag)} – ${isoMonthLabel(to, tag)}`;

  const statCards: Array<{ label: string; valueMinor: number; color: string }> =
    totals
      ? [
          {
            label: t('Avg income'),
            valueMinor: averageMinor(totals.incomeMinor, monthCount),
            color: theme.colors.pos,
          },
          {
            label: t('Avg spending'),
            valueMinor: averageMinor(totals.expenseMinor, monthCount),
            color: theme.colors.textPrimary,
          },
          {
            label: t('Net saved'),
            valueMinor: totals.netMinor,
            color: theme.colors.accent,
          },
        ]
      : [];

  return (
    <>
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: theme.density.pad,
        paddingBottom: theme.spacing.xl,
      }}
      refreshControl={
        <GoldfinchRefreshControl
          refreshing={cashflowQuery.isRefetching}
          onRefresh={() => void cashflowQuery.refetch()}
        />
      }
    >
      {/* Entrance cascade via the shared motion module (PHASE9-DECISIONS
          P9-1/P9-2 item 1). */}
      <FadeRise>
        <View style={{ marginBottom: theme.spacing.sm }}>
          <MonthPicker
            month={endMonth}
            onChange={handleEndMonthChange}
            maxMonth={thisMonth}
          />
        </View>
        <View style={{ marginBottom: theme.spacing.md }}>
          <SegmentedTabs
            options={WINDOW_OPTIONS}
            value={windowKey}
            onChange={setWindowKey}
          />
        </View>
      </FadeRise>

      {cashflowQuery.isPending ? (
        <LoadingState />
      ) : cashflowQuery.isError ? (
        <ErrorState
          message="Could not load cash flow."
          onRetry={() => void cashflowQuery.refetch()}
        />
      ) : monthCount === 0 ? (
        <EmptyState title="No activity in this window" />
      ) : (
        <>
          {/* Income vs spending: paired bars in the direction's chart
              variant; a transparent per-month overlay preserves the live
              focused-month interaction (the chart itself is decorative). */}
          <FadeRise delay={staggerChildDelayMs(1, stagger.cascadeMs)}>
            <Card style={{ marginBottom: 14 }}>
              <CardHeader
                title={t('Income vs spending')}
                right={
                  <Text
                    style={{
                      color: theme.colors.textFaint,
                      fontSize: 11,
                      fontFamily: theme.fonts.sans,
                    }}
                  >
                    {windowLabel}
                  </Text>
                }
              />
              <View>
                <BarChart
                  data={chartData}
                  height={CHART_HEIGHT}
                  animationKey={`${from}-${to}`}
                  maxXLabels={windowSize === 12 ? 6 : windowSize}
                  accessibilityLabel={`${t('Income vs spending')}: ${windowLabel}`}
                  testID="cashflow-bar-chart"
                />
                <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                  <View style={styles.chartOverlayRow}>
                    {monthsInWindow.map((month) => {
                      const isFocused = month === focusedMonth;
                      return (
                        <Pressable
                          key={month}
                          onPress={() => setFocusedMonth(month)}
                          accessibilityRole="button"
                          accessibilityLabel={`Focus ${isoMonthLabel(month, tag)}`}
                          accessibilityState={{ selected: isFocused }}
                          style={styles.chartOverlayCell}
                        />
                      );
                    })}
                  </View>
                </View>
              </View>
              <View style={[styles.legend, { marginTop: theme.spacing.sm }]}>
                <View style={[styles.legendDot, { backgroundColor: series.income }]} />
                <Text style={[styles.legendLabel, { color: theme.colors.textSecondary, fontFamily: theme.fonts.sans }]}>
                  {t('Income')}
                </Text>
                <View
                  style={[
                    styles.legendDot,
                    { backgroundColor: series.spend, marginLeft: theme.spacing.md },
                  ]}
                />
                <Text style={[styles.legendLabel, { color: theme.colors.textSecondary, fontFamily: theme.fonts.sans }]}>
                  {t('Spending')}
                </Text>
              </View>
            </Card>
          </FadeRise>

          {/* Stat card row: display-only integer averages + the DTO net. */}
          {statCards.length > 0 ? (
            <FadeRise delay={staggerChildDelayMs(2, stagger.cascadeMs)}>
              <View style={[styles.statRow, { marginBottom: 14 }]}>
                {statCards.map((stat) => (
                  <Card key={stat.label} style={styles.statCard}>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.statLabel,
                        { color: theme.colors.textFaint, fontFamily: theme.fonts.sans },
                      ]}
                    >
                      {stat.label}
                    </Text>
                    <Text
                      numberOfLines={1}
                      accessibilityLabel={`${stat.label}: ${mask(formatMinorAmount(stat.valueMinor, currency))}`}
                      style={[
                        styles.statValue,
                        { color: stat.color, fontFamily: theme.fonts.monoSet.bold },
                      ]}
                    >
                      {mask(formatMinorAmount(stat.valueMinor, currency))}
                    </Text>
                  </Card>
                ))}
              </View>
            </FadeRise>
          ) : null}

          {/* Focused month detail (preserved interaction). */}
          <FadeRise delay={staggerChildDelayMs(3, stagger.cascadeMs)}>
            <Card>
              <CardHeader title={isoMonthLabel(focusedMonth, tag)} />
              {focused ? (
                <View style={styles.triple}>
                  <View style={styles.tripleCell}>
                    <Text style={[styles.tripleLabel, { color: theme.colors.textSecondary, fontFamily: theme.fonts.sans }]}>
                      {t('Income')}
                    </Text>
                    <Money amount={focused.income} currency={currency} size="md" />
                  </View>
                  <View style={styles.tripleCell}>
                    <Text style={[styles.tripleLabel, { color: theme.colors.textSecondary, fontFamily: theme.fonts.sans }]}>
                      {t('Spending')}
                    </Text>
                    <Money amount={focused.expense} currency={currency} size="md" />
                  </View>
                  <View style={styles.tripleCell}>
                    <Text style={[styles.tripleLabel, { color: theme.colors.textSecondary, fontFamily: theme.fonts.sans }]}>
                      {t('Net saved')}
                    </Text>
                    <Money amount={focused.net} currency={currency} colorBySign size="md" />
                  </View>
                </View>
              ) : (
                <EmptyState title="No activity" body="No transactions in this month." />
              )}
            </Card>
          </FadeRise>
        </>
      )}
    </ScrollView>
    <GoldfinchRefreshMark active={cashflowQuery.isRefetching} />
    </>
  );
}

const styles = StyleSheet.create({
  chartOverlayRow: { flex: 1, flexDirection: 'row' },
  chartOverlayCell: { flex: 1 },
  legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  legendDot: { width: 9, height: 9, borderRadius: 3, marginRight: 5 },
  legendLabel: { fontSize: 12 },
  statRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, padding: 14 },
  statLabel: { fontSize: 11, marginBottom: 4 },
  statValue: { fontSize: 17 },
  triple: { flexDirection: 'row' },
  tripleCell: { flex: 1 },
  tripleLabel: { fontSize: 12, marginBottom: 2 },
});
