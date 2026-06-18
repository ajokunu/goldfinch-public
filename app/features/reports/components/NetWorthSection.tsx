/**
 * Net-worth trend section (P7-4, restyled per design-spec/screens.md 4.2):
 * per currency present in the snapshot history (P7-7: currencies never merge
 * into one series) a hero line -- the latest net in the direction's display
 * cut plus an honest change pill -- over an assets/liabilities caption and a
 * 150px line chart in the direction's treatment, sliced client-side to the
 * selected range window.
 *
 * Change-pill honesty rule: "% YTD" only when a snapshot at or before Jan 1
 * of the current year exists; otherwise "% since {series start}"; hidden
 * entirely with fewer than two snapshots or a zero baseline (lib/series
 * netWorthChange).
 *
 * History accrues from first deploy with no synthetic backfill, so the
 * section always states its accrual start date (firstSnapshotDate) under the
 * charts, per the P7-4 decision text (caption preserved verbatim).
 */
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react-native';
import type { IsoDate, NetWorthHistoryResponse } from '@goldfinch/shared/types';

import { localeTag, useLang, useT } from '../../../src/i18n';
import { LineChart } from '../../../src/ui/charts';
import { formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { useMaskMoney } from '../../../src/state/uiStore';
import { withAlpha } from '../../../src/ui/mixColor';
import { CountUp } from '../../../src/ui/motion';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { formatDateHeading, formatTxnDate } from '../../../src/lib/dates';
import { netWorthChangeLabel } from '../lib/labels';
import {
  netWorthChange,
  netWorthCurrencySeries,
  sliceNetWorthPoints,
  type NetWorthChange,
} from '../lib/series';
import { CurrencyHeading } from './CurrencyHeading';

export function NetWorthSection({
  response,
  rangeStart,
  animationKey,
}: {
  response: NetWorthHistoryResponse;
  /** Window start for the client-side slice; null = full history. */
  rangeStart: IsoDate | null;
  /** Replays the chart entrance when the range toggles. */
  animationKey: string;
}) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  // Privacy mode must reach the assets/liabilities caption, the SVG y-axis
  // tick labels (formatValue), the scrubber value flag, and the chart's
  // screen-reader summary -- every one is a pre-formatted money string built
  // here, outside the CountUp/Money primitives.
  const { mask } = useMaskMoney();
  // Pinned per mount (same posture as the screen's flow month): the YTD
  // baseline date only changes at a year boundary.
  const [yearStart] = useState<IsoDate>(
    () => `${new Date().getFullYear()}-01-01`,
  );
  const series = useMemo(
    () => netWorthCurrencySeries(response.items),
    [response.items],
  );
  const multiCurrency = series.length > 1;

  return (
    <View style={{ gap: theme.spacing.md }}>
      {series.map((entry) => {
        const points = sliceNetWorthPoints(entry.points, rangeStart);
        const change = netWorthChange(entry.points, yearStart);
        return (
          <View key={entry.currency} style={{ gap: 6 }}>
            {multiCurrency ? (
              <CurrencyHeading currency={entry.currency} />
            ) : null}
            <View style={styles.heroRow}>
              {/* Report hero headline (PHASE9-DECISIONS P9-2 item 4):
                  rolling-digit CountUp on mount and on value change. */}
              <CountUp
                amountMinor={entry.latest.netMinor}
                currency={entry.currency}
                style={{
                  fontSize: 28,
                  lineHeight: 34,
                  fontFamily: theme.fonts.display,
                  // The display family IS the weight cut; never synthesize
                  // on top of a loaded custom font (tokens.md 8.3).
                  fontWeight: 'normal',
                }}
                testID={`reports-networth-hero-${entry.currency}`}
              />
              {change !== null ? <ChangePill change={change} /> : null}
            </View>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: theme.text.caption,
                fontFamily: theme.fonts.sans,
              }}
            >
              {`${t('Assets')} ${mask(formatMinorAmount(entry.latest.assetsMinor, entry.currency))} · ${t('Liabilities')} ${mask(formatMinorAmount(entry.latest.liabilitiesMinor, entry.currency))}`}
            </Text>
            {points.length > 0 ? (
              <LineChart
                data={points.map((point) => ({
                  label: formatTxnDate(point.date, localeTag(lang)),
                  value: point.netMinor,
                }))}
                height={150}
                animationKey={animationKey}
                // Ticks are layout numbers from niceTicks; rounding to
                // integer minor units before formatting keeps the label
                // path exact.
                formatValue={(tick) =>
                  mask(formatMinorAmount(Math.round(tick), entry.currency))
                }
                accessibilityLabel={`${t('Net worth trend')}, ${entry.currency}: ${mask(formatMinorAmount(entry.latest.netMinor, entry.currency))}`}
                // Crosshair scrubber (P9-2 item 5): web hover and native
                // touch-drag share one ChartScrubber overlay.
                scrub
                testID={`reports-networth-chart-${entry.currency}`}
              />
            ) : null}
          </View>
        );
      })}
      {response.firstSnapshotDate !== null ? (
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.text.caption,
            fontFamily: theme.fonts.sans,
          }}
        >
          {`Tracking since ${formatDateHeading(response.firstSnapshotDate)}. A snapshot is recorded after each daily sync; balances before that date are not backfilled.`}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The hero change pill: arrow + signed percent, pos/neg colored over a 14%
 * tint of the same token. Label composition is locale-aware (lib/labels).
 */
function ChangePill({ change }: { change: NetWorthChange }) {
  const theme = useTheme();
  const lang = useLang();
  const color = change.negative ? theme.colors.neg : theme.colors.pos;
  const Icon = change.negative ? ArrowDownRight : ArrowUpRight;
  const label = netWorthChangeLabel(
    lang,
    change.pctLabel,
    change.kind,
    formatTxnDate(change.baselineDate, localeTag(lang)),
  );
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: withAlpha(color, 0.14),
          borderRadius: theme.radius.chip,
        },
      ]}
    >
      <Icon size={13} color={color} strokeWidth={2.4} />
      <Text
        style={{
          color,
          fontSize: 12,
          fontFamily: theme.fonts.sansSet.semibold,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
