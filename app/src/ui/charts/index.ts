/**
 * Chart primitives (react-native-svg, no heavy chart lib -- P7-4; restyled
 * per ops/design-spec/charts.md). Feature code imports from this barrel:
 * ../../src/ui/charts
 */
export { LineChart, type LineChartPoint, type LineChartProps } from './LineChart';
export {
  BarChart,
  type BarChartBar,
  type BarChartGroup,
  type BarChartProps,
} from './BarChart';
export { FlowDiagram, type FlowNode, type FlowDiagramProps } from './FlowDiagram';
export {
  DonutChart,
  type DonutChartProps,
  type DonutSegment,
} from './DonutChart';
export { ProgressRing, type ProgressRingProps } from './ProgressRing';
export {
  CURVE_LENGTH_FACTOR,
  createLinearScale,
  donutSegments,
  linePath,
  niceTicks,
  polylineLength,
  ringDashOffset,
  sampledLabelIndexes,
  smoothPath,
  type ChartPoint,
  type ChartVariant,
  type DonutSegmentGeometry,
  type LinearScale,
} from './chartMath';
export { categoryColor } from './categoryColor';
export { trendSeriesColors, type TrendSeriesColors } from './seriesColors';
export {
  DEFAULT_CATEGORY_OTHER,
  DEFAULT_CATEGORY_PALETTE,
  resolveChartTheme,
  svgFontProps,
  type ChartFontToken,
  type ChartTheme,
  type ChartThemeSource,
  type FontCutSetLike,
  type SvgFontProps,
} from './chartTheme';
export { CHART_ENTRANCE_MS, useChartEntrance } from './useChartEntrance';
