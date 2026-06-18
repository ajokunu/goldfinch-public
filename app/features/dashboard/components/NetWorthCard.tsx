/**
 * Net-worth hero card (screens.md 1.3): card title + 3M/6M/1Y range control,
 * animated count-up hero number in the direction's display treatment, a
 * two-snapshot change pill, the trend chart in the direction's chart variant,
 * and the Assets | Liabilities footer split.
 *
 * Data: the summary number/footer comes from GET /summary (prop); the trend
 * and the change pill consume the EXISTING reports hook useNetWorthHistory()
 * cross-feature (same cache entry as the Reports screen -- no new endpoint,
 * no new key). All arithmetic is integer minor-units math in lib/heroMath.
 *
 * History gap (1.3 States): with 0-1 snapshots the number and footer render
 * normally, the pill + range control are hidden, and the chart slot carries
 * the accrual caption -- never a placeholder curve. A failed history read
 * degrades only the chart slot (logged + inline retry); the hero number it
 * does not touch.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react-native';
import type { IsoMonth, SummaryResponse } from '@goldfinch/shared/types';

import { localeTag, useLang, useT } from '../../../src/i18n';
import { formatTxnDate, isoMonthShortLabel } from '../../../src/lib/dates';
import { BankFreshness } from './BankFreshness';
import { logger } from '../../../src/lib/logger';
import { LineChart } from '../../../src/ui/charts';
import { CurrencyAmount, formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { useMaskMoney } from '../../../src/state/uiStore';
import { withAlpha } from '../../../src/ui/mixColor';
import { Segmented } from '../../../src/ui/Segmented';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { useNetWorthHistory } from '../../reports/hooks';
import {
  DEFAULT_NET_WORTH_RANGE,
  NET_WORTH_RANGES,
  formatPctTenths,
  netWorthDelta,
  sliceHistoryToRange,
  type NetWorthRangeKey,
} from '../lib/heroMath';
import { Card, CardHeader } from './Card';
import { HeroAmount } from './HeroAmount';

const log = logger.child({ screen: 'dashboard', card: 'netWorth' });

/** Trend plot height (screens.md 1.3). */
const CHART_HEIGHT = 132;

function ChangePill({
  deltaMinor,
  pctTenths,
  currency,
}: {
  deltaMinor: number;
  pctTenths: number | null;
  currency: string;
}) {
  const theme = useTheme();
  // The change pill renders its money + percent as a plain Text string built
  // here, outside Money/CurrencyAmount, so privacy mode has to mask the
  // amount explicitly (the percent is not a money figure and stays).
  const { mask } = useMaskMoney();
  const positive = deltaMinor >= 0;
  const color = positive ? theme.colors.pos : theme.colors.neg;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  const amountLabel = mask(
    formatMinorAmount(deltaMinor, currency, { signDisplay: 'always' }),
  );
  const label =
    pctTenths === null
      ? amountLabel
      : `${amountLabel} (${formatPctTenths(pctTenths)})`;

  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        styles.pill,
        {
          backgroundColor: withAlpha(color, 0.14),
          borderRadius: theme.radius.chip,
        },
      ]}
    >
      <Icon size={14} color={color} strokeWidth={2.4} />
      <Text
        style={{
          color,
          fontSize: 12.5,
          fontFamily: theme.fonts.sansSet.semibold,
          fontVariant: ['tabular-nums'],
          marginLeft: 3,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function NetWorthCard({ summary }: { summary: SummaryResponse }) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  // The trend chart's screen-reader summary embeds the latest net figure as a
  // plain string (outside the masking primitives), so privacy mode masks it
  // here before it reaches the SVG wrapper.
  const { mask } = useMaskMoney();
  const [range, setRange] = useState<NetWorthRangeKey>(DEFAULT_NET_WORTH_RANGE);

  const historyQuery = useNetWorthHistory();

  useEffect(() => {
    if (historyQuery.isError) {
      log.warn('net-worth history failed; trend slot degraded', {
        error: historyQuery.error,
      });
    }
  }, [historyQuery.isError, historyQuery.error]);

  const items = historyQuery.data?.items ?? [];
  const hasTrend = historyQuery.isSuccess && items.length >= 2;
  const delta = useMemo(() => netWorthDelta(items), [items]);

  const chartData = useMemo(() => {
    if (!hasTrend) return [];
    const sliced = sliceHistoryToRange(items, range);
    // A stalled sync can leave the trailing window nearly empty; fall back
    // to the full accrued history rather than draw a degenerate chart.
    const windowed = sliced.length >= 2 ? sliced : items;
    return windowed.map((snapshot) => ({
      label: isoMonthShortLabel(
        snapshot.date.slice(0, 7) as IsoMonth,
        localeTag(lang),
      ),
      value: snapshot.netMinor,
    }));
  }, [hasTrend, items, range, lang]);

  const latest = items.length > 0 ? items[items.length - 1] : undefined;
  const perCurrency =
    latest !== undefined && latest.perCurrency.length > 1
      ? latest.perCurrency
      : [];

  let chartSlot = null;
  if (historyQuery.isPending) {
    // Reserve the slot so the card does not jump when the trend arrives.
    chartSlot = <View style={{ height: CHART_HEIGHT }} />;
  } else if (historyQuery.isError) {
    chartSlot = (
      <View style={[styles.chartCaption, { height: CHART_HEIGHT }]}>
        <Text
          style={{
            color: theme.colors.dim,
            fontSize: 12.5,
            fontFamily: theme.fonts.sans,
            textAlign: 'center',
          }}
        >
          Could not load the trend.
        </Text>
        <Pressable
          onPress={() => void historyQuery.refetch()}
          accessibilityRole="button"
          accessibilityLabel="Retry loading the net worth trend"
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, marginTop: 6 })}
        >
          <Text
            style={{
              color: theme.colors.accent,
              fontSize: 13,
              fontFamily: theme.fonts.sansSet.semibold,
            }}
          >
            Try again
          </Text>
        </Pressable>
      </View>
    );
  } else if (!hasTrend) {
    const firstSnapshotDate = historyQuery.data?.firstSnapshotDate ?? null;
    chartSlot = (
      <View style={[styles.chartCaption, { height: CHART_HEIGHT }]}>
        <Text
          style={{
            color: theme.colors.dim,
            fontSize: 12.5,
            fontFamily: theme.fonts.sans,
            textAlign: 'center',
          }}
        >
          {firstSnapshotDate === null
            ? 'Trend appears after a few daily syncs — history starts after the first sync.'
            : `Trend appears after a few daily syncs — history starts ${formatTxnDate(firstSnapshotDate, localeTag(lang))}.`}
        </Text>
      </View>
    );
  } else {
    const lastPoint = chartData[chartData.length - 1];
    chartSlot = (
      <LineChart
        data={chartData}
        height={CHART_HEIGHT}
        animationKey={range}
        accessibilityLabel={`${t('Net worth')} (${range}): ${mask(
          lastPoint === undefined
            ? formatMinorAmount(summary.netWorthMinor, summary.currency)
            : formatMinorAmount(lastPoint.value, summary.currency),
        )}`}
        testID="networth-trend"
      />
    );
  }

  const hasLiabilities = summary.liabilitiesTotalMinor !== 0;

  return (
    <Card>
      <CardHeader
        title={t('Net worth')}
        right={
          hasTrend ? (
            <View style={styles.rangeWrap}>
              <Segmented
                options={NET_WORTH_RANGES.map((option) => ({
                  key: option.key,
                  label: option.key,
                }))}
                value={range}
                onChange={setRange}
                small
              />
            </View>
          ) : undefined
        }
      />
      <HeroAmount
        amountMinor={summary.netWorthMinor}
        currency={summary.currency}
        testID="networth-hero"
      />
      {delta !== null ? (
        <View style={{ marginTop: 6, flexDirection: 'row' }}>
          <ChangePill
            deltaMinor={delta.deltaMinor}
            pctTenths={delta.pctTenths}
            currency={summary.currency}
          />
        </View>
      ) : null}
      <View style={{ marginTop: theme.spacing.sm }}>{chartSlot}</View>
      <View
        style={[
          styles.footerRow,
          { borderTopColor: theme.colors.line, marginTop: theme.spacing.sm },
        ]}
      >
        <View style={styles.footerCol}>
          <Text
            style={{
              color: theme.colors.dim,
              fontSize: 11.5,
              fontFamily: theme.fonts.sans,
            }}
          >
            {t('Assets')}
          </Text>
          <CurrencyAmount
            amountMinor={summary.assetsTotalMinor}
            currency={summary.currency}
            style={{ fontSize: 16, fontFamily: theme.fonts.sansSet.semibold }}
          />
        </View>
        <View
          style={[styles.footerDivider, { backgroundColor: theme.colors.line }]}
        />
        <View style={styles.footerCol}>
          <Text
            style={{
              color: theme.colors.dim,
              fontSize: 11.5,
              fontFamily: theme.fonts.sans,
            }}
          >
            {t('Liabilities')}
          </Text>
          <CurrencyAmount
            amountMinor={summary.liabilitiesTotalMinor}
            currency={summary.currency}
            style={{
              fontSize: 16,
              fontFamily: theme.fonts.sansSet.semibold,
              color: hasLiabilities ? theme.colors.neg : theme.colors.text,
            }}
          />
        </View>
      </View>
      {perCurrency.length > 0 ? (
        <View style={{ marginTop: theme.spacing.sm, gap: 4 }}>
          {perCurrency.map((slice) => (
            <View key={slice.currency} style={styles.currencyRow}>
              <Text
                style={{
                  color: theme.colors.dim,
                  fontSize: 11.5,
                  fontFamily: theme.fonts.sans,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {slice.currency}
              </Text>
              <CurrencyAmount
                amountMinor={slice.netMinor}
                currency={slice.currency}
                size="sm"
              />
            </View>
          ))}
        </View>
      ) : null}
      <BankFreshness asOf={summary.asOf} />
    </Card>
  );
}

const styles = StyleSheet.create({
  rangeWrap: { width: 168 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chartCaption: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 10,
  },
  footerCol: { flex: 1, gap: 2 },
  footerDivider: { width: 1, alignSelf: 'stretch', marginHorizontal: 14 },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
