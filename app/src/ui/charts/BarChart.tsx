/**
 * Grouped bar chart primitive (react-native-svg), restyled per
 * design-spec/charts.md section 4. Bars render side by side per group from a
 * shared zero baseline (negative values hang below the line) with the active
 * direction's metrics:
 *
 * - area  (meridian): barW = 0.26 groupW, gap 5, rx 3
 * - grid  (quant):    barW = 0.22 groupW, gap 2, rx 0, dashed gridlines
 * - block (studio):   barW = 0.30 groupW, gap 3, rx 0
 * - soft  (halo):     barW = 0.28 groupW, gap 5, pill (rx = barW / 2)
 *
 * The plot is full-bleed horizontally (prototype look). Values are
 * pixel-layout numbers only (pass integer minor units); produce money labels
 * through `formatValue`. Empty/error states are the caller's job -- with no
 * data this renders an empty box.
 */
import { Animated, Easing, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '../ThemeProvider';
import {
  createLinearScale,
  niceTicks,
  sampledLabelIndexes,
  type ChartVariant,
} from './chartMath';
import { ChartScrubber } from './ChartScrubber';
import { resolveChartTheme, svgFontProps } from './chartTheme';
import { CHART_ENTRANCE_MS, useChartEntrance } from './useChartEntrance';
import { useContainerWidth } from './useContainerWidth';

export interface BarChartBar {
  value: number;
  color: string;
}

export interface BarChartGroup {
  /** Category label for the x axis (e.g. "Jun"). */
  label: string;
  bars: readonly BarChartBar[];
}

export interface BarChartProps {
  data: readonly BarChartGroup[];
  height?: number;
  /** Pin a treatment (tests/one-offs); defaults to the theme's variant. */
  variant?: ChartVariant;
  /** Draw y gridlines + tick labels (default false; prototype has none). */
  showYTicks?: boolean;
  /** Re-runs the entrance animation when it changes (window toggles). */
  animationKey?: string | number;
  /** y tick label formatter (pass a money formatter for minor units). */
  formatValue?: (value: number) => string;
  /** Max x labels drawn (first/last always included). Default 6. */
  maxXLabels?: number;
  /** Chart summary for screen readers (charts.md 4.1). Optional until every
   *  consumer passes one (the restyled screens must); when absent the
   *  wrapper keeps today's non-accessible-decoration behavior. */
  accessibilityLabel?: string;
  /** Crosshair scrubber with value flag (PHASE9-DECISIONS P9-2 item 5):
   *  web hover and native touch-drag share one ChartScrubber overlay; the
   *  flag lists one `formatValue`d line per bar in the group. */
  scrub?: boolean;
  /** Flag line prefixes per bar series (e.g. ["Income", "Spent"]); shown
   *  only when `scrub` is on. */
  scrubSeriesLabels?: readonly string[];
  testID?: string;
}

const PAD_TOP = 10;
const PAD_BOTTOM = 24;
const LABEL_FONT_SIZE = 10;
/** grid-variant gridline fractions of the value area, measured from the
 *  bottom (charts.md 4.3). */
const GRID_FRACTIONS = [0.33, 0.66, 1] as const;

const VARIANT_BAR: Record<ChartVariant, { widthFactor: number; gap: number }> = {
  area: { widthFactor: 0.26, gap: 5 },
  grid: { widthFactor: 0.22, gap: 2 },
  block: { widthFactor: 0.3, gap: 3 },
  soft: { widthFactor: 0.28, gap: 5 },
};

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/** Bars grow from the baseline over the first 600ms of the master timeline. */
const GROW_RANGE: [number, number] = [0, 600 / CHART_ENTRANCE_MS];
const GROW_EASING = Easing.bezier(0.22, 1, 0.36, 1);

export function BarChart({
  data,
  height = 180,
  variant: variantProp,
  showYTicks = false,
  animationKey,
  formatValue = String,
  maxXLabels = 6,
  accessibilityLabel,
  scrub = false,
  scrubSeriesLabels,
  testID,
}: BarChartProps) {
  const theme = useTheme();
  const { width, onLayout } = useContainerWidth();

  const ready = width > 0 && data.length > 0;
  const progress = useChartEntrance(animationKey, ready);

  const chart = resolveChartTheme(theme);
  const variant = variantProp ?? chart.variant;

  let content = null;
  if (ready) {
    const cfg = VARIANT_BAR[variant];
    const axisFont = svgFontProps(chart.fonts.mono, 400);
    const plotBottom = height - PAD_BOTTOM;
    const valueAreaHeight = plotBottom - PAD_TOP;

    const values = data.flatMap((group) => group.bars.map((bar) => bar.value));
    // The zero baseline is always part of the domain; ticks are computed for
    // the domain even when not rendered (charts.md 4.2).
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
    const domainMin =
      ticks.length > 0 ? Math.min(...ticks) : Math.min(0, ...values);
    const domainMax =
      ticks.length > 0 ? Math.max(...ticks) : Math.max(0, ...values);
    const yScale = createLinearScale(domainMin, domainMax, plotBottom, PAD_TOP);
    const zeroY = yScale(0);
    const hasNegative = values.some((value) => value < 0);

    const groupWidth = width / data.length;
    const barWidth = Math.max(1, groupWidth * cfg.widthFactor);
    const rx = variant === 'soft' ? barWidth / 2 : variant === 'area' ? 3 : 0;
    const labelIndexes = sampledLabelIndexes(data.length, maxXLabels);

    content = (
      <Svg width={width} height={height}>
        {variant === 'grid' && !showYTicks
          ? GRID_FRACTIONS.map((fraction) => {
              const y = PAD_TOP + (1 - fraction) * valueAreaHeight;
              return (
                <Line
                  key={`grid-${fraction}`}
                  x1={0}
                  x2={width}
                  y1={y}
                  y2={y}
                  stroke={chart.grid}
                  strokeWidth={1}
                  strokeDasharray="2 3"
                />
              );
            })
          : null}
        {showYTicks ? (
          <G>
            {ticks.map((tick) => (
              <G key={`tick-${tick}`}>
                <Line
                  x1={0}
                  x2={width}
                  y1={yScale(tick)}
                  y2={yScale(tick)}
                  stroke={chart.grid}
                  strokeWidth={1}
                />
                <SvgText
                  x={0}
                  y={yScale(tick) - 3}
                  fontSize={LABEL_FONT_SIZE}
                  fill={chart.faint}
                  {...axisFont}
                >
                  {formatValue(tick)}
                </SvgText>
              </G>
            ))}
          </G>
        ) : null}
        {data.map((group, groupIndex) => {
          const cx = groupIndex * groupWidth + groupWidth / 2;
          const barCount = group.bars.length;
          const totalWidth =
            barCount * barWidth + Math.max(0, barCount - 1) * cfg.gap;
          return (
            <G key={`group-${groupIndex}-${group.label}`}>
              {group.bars.map((bar, barIndex) => {
                const valueY = yScale(bar.value);
                const yTop = Math.min(valueY, zeroY);
                const barHeight = Math.max(Math.abs(valueY - zeroY), 1);
                // Bars grow from the zero baseline: positive bars animate
                // their top edge up while negative bars extend downward.
                const animatedHeight = progress.interpolate({
                  inputRange: GROW_RANGE,
                  outputRange: [0, barHeight],
                  easing: GROW_EASING,
                  extrapolate: 'clamp',
                });
                const animatedY =
                  bar.value < 0
                    ? zeroY
                    : progress.interpolate({
                        inputRange: GROW_RANGE,
                        outputRange: [zeroY, yTop],
                        easing: GROW_EASING,
                        extrapolate: 'clamp',
                      });
                return (
                  <AnimatedRect
                    key={`bar-${barIndex}`}
                    x={cx - totalWidth / 2 + barIndex * (barWidth + cfg.gap)}
                    y={animatedY}
                    width={barWidth}
                    height={animatedHeight}
                    fill={bar.color}
                    rx={rx}
                  />
                );
              })}
              {labelIndexes.has(groupIndex) ? (
                <SvgText
                  x={cx}
                  y={height - 7}
                  fontSize={LABEL_FONT_SIZE}
                  fill={chart.faint}
                  {...axisFont}
                  textAnchor={
                    groupIndex === 0
                      ? 'start'
                      : groupIndex === data.length - 1
                        ? 'end'
                        : 'middle'
                  }
                >
                  {group.label}
                </SvgText>
              ) : null}
            </G>
          );
        })}
        {hasNegative ? (
          <Line
            x1={0}
            x2={width}
            y1={zeroY}
            y2={zeroY}
            stroke={chart.dim}
            strokeWidth={1}
          />
        ) : null}
      </Svg>
    );
    if (scrub) {
      const scrubber = (
        <ChartScrubber
          width={width}
          height={height}
          points={data.map((group, groupIndex) => ({
            x: groupIndex * groupWidth + groupWidth / 2,
            label: group.label,
            lines: group.bars.map((bar, barIndex) => {
              const prefix = scrubSeriesLabels?.[barIndex];
              const value = formatValue(bar.value);
              return prefix === undefined ? value : `${prefix} ${value}`;
            }),
          }))}
          color={chart.accent}
          topPad={PAD_TOP}
          bottomPad={PAD_BOTTOM}
          testID={testID !== undefined ? `${testID}-scrubber` : undefined}
        />
      );
      content = (
        <>
          {content}
          {scrubber}
        </>
      );
    }
  }

  return (
    <View
      onLayout={onLayout}
      style={{ height, alignSelf: 'stretch' }}
      testID={testID}
      accessible={accessibilityLabel !== undefined ? true : undefined}
      accessibilityRole={accessibilityLabel !== undefined ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      {content}
    </View>
  );
}
