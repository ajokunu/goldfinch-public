/**
 * Trend/area line chart primitive (react-native-svg), restyled per
 * design-spec/charts.md section 3. Stretches to its container width and
 * draws one series with the active direction's treatment:
 *
 * - area  (meridian): Catmull-Rom curve (0.55), 2.2 stroke, gradient fill
 * - grid  (quant):    hard polyline, 1.6 stroke, dashed gridlines, square
 *                     last-point marker
 * - block (studio):   hard polyline, 3.5 stroke
 * - soft  (halo):     extra-smooth curve (0.85), 3 stroke, halo last point
 *
 * Values are pixel-layout numbers only (pass integer minor units); produce
 * money labels through `formatValue` (e.g. formatMinorAmount). Empty/error
 * states are the caller's job -- with no data this renders an empty box.
 */
import { useId } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { useTheme } from '../ThemeProvider';
import {
  CURVE_LENGTH_FACTOR,
  createLinearScale,
  linePath,
  niceTicks,
  polylineLength,
  sampledLabelIndexes,
  smoothPath,
  type ChartPoint,
  type ChartVariant,
} from './chartMath';
import { ChartScrubber } from './ChartScrubber';
import { resolveChartTheme, svgFontProps } from './chartTheme';
import { CHART_ENTRANCE_MS, useChartEntrance } from './useChartEntrance';
import { useContainerWidth } from './useContainerWidth';

export interface LineChartPoint {
  /** Category label for the x axis (e.g. "2026-06" or "Jun 8"). */
  label: string;
  value: number;
}

export interface LineChartProps {
  data: readonly LineChartPoint[];
  height?: number;
  /** Series color; defaults to the theme accent. */
  stroke?: string;
  /** Pin a treatment (tests/one-offs); defaults to the theme's variant. */
  variant?: ChartVariant;
  /** Draw x labels (default true; prototype showAxis). */
  showXAxis?: boolean;
  /** Draw y gridlines + tick labels (default false; the headline figure
   *  above the chart carries the magnitude, charts.md 3.6). */
  showYTicks?: boolean;
  /** Mark each datum with a dot (legacy look; replaces the variant's
   *  last-point marker; auto-on for single points). */
  showDots?: boolean;
  /** Re-runs the entrance animation when it changes (range toggles). */
  animationKey?: string | number;
  /** y tick label formatter (pass a money formatter for minor units). */
  formatValue?: (value: number) => string;
  /** Max x labels drawn (first/last always included). Default 6. */
  maxXLabels?: number;
  /** Chart summary for screen readers (charts.md 3.7). Optional until every
   *  consumer passes one (the restyled screens must); when absent the
   *  wrapper keeps today's non-accessible-decoration behavior. */
  accessibilityLabel?: string;
  /** Crosshair scrubber with value flag (PHASE9-DECISIONS P9-2 item 5):
   *  web hover and native touch-drag share one ChartScrubber overlay. The
   *  flag renders values through `formatValue`. */
  scrub?: boolean;
  testID?: string;
}

const PAD_LEFT = 6;
const PAD_RIGHT = 6;
const PAD_TOP = 14;
const LABEL_FONT_SIZE = 10;
/** grid-variant horizontal gridline fractions of the plot height. */
const GRID_FRACTIONS = [0.25, 0.5, 0.75] as const;

const VARIANT_LINE: Record<
  ChartVariant,
  { smooth: number | null; strokeWidth: number; fillTopOpacity: number }
> = {
  area: { smooth: 0.55, strokeWidth: 2.2, fillTopOpacity: 0.24 },
  grid: { smooth: null, strokeWidth: 1.6, fillTopOpacity: 0.24 },
  block: { smooth: null, strokeWidth: 3.5, fillTopOpacity: 0.16 },
  soft: { smooth: 0.85, strokeWidth: 3, fillTopOpacity: 0.34 },
};

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function LineChart({
  data,
  height = 180,
  stroke,
  variant: variantProp,
  showXAxis = true,
  showYTicks = false,
  showDots = false,
  animationKey,
  formatValue = String,
  maxXLabels = 6,
  accessibilityLabel,
  scrub = false,
  testID,
}: LineChartProps) {
  const theme = useTheme();
  const { width, onLayout } = useContainerWidth();
  // Per-instance gradient id: the prototype's variant+height id collides
  // when two same-variant charts of equal height mount (defs resolve
  // globally per page on web), so each instance gets a React useId.
  const gradientId = `lc-grad-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const ready = width > 0 && data.length > 0;
  const progress = useChartEntrance(animationKey, ready);

  const chart = resolveChartTheme(theme);
  const variant = variantProp ?? chart.variant;

  let content = null;
  if (ready) {
    const cfg = VARIANT_LINE[variant];
    const lineColor = stroke ?? chart.accent;
    const axisFont = svgFontProps(chart.fonts.mono, 400);
    const padBottom = showXAxis ? 22 : 8;
    const plotBottom = height - padBottom;
    const plotHeight = plotBottom - PAD_TOP;

    const values = data.map((point) => point.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    // Prototype look (showYTicks false): raw min/max domain so the curve
    // fills the full plot height. With ticks the domain widens to the nice
    // bounds exactly as the pre-restyle implementation did.
    const ticks = showYTicks ? niceTicks(rawMin, rawMax, 4) : [];
    const domainMin = ticks.length > 0 ? Math.min(...ticks) : rawMin;
    const domainMax = ticks.length > 0 ? Math.max(...ticks) : rawMax;
    const yScale = createLinearScale(domainMin, domainMax, plotBottom, PAD_TOP);
    const xFor = (index: number): number =>
      data.length === 1
        ? width / 2
        : PAD_LEFT + (index / (data.length - 1)) * (width - PAD_LEFT - PAD_RIGHT);

    const pts: ChartPoint[] = data.map((point, index) => ({
      x: xFor(index),
      y: yScale(point.value),
    }));
    const firstPt = pts[0];
    const lastPt = pts[pts.length - 1];
    const multiPoint = data.length > 1 && firstPt !== undefined && lastPt !== undefined;

    const lineD =
      cfg.smooth !== null ? smoothPath(pts, cfg.smooth) : linePath(pts);
    const areaD = multiPoint
      ? `${lineD} L ${lastPt.x.toFixed(2)} ${plotBottom.toFixed(2)}` +
        ` L ${firstPt.x.toFixed(2)} ${plotBottom.toFixed(2)} Z`
      : '';

    // Dash-draw entrance: no getTotalLength() on native, so the dash is the
    // chord length with a safety factor (charts.md 2.3 / 9.1).
    const drawLength = Number(
      (polylineLength(pts) * CURVE_LENGTH_FACTOR).toFixed(2),
    );
    const dashOffset = progress.interpolate({
      inputRange: [100 / CHART_ENTRANCE_MS, 1100 / CHART_ENTRANCE_MS],
      outputRange: [drawLength, 0],
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      extrapolate: 'clamp',
    });
    const areaOpacity = progress.interpolate({
      inputRange: [450 / CHART_ENTRANCE_MS, 1],
      outputRange: [0, 1],
      easing: Easing.ease,
      extrapolate: 'clamp',
    });

    const labelIndexes = sampledLabelIndexes(data.length, maxXLabels);
    const dots = showDots || data.length === 1;

    let marker = null;
    if (!dots && multiPoint) {
      if (variant === 'grid') {
        marker = (
          <Rect
            x={lastPt.x - 3}
            y={lastPt.y - 3}
            width={6}
            height={6}
            fill={lineColor}
          />
        );
      } else if (variant === 'soft') {
        marker = (
          <G>
            <Circle
              cx={lastPt.x}
              cy={lastPt.y}
              r={9}
              fill={lineColor}
              opacity={0.18}
            />
            <Circle
              cx={lastPt.x}
              cy={lastPt.y}
              r={4}
              fill={lineColor}
              stroke={chart.surface}
              strokeWidth={2}
            />
          </G>
        );
      } else {
        marker = (
          <Circle
            cx={lastPt.x}
            cy={lastPt.y}
            r={variant === 'block' ? 4.5 : 4}
            fill={lineColor}
            stroke={chart.surface}
            strokeWidth={2}
          />
        );
      }
    }

    const scrubber =
      scrub && multiPoint ? (
        <ChartScrubber
          width={width}
          height={height}
          points={data.map((point, index) => ({
            x: (pts[index] as ChartPoint).x,
            y: (pts[index] as ChartPoint).y,
            label: point.label,
            lines: [formatValue(point.value)],
          }))}
          color={lineColor}
          topPad={PAD_TOP}
          bottomPad={padBottom}
          testID={testID !== undefined ? `${testID}-scrubber` : undefined}
        />
      ) : null;

    content = (
      <Svg width={width} height={height}>
        {variant === 'grid' && !showYTicks
          ? GRID_FRACTIONS.map((fraction) => {
              const y = PAD_TOP + fraction * plotHeight;
              return (
                <Line
                  key={`grid-${fraction}`}
                  x1={PAD_LEFT}
                  x2={width - PAD_RIGHT}
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
                  x1={PAD_LEFT}
                  x2={width - PAD_RIGHT}
                  y1={yScale(tick)}
                  y2={yScale(tick)}
                  stroke={chart.grid}
                  strokeWidth={1}
                />
                <SvgText
                  x={PAD_LEFT}
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
        {multiPoint ? (
          <G>
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <Stop
                  offset="0"
                  stopColor={lineColor}
                  stopOpacity={cfg.fillTopOpacity}
                />
                <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <AnimatedPath
              d={areaD}
              fill={`url(#${gradientId})`}
              fillOpacity={areaOpacity}
            />
            <AnimatedPath
              d={lineD}
              stroke={lineColor}
              strokeWidth={cfg.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              strokeDasharray={`${drawLength} ${drawLength}`}
              strokeDashoffset={dashOffset}
            />
          </G>
        ) : null}
        {dots
          ? data.map((point, index) => (
              <Circle
                key={`dot-${index}-${point.label}`}
                cx={xFor(index)}
                cy={yScale(point.value)}
                r={3}
                fill={lineColor}
              />
            ))
          : marker}
        {showXAxis
          ? data.map((point, index) =>
              labelIndexes.has(index) ? (
                <SvgText
                  key={`x-${index}-${point.label}`}
                  x={xFor(index)}
                  y={height - 6}
                  fontSize={LABEL_FONT_SIZE}
                  fill={chart.faint}
                  {...axisFont}
                  textAnchor={
                    index === 0
                      ? 'start'
                      : index === data.length - 1
                        ? 'end'
                        : 'middle'
                  }
                >
                  {point.label}
                </SvgText>
              ) : null,
            )
          : null}
      </Svg>
    );
    if (scrubber !== null) {
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
