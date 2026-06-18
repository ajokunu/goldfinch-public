/**
 * Two-column flow (sankey-style) diagram primitive (react-native-svg),
 * restyled per design-spec/charts.md section 6: the left income bar stays
 * PROPORTIONAL (the honest income bar) while right-hand target nodes sit in
 * EVENLY SPACED slots with two-line labels (name over amount) to the RIGHT
 * of the nodes, so label legibility is a direct function of height / n.
 *
 * Contract (unchanged):
 * - Values are positive magnitudes (ReportsFlowResponse semantics). Targets
 *   with value <= 0 are not drawn (a zero-width ribbon is meaningless).
 * - Callers wanting an explicit remainder add their own "Unallocated"
 *   target (buildFlowTargets does). In deficit months the left bar
 *   represents total outflow; the figures row above the diagram carries the
 *   reconciliation (charts.md 6.2).
 * - Per-currency: render one FlowDiagram per currency group, never mixed.
 * - Labels come pre-formatted (build money text via formatMinorAmount);
 *   consumers truncate long names before passing them (charts.md 6.3).
 * - `source.label`/`source.value` are no longer drawn in-SVG (charts.md
 *   6.4); income context lives in the consumer's figures row and in the
 *   accessibilityLabel. The prop shape is kept so call sites keep working.
 */
import { Animated, Easing, View } from 'react-native';
import Svg, { G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { useTheme } from '../ThemeProvider';
import { type ChartVariant } from './chartMath';
import { resolveChartTheme, svgFontProps } from './chartTheme';
import { CHART_ENTRANCE_MS, useChartEntrance } from './useChartEntrance';
import { useContainerWidth } from './useContainerWidth';

export interface FlowNode {
  label: string;
  /** Positive magnitude (e.g. expenseMinor for a category). */
  value: number;
  /** Node/ribbon color; defaults derive from the theme. */
  color?: string;
}

export interface FlowDiagramProps {
  /** Left column context (e.g. the month's income). Used for accessibility
   *  only; the left bar's geometry derives from the targets (charts.md 6.2). */
  source: FlowNode;
  /** Right column (e.g. spend per category, sorted desc by the caller). */
  targets: readonly FlowNode[];
  height?: number;
  /** Pin a treatment (tests/one-offs); defaults to the theme's variant. */
  variant?: ChartVariant;
  /** Pre-formatted value label for the amount line under each name. */
  formatValue?: (value: number) => string;
  /** Re-runs the entrance animation when it changes (month toggles). */
  animationKey?: string | number;
  /** Diagram summary for screen readers (charts.md 6.6). Optional until
   *  every consumer passes one (the restyled screens must). */
  accessibilityLabel?: string;
  testID?: string;
}

const LABEL_COLUMN_WIDTH = 112;
const PAD_VERTICAL = 8;
const LEFT_X = 4;

const AnimatedG = Animated.createAnimatedComponent(G);

const fx = (value: number): string => value.toFixed(2);

export function FlowDiagram({
  source,
  targets,
  height = 220,
  variant: variantProp,
  formatValue = String,
  animationKey,
  accessibilityLabel,
  testID,
}: FlowDiagramProps) {
  const theme = useTheme();
  const { width, onLayout } = useContainerWidth();

  const drawableTargets = targets.filter((target) => target.value > 0);
  const n = drawableTargets.length;
  const ready = width > 0 && n > 0;
  const progress = useChartEntrance(animationKey, ready);

  const chart = resolveChartTheme(theme);
  const variant = variantProp ?? chart.variant;
  // `source` participates only in the caller-built accessibility string; the
  // void reference documents that the prop is intentionally not rendered.
  void source;

  let content = null;
  const nodeWidth = variant === 'block' ? 16 : 11;
  const rightX = width - LABEL_COLUMN_WIDTH - nodeWidth;
  const ribbonStartX = LEFT_X + nodeWidth;
  // Defensive: below ~150px there is no room for ribbons between the
  // columns; render the empty box rather than inverted geometry.
  if (ready && rightX > ribbonStartX + 8) {
    const round = variant === 'soft' ? 5 : variant === 'block' ? 0 : 3;
    const ribbonOpacity = variant === 'block' ? 0.4 : 0.24;
    const plotHeight = height - PAD_VERTICAL * 2;
    const slotHeight = plotHeight / n;
    const total = drawableTargets.reduce((sum, target) => sum + target.value, 0);
    const midX = (ribbonStartX + rightX) / 2;
    const nameFont = svgFontProps(chart.fonts.sans, 600);
    const amountFont = svgFontProps(chart.fonts.mono, 400);

    // Left column: proportional slices walking down the bar. Right column:
    // even slots centered at rcy (charts.md 6.2).
    let cursor = PAD_VERTICAL;
    const segments = drawableTargets.map((target, index) => {
      const sliceHeight = (target.value / total) * plotHeight;
      const y0 = cursor;
      const y1 = cursor + sliceHeight;
      cursor = y1;
      const rcy = PAD_VERTICAL + index * slotHeight + slotHeight / 2;
      const nodeHeight = Math.max(2, Math.min(slotHeight - 11, 16));
      const ry0 = rcy - nodeHeight / 2;
      const ry1 = rcy + nodeHeight / 2;
      return {
        key: `${index}-${target.label}`,
        target,
        color: target.color ?? chart.accent,
        y0,
        y1,
        sliceHeight,
        rcy,
        nodeHeight,
        ry0,
        ry1,
      };
    });

    const groupOpacity = progress.interpolate({
      inputRange: [0, 600 / CHART_ENTRANCE_MS],
      outputRange: [0, 1],
      easing: Easing.ease,
      extrapolate: 'clamp',
    });

    content = (
      <Svg width={width} height={height}>
        <AnimatedG opacity={groupOpacity}>
          {segments.map((segment) => {
            const d =
              `M ${fx(ribbonStartX)} ${fx(segment.y0)} ` +
              `C ${fx(midX)} ${fx(segment.y0)} ${fx(midX)} ${fx(segment.ry0)} ${fx(rightX)} ${fx(segment.ry0)} ` +
              `L ${fx(rightX)} ${fx(segment.ry1)} ` +
              `C ${fx(midX)} ${fx(segment.ry1)} ${fx(midX)} ${fx(segment.y1)} ${fx(ribbonStartX)} ${fx(segment.y1)} Z`;
            return (
              <Path
                key={`ribbon-${segment.key}`}
                d={d}
                fill={segment.color}
                fillOpacity={ribbonOpacity}
              />
            );
          })}
        </AnimatedG>
        {segments.map((segment) => (
          <G key={`node-${segment.key}`}>
            <Rect
              x={rightX}
              y={segment.ry0}
              width={nodeWidth}
              height={segment.nodeHeight}
              fill={segment.color}
              rx={round}
            />
            <SvgText
              x={rightX + nodeWidth + 9}
              y={segment.rcy - 2.5}
              fontSize={11.5}
              fill={chart.text}
              {...nameFont}
              textAnchor="start"
            >
              {segment.target.label}
            </SvgText>
            <SvgText
              x={rightX + nodeWidth + 9}
              y={segment.rcy + 11}
              fontSize={10}
              fill={chart.faint}
              {...amountFont}
              textAnchor="start"
            >
              {formatValue(segment.target.value)}
            </SvgText>
          </G>
        ))}
        {/* Left bar slices are drawn AFTER all ribbons for crisp edges
            (prototype comment preserved, charts.md 6.2). */}
        {segments.map((segment) => (
          <Rect
            key={`source-${segment.key}`}
            x={LEFT_X}
            y={segment.y0}
            width={nodeWidth}
            height={Math.max(segment.sliceHeight - 1.6, 1)}
            fill={segment.color}
            rx={round}
          />
        ))}
      </Svg>
    );
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
