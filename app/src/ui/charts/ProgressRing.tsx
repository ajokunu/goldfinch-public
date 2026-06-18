/**
 * Goal progress ring primitive (react-native-svg), per design-spec/charts.md
 * section 7. Variant-independent (direction differences are size/stroke at
 * the call site). The ring sweeps in with a slight overshoot on mount
 * (prototype ringFill, charts.md 9.1).
 *
 * Money/percent rule: `fraction` is layout-only; the announced figure is the
 * SERVER-computed `percentComplete` (GoalDto), never recomputed client-side.
 * Accessibility semantics are identical to the shipped GoalProgressBar.
 */
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';

import { useTheme } from '../ThemeProvider';
import { ringDashOffset } from './chartMath';
import { resolveChartTheme, svgFontProps } from './chartTheme';
import { CHART_ENTRANCE_MS, useChartEntrance } from './useChartEntrance';

export interface ProgressRingProps {
  /** Fraction 0..1; values > 1 clamp to a full ring
   *  (server percentComplete / 100). */
  fraction: number;
  size?: number;
  strokeWidth?: number;
  /** Progress color; defaults to the theme accent. */
  color?: string;
  /** Pre-formatted center label, e.g. `${percentComplete}%`. */
  label?: string;
  /** For accessibilityValue.now; may exceed 100 (server semantics). */
  percentComplete: number;
  testID?: string;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function ProgressRing({
  fraction,
  size = 64,
  strokeWidth = 7,
  color,
  label,
  percentComplete,
  testID,
}: ProgressRingProps) {
  const theme = useTheme();
  const progress = useChartEntrance(undefined, true);

  const chart = resolveChartTheme(theme);
  const ringColor = color ?? chart.accent;

  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const restingOffset = ringDashOffset(fraction, circumference);

  // Sweep C -> resting offset; the 1.2 bezier overshoots slightly past the
  // target and settles (prototype ringFill 1.1s + 0.15s delay).
  const animatedOffset = progress.interpolate({
    inputRange: [150 / CHART_ENTRANCE_MS, 1],
    outputRange: [circumference, restingOffset],
    easing: Easing.bezier(0.34, 1.2, 0.4, 1),
    extrapolate: 'clamp',
  });

  const labelFont = svgFontProps(chart.fonts.display, 700);

  return (
    <View
      style={{ width: size, height: size }}
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.min(percentComplete, 100),
      }}
    >
      <Svg width={size} height={size}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={chart.surfaceAlt}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={center}
          cy={center}
          r={radius}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference.toFixed(2)} ${circumference.toFixed(2)}`}
          strokeDashoffset={animatedOffset}
          strokeLinecap="round"
          fill="none"
          transform={`rotate(-90 ${center} ${center})`}
        />
        {label !== undefined ? (
          <SvgText
            x={center}
            y={center + 4}
            fontSize={size * 0.22}
            fill={chart.text}
            {...labelFont}
            textAnchor="middle"
          >
            {label}
          </SvgText>
        ) : null}
      </Svg>
    </View>
  );
}
