/**
 * Pure data transforms behind the Reports screen (PHASE7-DECISIONS P7-4),
 * grouped strictly per currency (P7-7: per-currency subtotals whenever more
 * than one currency exists, never a synthetic mixed-currency total).
 *
 * Money rule: every value here is integer minor units straight from the API.
 * Money arithmetic is exact integer addition only (flow "Other" folding,
 * trend window totals; same currency by construction) -- no floats, no
 * currency conversion. The single division lives in netWorthChange and is a
 * display-only percent ratio that never feeds back into a money value.
 */
import type {
  CurrencyCode,
  FlowCurrencyGroupDto,
  IsoDate,
  IsoMonth,
  MinorUnits,
  NetWorthSnapshotDto,
  ReportsFlowResponse,
  TrendMonthDto,
} from '@goldfinch/shared/types';

import { toIsoDate } from '../../../src/lib/dates';

// ---------------------------------------------------------------------------
// Net-worth history (line chart)
// ---------------------------------------------------------------------------

export interface NetWorthSeriesPoint {
  date: IsoDate;
  assetsMinor: MinorUnits;
  liabilitiesMinor: MinorUnits;
  netMinor: MinorUnits;
}

export interface NetWorthCurrencySeries {
  currency: CurrencyCode;
  /** Date-ascending; never empty (a series only exists once it has a point). */
  points: NetWorthSeriesPoint[];
  /** Most recent point (the last one after the date sort). */
  latest: NetWorthSeriesPoint;
}

/**
 * One line-chart series per currency seen anywhere in the snapshot history.
 * Every snapshot's perCurrency array carries every currency including the
 * base one (NetWorthSnapshotItem contract), so the base currency is just
 * another series here. Snapshots missing a currency contribute no point for
 * it (the line simply connects the adjacent dates). Sorted by currency code.
 */
export function netWorthCurrencySeries(
  items: readonly NetWorthSnapshotDto[],
): NetWorthCurrencySeries[] {
  // Zero-padded IsoDate sorts lexicographically. The server returns ascending
  // order, but an out-of-order point would draw a silently wrong line, so we
  // re-sort defensively.
  const sorted = [...items].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  const byCurrency = new Map<CurrencyCode, NetWorthSeriesPoint[]>();
  for (const item of sorted) {
    for (const slice of item.perCurrency) {
      const points = byCurrency.get(slice.currency);
      const point: NetWorthSeriesPoint = {
        date: item.date,
        assetsMinor: slice.assetsMinor,
        liabilitiesMinor: slice.liabilitiesMinor,
        netMinor: slice.netMinor,
      };
      if (points) {
        points.push(point);
      } else {
        byCurrency.set(slice.currency, [point]);
      }
    }
  }

  const series: NetWorthCurrencySeries[] = [];
  const currencies = [...byCurrency.keys()].sort();
  for (const currency of currencies) {
    const points = byCurrency.get(currency) ?? [];
    const latest = points[points.length - 1];
    // Unreachable by construction (a map entry is created with its first
    // point); the guard keeps the transform total under strict indexing.
    if (latest === undefined) continue;
    series.push({ currency, points, latest });
  }
  return series;
}

// ---------------------------------------------------------------------------
// Net-worth range slicing (design-spec/screens.md 4.2: client-side 3M/6M/1Y
// windows over the accrued history; honesty rule: a range whose window starts
// before firstSnapshotDate is not offered, so a chart never implies more
// history than exists)
// ---------------------------------------------------------------------------

export type NetWorthRangeKey = '3M' | '6M' | '1Y';

export const NET_WORTH_RANGE_OPTIONS: ReadonlyArray<{
  key: NetWorthRangeKey;
  label: string;
}> = [
  { key: '3M', label: '3M' },
  { key: '6M', label: '6M' },
  { key: '1Y', label: '1Y' },
];

const NET_WORTH_RANGE_MONTHS: Readonly<Record<NetWorthRangeKey, number>> = {
  '3M': 3,
  '6M': 6,
  '1Y': 12,
};

/**
 * Window start for a range key, as a local-calendar IsoDate. Pure given
 * `now`. Plain Date month arithmetic (e.g. May 31 - 3 months normalizes
 * into early March) is acceptable here: the result only slices snapshots,
 * never does money math.
 */
export function netWorthRangeStart(key: NetWorthRangeKey, now: Date): IsoDate {
  const shifted = new Date(
    now.getFullYear(),
    now.getMonth() - NET_WORTH_RANGE_MONTHS[key],
    now.getDate(),
  );
  return toIsoDate(shifted);
}

/**
 * Ranges whose full window is covered by the accrued history (window start on
 * or after the first snapshot). Availability is monotonic: if 1Y is available
 * the shorter windows are too. Preserves option order (3M, 6M, 1Y).
 */
export function availableNetWorthRanges(
  firstSnapshotDate: IsoDate,
  now: Date,
): NetWorthRangeKey[] {
  return NET_WORTH_RANGE_OPTIONS.filter(
    (option) => netWorthRangeStart(option.key, now) >= firstSnapshotDate,
  ).map((option) => option.key);
}

/**
 * The range actually applied: the selection when offered, otherwise the
 * longest available window (the closest honest approximation of a too-long
 * selection), or null when no range is offered (short history -> the chart
 * shows everything and the control is hidden).
 */
export function effectiveNetWorthRange(
  selected: NetWorthRangeKey,
  available: readonly NetWorthRangeKey[],
): NetWorthRangeKey | null {
  if (available.includes(selected)) return selected;
  return available.length > 0 ? (available[available.length - 1] ?? null) : null;
}

/** Points on or after the window start; the full series when start is null. */
export function sliceNetWorthPoints(
  points: readonly NetWorthSeriesPoint[],
  start: IsoDate | null,
): readonly NetWorthSeriesPoint[] {
  if (start === null) return points;
  return points.filter((point) => point.date >= start);
}

// ---------------------------------------------------------------------------
// Net-worth change pill (design-spec/screens.md 4.2 honesty rule)
// ---------------------------------------------------------------------------

export interface NetWorthChange {
  /** Signed display percent, e.g. "+9.0%" / "-3.2%". */
  pctLabel: string;
  negative: boolean;
  /** 'ytd' when a snapshot at or before Jan 1 of the current year exists. */
  kind: 'ytd' | 'since';
  /** The baseline snapshot's date (the series start for 'since'). */
  baselineDate: IsoDate;
}

/**
 * Change-pill math for one currency series (date-ascending points).
 *
 * - "% YTD" only when a snapshot at or before `yearStart` (Jan 1 of the
 *   current year) exists; the baseline is the latest such snapshot.
 * - Otherwise "% since {first point}" with the series' own first snapshot
 *   as the baseline.
 * - Hidden (null) with fewer than two snapshots, a zero baseline (no
 *   percent is computable), or when the baseline IS the latest point.
 *
 * The division is display-only ratio math on integer minor units -- it never
 * feeds back into a money value (P7-7 money rules untouched).
 */
export function netWorthChange(
  points: readonly NetWorthSeriesPoint[],
  yearStart: IsoDate,
): NetWorthChange | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  if (latest === undefined) return null;

  let ytdBaseline: NetWorthSeriesPoint | undefined;
  for (const point of points) {
    if (point.date <= yearStart) {
      ytdBaseline = point;
    } else {
      break;
    }
  }
  const kind: NetWorthChange['kind'] = ytdBaseline !== undefined ? 'ytd' : 'since';
  const baseline = ytdBaseline ?? points[0];
  if (baseline === undefined || baseline === latest) return null;
  if (baseline.netMinor === 0) return null;

  const pct =
    ((latest.netMinor - baseline.netMinor) / Math.abs(baseline.netMinor)) * 100;
  if (!Number.isFinite(pct)) return null;
  let rounded = pct.toFixed(1);
  if (rounded === '-0.0') rounded = '0.0';
  const negative = rounded.startsWith('-');
  return {
    pctLabel: negative ? `${rounded}%` : `+${rounded}%`,
    negative,
    kind,
    baselineDate: baseline.date,
  };
}

// ---------------------------------------------------------------------------
// Monthly trends (grouped bars)
// ---------------------------------------------------------------------------

export interface TrendCurrencyMonth {
  month: IsoMonth;
  /** Positive magnitude (PerCurrencyCashflow semantics). */
  incomeMinor: MinorUnits;
  /** Positive magnitude. */
  expenseMinor: MinorUnits;
  /** Signed: income - expense. */
  netMinor: MinorUnits;
}

export interface TrendCurrencyGroup {
  currency: CurrencyCode;
  /** One entry per window month, zero-filled where the API had no slice. */
  months: TrendCurrencyMonth[];
}

/**
 * Regroup the API's month-major response (TrendMonthDto.perCurrency) into
 * currency-major chart series. Months where a currency saw no activity are
 * zero-filled so every currency's bars line up on the same x axis. Sorted by
 * currency code.
 */
export function trendCurrencyGroups(
  months: readonly TrendMonthDto[],
): TrendCurrencyGroup[] {
  const currencies = new Set<CurrencyCode>();
  for (const month of months) {
    for (const slice of month.perCurrency) currencies.add(slice.currency);
  }

  return [...currencies].sort().map((currency) => ({
    currency,
    months: months.map((month) => {
      const slice = month.perCurrency.find((entry) => entry.currency === currency);
      return {
        month: month.month,
        incomeMinor: slice?.incomeMinor ?? 0,
        expenseMinor: slice?.expenseMinor ?? 0,
        netMinor: slice?.netMinor ?? 0,
      };
    }),
  }));
}

/** True when no currency saw any activity anywhere in the window. */
export function trendsAreEmpty(months: readonly TrendMonthDto[]): boolean {
  return months.every((month) => month.perCurrency.length === 0);
}

export interface TrendGroupTotals {
  /** Positive magnitude. */
  incomeMinor: MinorUnits;
  /** Positive magnitude. */
  expenseMinor: MinorUnits;
  /** Signed: income - expense over the window. */
  netMinor: MinorUnits;
}

/**
 * Window totals for one currency group (design-spec/screens.md 4.3 totals
 * row: Total income / Total spent / Saved). Exact integer addition of minor
 * units, same currency by construction (the P7-7 sanctioned aggregation).
 */
export function trendGroupTotals(
  months: readonly TrendCurrencyMonth[],
): TrendGroupTotals {
  let incomeMinor = 0;
  let expenseMinor = 0;
  let netMinor = 0;
  for (const month of months) {
    incomeMinor += month.incomeMinor;
    expenseMinor += month.expenseMinor;
    netMinor += month.netMinor;
  }
  return { incomeMinor, expenseMinor, netMinor };
}

// ---------------------------------------------------------------------------
// Income -> category flow (two-column sankey)
// ---------------------------------------------------------------------------

export type FlowTargetKind = 'category' | 'other' | 'unallocated';

export interface FlowTarget {
  label: string;
  /** Positive magnitude in minor units. */
  valueMinor: MinorUnits;
  kind: FlowTargetKind;
  /**
   * The category id for 'category' targets (null = the API's uncategorized
   * bucket, which takes the palette's "other" slot per screens.md 0.3);
   * always null for the synthetic 'other' / 'unallocated' nodes.
   */
  categoryId: string | null;
}

/**
 * Right-column node cap. Beyond it the smallest categories fold into one
 * "Other" node so the 11px node labels stay legible at FlowDiagram heights.
 */
export const FLOW_MAX_CATEGORY_NODES = 8;

/**
 * Build the FlowDiagram target column for one currency group:
 * - categories come from the server as positive magnitudes sorted desc;
 *   both properties are re-enforced here so a contract drift cannot draw a
 *   nonsense diagram,
 * - when there are more than `maxCategoryNodes` categories, the top
 *   (maxCategoryNodes - 1) stay individual and the rest fold into "Other"
 *   (exact integer minor-unit addition, same currency by construction),
 * - a positive month remainder (netMinor = income - expense) becomes an
 *   explicit "Unallocated" node, per the FlowDiagram contract that callers
 *   add their own remainder node.
 */
export function buildFlowTargets(
  group: FlowCurrencyGroupDto,
  maxCategoryNodes: number = FLOW_MAX_CATEGORY_NODES,
): FlowTarget[] {
  const positive = group.categories
    .filter((category) => category.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor);

  const targets: FlowTarget[] = [];
  if (positive.length <= maxCategoryNodes) {
    for (const category of positive) {
      targets.push({
        label: category.categoryName,
        valueMinor: category.amountMinor,
        kind: 'category',
        categoryId: category.categoryId,
      });
    }
  } else {
    for (const category of positive.slice(0, maxCategoryNodes - 1)) {
      targets.push({
        label: category.categoryName,
        valueMinor: category.amountMinor,
        kind: 'category',
        categoryId: category.categoryId,
      });
    }
    let otherMinor = 0;
    for (const category of positive.slice(maxCategoryNodes - 1)) {
      otherMinor += category.amountMinor;
    }
    targets.push({
      label: 'Other',
      valueMinor: otherMinor,
      kind: 'other',
      categoryId: null,
    });
  }

  if (group.netMinor > 0) {
    targets.push({
      label: 'Unallocated',
      valueMinor: group.netMinor,
      kind: 'unallocated',
      categoryId: null,
    });
  }
  return targets;
}

/**
 * Truncate a node label before handing it to FlowDiagram (charts.md 6.3:
 * SVG text does not wrap; consumers truncate). U+2026 ellipsis, not emoji.
 */
export function truncateFlowLabel(label: string, max = 16): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1).trimEnd()}…`;
}

/** True when the group has anything to draw (income or category spend). */
export function flowGroupHasContent(group: FlowCurrencyGroupDto): boolean {
  return (
    group.incomeMinor > 0 ||
    group.categories.some((category) => category.amountMinor > 0)
  );
}

/** True when the whole month has no drawable flow in any currency. */
export function flowIsEmpty(response: ReportsFlowResponse): boolean {
  return !response.perCurrency.some(flowGroupHasContent);
}
