/**
 * Reports feature entry point (PHASE7-DECISIONS P7-4, P7-7; restyled per
 * design-spec/screens.md section 4).
 *
 * Three independent TanStack Query reads -- GET /networth/history,
 * GET /reports/trends, GET /reports/flow -- each rendered in its own card
 * with its own loading/empty/error state, so one slow or failed call
 * degrades only its card (same posture as the dashboard).
 *
 * Per-currency rule (P7-7): every section renders one chart per currency,
 * with a currency heading whenever more than one currency exists -- never a
 * synthetic mixed-currency total. All aggregation is server-computed; the
 * client passes integer minor units to the chart kit for pixel layout and
 * formats labels via the shared per-currency money helpers.
 *
 * Restyle: screen title in the direction display cut, the three cards as
 * "Net worth trend" (client-side 3M/6M/1Y slice with the honesty rule),
 * "Monthly trends" (paired bars + totals row), and "Where {month} went"
 * (flow diagram). Entrance is the shared FadeRise cascade (PHASE9-DECISIONS
 * P9-1/P9-2 item 1; the primitive owns reduced-motion and kill-switch
 * behavior). Strings go through t(); month labels use the active locale.
 */
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { IsoMonth } from '@goldfinch/shared/types';

import { queryKeys } from '../../src/api/queryKeys';
import { currentIsoMonth, isoMonthLabel } from '../../src/lib/dates';
import { localeTag, useLang, useT } from '../../src/i18n';
import { formatMinorAmount } from '../../src/ui/CurrencyAmount';
import { maskIfHidden, useAmountsHidden } from '../../src/state/uiStore';
import {
  GoldfinchRefreshControl,
  GoldfinchRefreshMark,
} from '../../src/ui/GoldfinchRefresh';
import { FadeRise, stagger, staggerChildDelayMs } from '../../src/ui/motion';
import { Screen } from '../../src/ui/Screen';
import { Segmented } from '../../src/ui/Segmented';
import { EmptyState, ErrorState, LoadingState } from '../../src/ui/States';
import { useTheme } from '../../src/ui/ThemeProvider';
import { Card, CardHeader } from './components/Card';
import { FlowSection } from './components/FlowSection';
import { MonthPicker } from './components/MonthPicker';
import { NetWorthSection } from './components/NetWorthSection';
import { SegmentedTabs } from './components/SegmentedTabs';
import { TrendsSection } from './components/TrendsSection';
import {
  DEFAULT_TREND_WINDOW_KEY,
  TREND_WINDOW_BY_KEY,
  TREND_WINDOW_OPTIONS,
  useNetWorthHistory,
  useReportsFlow,
  useReportsTrends,
  type TrendWindowKey,
} from './hooks';
import { whereMonthWent } from './lib/labels';
import {
  availableNetWorthRanges,
  effectiveNetWorthRange,
  flowGroupHasContent,
  flowIsEmpty,
  NET_WORTH_RANGE_OPTIONS,
  netWorthRangeStart,
  trendsAreEmpty,
  type NetWorthRangeKey,
} from './lib/series';

export default function ReportsScreen() {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  // The flow-card eyebrow "{income} in" is a memoized money string built
  // outside the masking primitives; thread the stable hidden flag into the
  // memo (not the unstable mask() closure) so privacy mode masks it.
  const amountsHidden = useAmountsHidden();
  const queryClient = useQueryClient();

  const [trendWindowKey, setTrendWindowKey] = useState<TrendWindowKey>(
    DEFAULT_TREND_WINDOW_KEY,
  );
  // Pinned per mount (like the dashboard's recent window): the values only
  // change at a local day/month boundary, and the next mount picks them up.
  const [flowMonth, setFlowMonth] = useState<IsoMonth>(() => currentIsoMonth());
  const [maxFlowMonth] = useState<IsoMonth>(() => currentIsoMonth());
  const [mountedAt] = useState<Date>(() => new Date());
  const [netWorthRangeKey, setNetWorthRangeKey] =
    useState<NetWorthRangeKey>('1Y');

  const netWorthQuery = useNetWorthHistory();
  const trendsQuery = useReportsTrends(TREND_WINDOW_BY_KEY[trendWindowKey]);
  const flowQuery = useReportsFlow(flowMonth);

  // Pull-to-refresh invalidates both report domains through the shared key
  // factory and resolves when the active refetches settle.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.netWorthHistory.all(),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reports.all() }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  // Net-worth range control (screens.md 4.2): only windows fully covered by
  // the accrued history are offered, so a chart never implies more history
  // than exists. With no offerable window the control is hidden and the full
  // series renders.
  const firstSnapshotDate = netWorthQuery.data?.firstSnapshotDate ?? null;
  const hasHistory =
    netWorthQuery.isSuccess && netWorthQuery.data.items.length > 0;
  const availableRanges = useMemo(
    () =>
      hasHistory && firstSnapshotDate !== null
        ? availableNetWorthRanges(firstSnapshotDate, mountedAt)
        : [],
    [hasHistory, firstSnapshotDate, mountedAt],
  );
  const effectiveRange = effectiveNetWorthRange(
    netWorthRangeKey,
    availableRanges,
  );
  const rangeStart =
    effectiveRange !== null
      ? netWorthRangeStart(effectiveRange, mountedAt)
      : null;
  const rangeOptions = NET_WORTH_RANGE_OPTIONS.filter((option) =>
    availableRanges.includes(option.key),
  );

  // Flow-card eyebrow "{income} in" (screens.md 4.4): only when exactly one
  // currency has drawable flow -- a combined multi-currency figure would be a
  // synthetic total (P7-7).
  const flowEyebrow = useMemo(() => {
    if (flowQuery.data === undefined) return null;
    const groups = (flowQuery.data.perCurrency ?? []).filter(flowGroupHasContent);
    const only = groups.length === 1 ? groups[0] : undefined;
    if (only === undefined || only.incomeMinor <= 0) return null;
    return `${maskIfHidden(formatMinorAmount(only.incomeMinor, only.currency), amountsHidden)} ${t('in')}`;
  }, [flowQuery.data, t, amountsHidden]);

  const netWorthBody = netWorthQuery.isPending ? (
    <LoadingState />
  ) : netWorthQuery.isError ? (
    <ErrorState
      message="Could not load net-worth history."
      onRetry={() => void netWorthQuery.refetch()}
    />
  ) : netWorthQuery.data.items.length === 0 ? (
    <EmptyState
      title="No net-worth history yet"
      body="A snapshot is recorded after each daily sync, starting from this feature's first deploy. The chart appears once the first snapshot lands."
    />
  ) : (
    <NetWorthSection
      response={netWorthQuery.data}
      rangeStart={rangeStart}
      animationKey={effectiveRange ?? 'all'}
    />
  );

  const trendsBody = trendsQuery.isPending ? (
    <LoadingState />
  ) : trendsQuery.isError ? (
    <ErrorState
      message="Could not load monthly trends."
      onRetry={() => void trendsQuery.refetch()}
    />
  ) : trendsAreEmpty(trendsQuery.data.months) ? (
    <EmptyState
      title="No activity in this window"
      body="Income and spending bars appear here once transactions exist in the selected months."
    />
  ) : (
    <TrendsSection
      months={trendsQuery.data.months}
      animationKey={trendWindowKey}
    />
  );

  const flowBody = flowQuery.isPending ? (
    <LoadingState />
  ) : flowQuery.isError ? (
    <ErrorState
      message="Could not load the income flow."
      onRetry={() => void flowQuery.refetch()}
    />
  ) : flowIsEmpty(flowQuery.data) ? (
    <EmptyState
      title={`No cash flow in ${isoMonthLabel(flowMonth)}`}
      body="Transfers are excluded. Pick another month, or check back after new transactions sync."
    />
  ) : (
    <FlowSection response={flowQuery.data} />
  );

  return (
    <Screen padded={false}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingHorizontal: theme.pad,
          paddingVertical: theme.spacing.md,
        }}
        refreshControl={
          <GoldfinchRefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
          />
        }
      >
        {/* Title-then-cards cascade via the shared motion module
            (PHASE9-DECISIONS P9-1/P9-2 item 1): each section is its own
            FadeRise so the column gap keeps applying between cards. */}
        <View style={styles.column}>
          <FadeRise>
            <Text
              accessibilityRole="header"
              style={{
                color: theme.colors.textPrimary,
                fontFamily: theme.fonts.display,
                fontSize: theme.components.screenTitle.fontSize,
                letterSpacing: theme.components.screenTitle.letterSpacing,
                // The display family IS the weight cut; never synthesize
                // on top of a loaded custom font (tokens.md 8.3).
                fontWeight: 'normal',
              }}
            >
              {t('Reports')}
            </Text>
          </FadeRise>

          <FadeRise delay={staggerChildDelayMs(1, stagger.cascadeMs)}>
            <Card>
              <CardHeader
                title={t('Net worth trend')}
                right={
                  effectiveRange !== null && rangeOptions.length > 0 ? (
                    <View style={{ width: 52 * rangeOptions.length }}>
                      <Segmented
                        small
                        options={rangeOptions}
                        value={effectiveRange}
                        onChange={setNetWorthRangeKey}
                      />
                    </View>
                  ) : undefined
                }
              />
              {netWorthBody}
            </Card>
          </FadeRise>

          <FadeRise delay={staggerChildDelayMs(2, stagger.cascadeMs)}>
            <Card>
              <CardHeader
                title={t('Monthly trends')}
                right={<Eyebrow>{t('Income / Spend')}</Eyebrow>}
              />
              <View style={{ marginBottom: theme.spacing.sm }}>
                <SegmentedTabs
                  options={TREND_WINDOW_OPTIONS}
                  value={trendWindowKey}
                  onChange={setTrendWindowKey}
                />
              </View>
              {trendsBody}
            </Card>
          </FadeRise>

          <FadeRise delay={staggerChildDelayMs(3, stagger.cascadeMs)}>
            <Card>
              <CardHeader
                title={whereMonthWent(
                  lang,
                  isoMonthLabel(flowMonth, localeTag(lang)),
                )}
                right={
                  flowEyebrow !== null ? (
                    <Eyebrow>{flowEyebrow}</Eyebrow>
                  ) : undefined
                }
              />
              <View style={{ marginBottom: theme.spacing.sm }}>
                <MonthPicker
                  month={flowMonth}
                  onChange={setFlowMonth}
                  maxMonth={maxFlowMonth}
                />
              </View>
              {flowBody}
            </Card>
          </FadeRise>
        </View>
      </ScrollView>
      <GoldfinchRefreshMark active={refreshing} />
    </Screen>
  );
}

/** Small dim header-right caption (the prototype card eyebrow). */
function Eyebrow({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text
      numberOfLines={1}
      style={{
        color: theme.colors.textSecondary,
        fontSize: 11.5,
        fontFamily: theme.fonts.sansSet.semibold,
        marginLeft: 8,
      }}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  column: { gap: 14 },
});
