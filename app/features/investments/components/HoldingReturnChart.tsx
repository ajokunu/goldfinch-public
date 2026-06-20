/**
 * Holding normalized-%-return line chart (ops/INVESTMENTS-CHART-PLAN.md,
 * CONTRACT (d)). Mirrors the net-worth trend chart
 * (app/features/reports/components/NetWorthSection.tsx): a 150px line chart of
 * the position's % return over the selected window, the line colored by the
 * window's overall direction, with a static 0% baseline reference line behind
 * it so the eye reads gains/losses against the entry price.
 *
 * The chart metric is NORMALIZED % RETURN, computed CLIENT-SIDE by the shared
 * holdingReturn helpers in the hook (this component only RENDERS the result --
 * it does NO money math). A percent return is not a private dollar figure, so
 * it is NEVER masked under privacy mode (CONTRACT (h)); the chart carries no
 * dollar captions, so it never touches useAmountsHidden.
 *
 * History accrues from first deploy with no synthetic backfill: with fewer than
 * two usable points the chart draws nothing and states its accrual start date
 * (firstSnapshotDate) -- the same honesty rule and near-verbatim phrasing the
 * net-worth chart uses -- rather than implying movement that was never recorded.
 */
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line as SvgLine } from 'react-native-svg';
import type { ReturnPoint } from '@goldfinch/shared/holdingReturn';
import type { IsoDate } from '@goldfinch/shared/types';

import { localeTag, useLang } from '../../../src/i18n';
import { LineChart, createLinearScale } from '../../../src/ui/charts';
import { useContainerWidth } from '../../../src/ui/charts/useContainerWidth';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { formatDateHeading, formatTxnDate } from '../../../src/lib/dates';

export interface HoldingReturnChartProps {
  /** Normalized % return series: { date: IsoDate, returnPercent: number }[]. */
  data: ReturnPoint[];
  /** Window's total % return; undefined when insufficient points. */
  windowPercent: number | undefined;
  /** Earliest snapshot date (immutable across ranges); null before first snapshot. */
  firstSnapshotDate: IsoDate | null;
  /** True when < 2 usable points. */
  isInsufficient: boolean;
  /** Animation trigger when range toggles. */
  animationKey?: string | number;
  /** Custom height in pixels; optional. */
  height?: number;
  testID?: string;
}

// LineChart's fixed internal layout constants (LineChart.tsx PAD_TOP /
// padBottom): replicated here so the static 0% baseline overlay lands on the
// exact pixel row LineChart plots a 0 value at. showXAxis is true here, so the
// bottom pad is the with-axis value.
const PAD_TOP = 14;
const PAD_BOTTOM_WITH_AXIS = 22;

export function HoldingReturnChart({
  data,
  windowPercent,
  firstSnapshotDate,
  isInsufficient,
  animationKey,
  height = 150,
  testID,
}: HoldingReturnChartProps) {
  const theme = useTheme();
  const lang = useLang();
  // The baseline overlay must stretch to the same measured width LineChart
  // lays out at, so it shares the container-width hook rather than guessing.
  const { width, onLayout } = useContainerWidth();

  // History accrues from first deploy (no backfill): with fewer than two usable
  // points there is no honest line to draw, so the chart states its start date
  // instead. Mirrors the net-worth section's accrual caption verbatim apart
  // from the "holdings"/"balances" noun.
  if (isInsufficient || data.length < 2) {
    return (
      <View testID={testID}>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.text.caption,
            fontFamily: theme.fonts.sans,
          }}
          testID={testID !== undefined ? `${testID}-empty` : undefined}
        >
          {firstSnapshotDate !== null
            ? `History accrues from ${formatDateHeading(firstSnapshotDate)}. A snapshot is recorded after each daily sync; holdings before that date are not available.`
            : 'History accrues after the first daily sync; no snapshots have been recorded yet, so no holdings history is available.'}
        </Text>
      </View>
    );
  }

  // Color by the window's overall direction at chart entry (CONTRACT (d)):
  // positive -> green, zero-or-negative -> red, undefined -> neutral accent.
  // windowPercent is defined here by construction (data.length >= 2), but the
  // undefined branch is kept so the mapping matches the documented contract.
  const lineColor =
    windowPercent === undefined
      ? theme.colors.accent
      : windowPercent > 0
        ? theme.colors.positive
        : theme.colors.danger;

  const chartData = data.map((point) => ({
    label: formatTxnDate(point.date, localeTag(lang)),
    value: point.returnPercent,
  }));

  // 0% baseline overlay. LineChart auto-scales to the raw min/max of the data
  // when showYTicks is false (LineChart.tsx), so the baseline y is computed
  // with that same domain + padding. When 0 sits outside the visible range
  // (an all-positive or all-negative window), the reference line is clamped
  // off-plot rather than drawn at a misleading position, so we only render it
  // when 0 is within the value range.
  const values = data.map((point) => point.returnPercent);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const plotBottom = height - PAD_BOTTOM_WITH_AXIS;
  const baselineVisible = rawMin <= 0 && rawMax >= 0;
  const baselineY =
    width > 0 && baselineVisible
      ? createLinearScale(rawMin, rawMax, plotBottom, PAD_TOP)(0)
      : null;

  return (
    <View style={{ position: 'relative' }} onLayout={onLayout} testID={testID}>
      {baselineY !== null ? (
        <Svg
          width={width}
          height={height}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <SvgLine
            x1={0}
            x2={width}
            y1={baselineY}
            y2={baselineY}
            stroke={theme.colors.grid}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        </Svg>
      ) : null}
      <LineChart
        data={chartData}
        height={height}
        stroke={lineColor}
        showXAxis
        showYTicks={false}
        showDots={false}
        animationKey={animationKey}
        formatValue={(value) => `${value}%`}
        maxXLabels={6}
        accessibilityLabel={`Holding return trend: ${windowPercent ?? '—'}%${
          firstSnapshotDate !== null ? ` since ${formatDateHeading(firstSnapshotDate)}` : ''
        }`}
        scrub
        testID={testID !== undefined ? `${testID}-line` : undefined}
      />
    </View>
  );
}
