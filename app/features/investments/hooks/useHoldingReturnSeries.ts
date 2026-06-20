/**
 * Holding return-series hook (Investments chart).
 *
 * Fetches GET /accounts/{accountId}/holdings/{symbol}/price-history for the
 * selected range window, then NORMALIZES the price-per-share snapshots to a
 * % return series through the SHARED @goldfinch/shared/holdingReturn helpers
 * -- never inline (the single-source rule, same as holdingBasis / budgetMath).
 *
 * Range state lives here (default 1Y); switching a range recomputes the query
 * `from` bound (a month-shifted local-calendar date, mirroring the net-worth
 * range slicing) and refetches. `to` is omitted so the server defaults it to
 * today. ALL four ranges are always offered -- sparse/empty data is handled by
 * the chart's "History accrues from <firstSnapshotDate>" message, not by
 * gating ranges.
 *
 * `firstSnapshotDate` is the same global earliest-snapshot regardless of the
 * window, so it is LATCHED across range switches: each switch is a fresh
 * queryKey (the `from` differs) whose query is briefly pending with no data, so
 * reading it straight off the current query would flicker the caption to null
 * on every toggle. The ref captures the first non-null value seen and never
 * regresses.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  normalizeReturnSeries,
  windowReturnPercent,
  type ReturnPoint,
} from '@goldfinch/shared/holdingReturn';
import type { IsoDate } from '@goldfinch/shared/types';

import { holdingPriceHistory } from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';
import { logger } from '../../../src/lib/logger';
import { toIsoDate } from '../../../src/lib/dates';

/** Selectable trailing windows for the chart's range toggle. */
export type HoldingReturnRange = '1M' | '3M' | '6M' | '1Y';

/**
 * Canonical range-toggle options. This hook owns the single source so the
 * screen's toggle buttons import (never redefine) the set -- a divergent copy
 * would be the exact single-source drift the house rules forbid.
 */
export const RANGE_OPTIONS: ReadonlyArray<{ key: HoldingReturnRange; label: string }> = [
  { key: '1M', label: '1M' },
  { key: '3M', label: '3M' },
  { key: '6M', label: '6M' },
  { key: '1Y', label: '1Y' },
];

/** Trailing months each range subtracts from `now` to derive the `from` bound. */
const RANGE_MONTHS: Readonly<Record<HoldingReturnRange, number>> = {
  '1M': 1,
  '3M': 3,
  '6M': 6,
  '1Y': 12,
};

/** Default range on first render (matches the net-worth chart's 1Y default). */
const DEFAULT_RANGE: HoldingReturnRange = '1Y';

/**
 * Window start (`from`) for a range key, as a local-calendar IsoDate. Plain
 * Date month arithmetic normalizes overflow (e.g. May 31 - 3 months), mirroring
 * netWorthRangeStart. Pure given `now`.
 */
export function holdingReturnRangeStart(
  key: HoldingReturnRange,
  now: Date = new Date(),
): IsoDate {
  const shifted = new Date(
    now.getFullYear(),
    now.getMonth() - RANGE_MONTHS[key],
    now.getDate(),
  );
  return toIsoDate(shifted);
}

export interface ReturnSeriesResult {
  /** Normalized % return series: [{ date, returnPercent }]. Empty when < 1 usable point. */
  normalizedSeries: ReturnPoint[];
  /** Window's total % return (last point vs baseline); undefined when < 2 usable points (show dash). */
  windowPercent: number | undefined;
  /** Earliest snapshot date across accrued history (null before first snapshot). */
  firstSnapshotDate: IsoDate | null;
  /** True when < 2 usable points in window (chart shows the accrual-start state). */
  isInsufficient: boolean;
  /** Still fetching (useQuery isPending). */
  isLoading: boolean;
  /** Current range selection. */
  range: HoldingReturnRange;
  /** Setter: triggers a refetch with the new window's `from` date. */
  setRange: (range: HoldingReturnRange) => void;
}

function noop(): void {
  /* stable identity for the disabled (undefined account/symbol) result */
}

/**
 * The disabled result, returned when accountId or symbol is undefined (a
 * non-editable / cross-account aggregate position has no chart). Hooks are
 * still called above this branch so the hook order is invariant.
 */
const DISABLED_RESULT: ReturnSeriesResult = {
  normalizedSeries: [],
  windowPercent: undefined,
  firstSnapshotDate: null,
  isInsufficient: true,
  isLoading: false,
  range: DEFAULT_RANGE,
  setRange: noop,
};

export function useHoldingReturnSeries(
  accountId: string | undefined,
  symbol: string | undefined,
): ReturnSeriesResult {
  const [range, setRange] = useState<HoldingReturnRange>(DEFAULT_RANGE);

  // `from` is the only windowed bound; `to` defaults to today server-side.
  const from = useMemo(() => holdingReturnRangeStart(range), [range]);

  const enabled = accountId !== undefined && symbol !== undefined;

  const query = useQuery({
    queryKey: queryKeys.holdings.priceHistory(accountId ?? '', symbol ?? '', from),
    queryFn: ({ signal }) =>
      // enabled gates this; the `??` keeps the call typed without ever running
      // when either id is undefined.
      holdingPriceHistory(accountId ?? '', symbol ?? '', { from }, signal),
    enabled,
  });

  // Latch the global earliest-snapshot date: it is identical across windows, so
  // hold the first non-null value seen and never regress to null on the brief
  // pending state of a range switch (which would flicker the chart caption).
  const firstSnapshotRef = useRef<IsoDate | null>(null);
  const responseFirst = query.data?.firstSnapshotDate ?? null;
  if (responseFirst !== null) {
    firstSnapshotRef.current = responseFirst;
  }
  const firstSnapshotDate = firstSnapshotRef.current;

  // Normalize + window-return ONLY through the shared helpers. windowReturnPercent
  // re-runs normalizeReturnSeries internally; both calls are deliberate (single
  // source) rather than deriving the window from normalizedSeries[last] inline.
  // HoldingPricePointDto is a structural superset of the helper's PricePoint, so
  // `items` passes through with no mapping.
  const items = query.data?.items;
  const { normalizedSeries, windowPercent } = useMemo(() => {
    const points = items ?? [];
    return {
      normalizedSeries: normalizeReturnSeries(points, logger),
      windowPercent: windowReturnPercent(points, logger),
    };
  }, [items]);

  if (!enabled) {
    return DISABLED_RESULT;
  }

  return {
    normalizedSeries,
    windowPercent,
    firstSnapshotDate,
    // < 2 usable points per the shared contract (equivalent to undefined window).
    isInsufficient: windowPercent === undefined,
    isLoading: query.isPending,
    range,
    setRange,
  };
}
