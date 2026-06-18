/**
 * Crosshair scrubber overlay (PHASE9-DECISIONS P9-2 item 5): ONE component
 * serves web hover and native touch-drag (chartPointerProps). It snaps the
 * pointer to the nearest data index (nearestIndexForX), then draws a
 * vertical hairline, an optional point dot, and a value flag with the
 * point's label + pre-formatted lines (money formatting stays outside the
 * kit, charts.md money rule).
 *
 * Pure positional state feedback -- nothing here is timed motion -- so the
 * scrubber stays fully live under reduced motion (P9-1: state feedback
 * survives). Renders only the snapped index, so pointer moves inside one
 * snap region cost zero re-renders.
 */
import { useState } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';

import { useTheme } from '../ThemeProvider';
import { nearestIndexForX } from './chartMath';
import { chartPointerProps } from './chartPointer';
import {
  resolveChartTheme,
  svgFontProps,
  type SvgFontProps,
} from './chartTheme';

export interface ScrubPoint {
  /** Pixel center of this index. */
  x: number;
  /** Dot anchor; omit (bar charts) to draw hairline + flag only. */
  y?: number;
  /** Eyebrow label (the x-axis category, e.g. "Jun 8"). */
  label: string;
  /** Pre-formatted flag lines (e.g. ["$1,234.56"] or per-series lines). */
  lines: readonly string[];
}

export interface ChartScrubberProps {
  width: number;
  height: number;
  points: readonly ScrubPoint[];
  /** Series color for the dot. */
  color: string;
  /** Crosshair vertical extent (the chart's plot paddings). */
  topPad?: number;
  bottomPad?: number;
  testID?: string;
}

const FLAG_OFFSET = 8;
const DOT_SIZE = 10;

/** SVG font props -> RN TextStyle (same family/weight selection rules). */
function textFontStyle(props: SvgFontProps): TextStyle {
  const style: TextStyle = {};
  if (props.fontFamily !== undefined) style.fontFamily = props.fontFamily;
  if (props.fontWeight !== undefined) {
    style.fontWeight = props.fontWeight as TextStyle['fontWeight'];
  }
  return style;
}

export function ChartScrubber({
  width,
  height,
  points,
  color,
  topPad = 0,
  bottomPad = 0,
  testID,
}: ChartScrubberProps) {
  const theme = useTheme();
  const chart = resolveChartTheme(theme);
  const [active, setActive] = useState<number | null>(null);

  const pointerProps = chartPointerProps((x) => {
    const index = nearestIndexForX(
      x,
      points.map((point) => point.x),
    );
    setActive((previous) => (previous === index ? previous : index));
  }, () => setActive(null));

  const point = active !== null ? points[active] : undefined;

  const eyebrowFont = textFontStyle(svgFontProps(chart.fonts.sans, 400));
  const valueFont = textFontStyle(svgFontProps(chart.fonts.mono, 600));

  return (
    <View
      style={StyleSheet.absoluteFill}
      testID={testID}
      accessible={false}
      importantForAccessibility="no"
      {...pointerProps}
    >
      {point !== undefined ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View
            style={{
              position: 'absolute',
              left: point.x - 0.5,
              top: topPad,
              width: 1,
              height: Math.max(0, height - topPad - bottomPad),
              backgroundColor: chart.dim,
              opacity: 0.6,
            }}
          />
          {point.y !== undefined ? (
            <View
              style={{
                position: 'absolute',
                left: point.x - DOT_SIZE / 2,
                top: point.y - DOT_SIZE / 2,
                width: DOT_SIZE,
                height: DOT_SIZE,
                borderRadius: DOT_SIZE / 2,
                backgroundColor: color,
                borderWidth: 2,
                borderColor: chart.surface,
              }}
            />
          ) : null}
          {/* Value flag: side-flips past the midline so it never leaves the
              chart, no measurement pass needed. */}
          <View
            testID={testID !== undefined ? `${testID}-flag` : undefined}
            style={[
              styles.flag,
              {
                top: Math.max(0, topPad - 4),
                backgroundColor: chart.surface,
                borderColor: chart.border,
              },
              point.x <= width / 2
                ? { left: point.x + FLAG_OFFSET }
                : { right: width - point.x + FLAG_OFFSET },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.flagLabel, { color: chart.faint }, eyebrowFont]}
            >
              {point.label}
            </Text>
            {point.lines.map((line, index) => (
              <Text
                key={`line-${index}`}
                numberOfLines={1}
                style={[styles.flagValue, { color: chart.text }, valueFont]}
              >
                {line}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
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
    maxWidth: 220,
  },
  flagLabel: { fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
  flagValue: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
