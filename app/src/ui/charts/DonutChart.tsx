/**
 * Donut spending-breakdown primitive (react-native-svg), per
 * design-spec/charts.md section 5. Segments are stroked circle arcs built
 * from `donutSegments` dash geometry, rotated -90deg so the first segment
 * starts at 12 o'clock. Per-direction treatment:
 *
 * - soft  (halo):   thickness 0.16 size, round segment caps
 * - block (studio): thickness 0.20 size, no inter-segment gaps
 * - area/grid:      thickness 0.13 size, 2deg gaps, butt caps
 *
 * Money rule: `value` is a positive magnitude in minor units used ONLY for
 * arc layout; `centerTop` / `centerMain` / `label` arrive pre-formatted
 * (e.g. via formatMinorAmountCompact) -- money formatting stays outside the
 * kit. The caller sorts segments descending and filters value > 0; an
 * all-zero total renders just the track (the consuming card gates truly
 * empty months behind its EmptyState). Legend layout is the screen's
 * concern (5.4).
 *
 * Interaction (PHASE9-DECISIONS P9-2 item 4): with `interactive`, web hover
 * and native touch share one pointer stream (chartPointerProps); the hit
 * segment swells (stroke widens ~18%, 160ms) and shows its pre-formatted
 * value flag. The swell is movement and dies under reduced motion / the
 * multiplier kill switch; the flag is state feedback and stays.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';

import { useTheme } from '../ThemeProvider';
import { moveDuration } from '../motion/motionMath';
import { durations } from '../motion/tokens';
import { useMotionSettings } from '../motion/useMotionSettings';
import {
  donutHitSegment,
  donutSegmentMidAngle,
  donutSegments,
  type ChartVariant,
} from './chartMath';
import { chartPointerProps } from './chartPointer';
import { resolveChartTheme, svgFontProps } from './chartTheme';
import { CHART_ENTRANCE_MS, useChartEntrance } from './useChartEntrance';

export interface DonutSegment {
  /** Positive magnitude in minor units (layout-only number). */
  value: number;
  color: string;
  /** Pre-formatted value-flag text (e.g. "Groceries · $421.50"); the flag
   *  renders only for segments that carry one. */
  label?: string;
}

export interface DonutChartProps {
  /** Caller sorts desc and filters value > 0. */
  segments: readonly DonutSegment[];
  /** Outer diameter; default 168 (dashboard passes 132). */
  size?: number;
  /** Ring thickness; defaults to the variant table above. */
  thickness?: number;
  /** Pin a treatment (tests/one-offs); defaults to the theme's variant. */
  variant?: ChartVariant;
  /** Pre-formatted eyebrow above the figure (e.g. "Spent"); uppercased in
   *  code because SVG textTransform is unsupported. */
  centerTop?: string;
  /** Pre-formatted center figure (e.g. a compact money total). */
  centerMain?: string;
  /** Required summary for screen readers (charts.md 5.6). */
  accessibilityLabel: string;
  /** Re-runs the entrance animation when it changes (month toggles). */
  animationKey?: string | number;
  /** Hover/touch segment swell + value flag (P9-2 item 4). */
  interactive?: boolean;
  testID?: string;
}

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Swollen stroke factor while a segment is hovered/touched. */
const SWELL_FACTOR = 1.18;

export function DonutChart({
  segments,
  size = 168,
  thickness,
  variant: variantProp,
  centerTop,
  centerMain,
  accessibilityLabel,
  animationKey,
  interactive = false,
  testID,
}: DonutChartProps) {
  const theme = useTheme();
  const settings = useMotionSettings();
  const progress = useChartEntrance(animationKey, true);

  const chart = resolveChartTheme(theme);
  const variant = variantProp ?? chart.variant;

  const r = size / 2;
  const strokeWidth =
    thickness ??
    size * (variant === 'soft' ? 0.16 : variant === 'block' ? 0.2 : 0.13);
  const radius = r - strokeWidth / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const gapDegrees = variant === 'block' ? 0 : 2;
  const linecap = variant === 'soft' ? 'round' : 'butt';

  const values = segments.map((segment) => segment.value);
  const geometry = donutSegments(values, circumference, gapDegrees);

  // ---- pointer interaction (P9-2 item 4) ----------------------------------
  const [active, setActive] = useState<number | null>(null);
  // The last hit segment keeps its Animated stroke binding while the swell
  // animates back out after the pointer leaves.
  const lastHitRef = useRef(0);
  const swell = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const duration = moveDuration(durations.hover, settings);
    if (duration === 0) {
      // Reduced motion / kill switch: no swell movement ever (the value
      // flag still tracks the pointer -- state feedback survives, P9-1).
      swell.setValue(0);
      return undefined;
    }
    const animation = Animated.timing(swell, {
      toValue: active !== null ? 1 : 0,
      duration,
      easing: Easing.ease,
      // SVG props are not native-driver animatable (charts.md 9.1).
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [active, settings, swell]);

  const pointerProps = interactive
    ? chartPointerProps(
        (x, y) => {
          const hit = donutHitSegment(x - r, y - r, radius, strokeWidth, values);
          if (hit !== null) lastHitRef.current = hit;
          setActive((previous) => (previous === hit ? previous : hit));
        },
        () => setActive(null),
      )
    : undefined;

  const swollenIndex = interactive ? lastHitRef.current : null;
  const swollenStrokeWidth = swell.interpolate({
    inputRange: [0, 1],
    outputRange: [strokeWidth, strokeWidth * SWELL_FACTOR],
  });

  const segmentsOpacity = progress.interpolate({
    inputRange: [0, 600 / CHART_ENTRANCE_MS],
    outputRange: [0, 1],
    easing: Easing.ease,
    extrapolate: 'clamp',
  });

  const centerTopSize = size * 0.078;
  const centerTopFont = svgFontProps(chart.fonts.sans, 400);
  const centerMainFont = svgFontProps(chart.fonts.display, 700);

  const renderSegment = (index: number) => {
    const segment = segments[index];
    const geo = geometry[index];
    if (segment === undefined || geo === undefined) return null;
    const shared = {
      cx: r,
      cy: r,
      r: radius,
      stroke: segment.color,
      strokeDasharray: geo.dash as unknown as number[],
      strokeDashoffset: geo.offset,
      strokeLinecap: linecap,
      fill: 'none',
      transform: `rotate(-90 ${r} ${r})`,
    } as const;
    if (index === swollenIndex) {
      return (
        <AnimatedCircle
          key={`segment-${index}`}
          {...shared}
          strokeWidth={swollenStrokeWidth}
        />
      );
    }
    return (
      <Circle key={`segment-${index}`} {...shared} strokeWidth={strokeWidth} />
    );
  };

  // ---- value flag ----------------------------------------------------------
  const activeSegment = active !== null ? segments[active] : undefined;
  const midAngle = active !== null ? donutSegmentMidAngle(values, active) : null;
  let flag = null;
  if (
    interactive &&
    activeSegment?.label !== undefined &&
    midAngle !== null
  ) {
    const fx = r + Math.sin(midAngle) * radius;
    const fy = r - Math.cos(midAngle) * radius;
    flag = (
      <View
        pointerEvents="none"
        testID={testID !== undefined ? `${testID}-flag` : undefined}
        style={[
          styles.flag,
          { backgroundColor: chart.surface, borderColor: chart.border },
          // Anchored toward the chart interior so it stays in bounds.
          fy <= r ? { top: fy + 6 } : { top: fy - 32 },
          fx <= r
            ? { left: Math.max(0, fx + 6) }
            : { right: Math.max(0, size - fx + 6) },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.flagText,
            { color: chart.text },
            centerTopFont.fontFamily !== undefined
              ? { fontFamily: centerTopFont.fontFamily }
              : null,
          ]}
        >
          {activeSegment.label}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{ width: size, height: size }}
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      {...(pointerProps ?? {})}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={r}
          cy={r}
          r={radius}
          stroke={chart.surfaceAlt}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedG opacity={segmentsOpacity}>
          {/* The swollen segment paints last so its widened stroke stays on
              top of its neighbors. */}
          {segments.map((_, index) =>
            index === swollenIndex ? null : renderSegment(index),
          )}
          {swollenIndex !== null ? renderSegment(swollenIndex) : null}
        </AnimatedG>
        {centerMain !== undefined ? (
          <G>
            {centerTop !== undefined ? (
              <SvgText
                x={r}
                y={r - 4}
                fontSize={centerTopSize}
                fill={chart.faint}
                {...centerTopFont}
                letterSpacing={centerTopSize * 0.06}
                textAnchor="middle"
              >
                {centerTop.toUpperCase()}
              </SvgText>
            ) : null}
            <SvgText
              x={r}
              y={r + size * 0.085}
              fontSize={size * 0.13}
              fill={chart.text}
              {...centerMainFont}
              textAnchor="middle"
            >
              {centerMain}
            </SvgText>
          </G>
        ) : null}
      </Svg>
      {flag}
    </View>
  );
}

const styles = StyleSheet.create({
  flag: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 200,
  },
  flagText: { fontSize: 11.5, fontVariant: ['tabular-nums'] },
});
