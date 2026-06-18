/**
 * Reports query hooks -- the three independent reads behind the screen
 * (P7-4): net-worth history, monthly trends, and the per-month income flow.
 * Each card renders its own loading/empty/error state, so one slow or failed
 * call degrades only its card (same posture as the dashboard).
 *
 * Keys come exclusively from src/api/queryKeys.ts so cache invalidation
 * (mutation hooks invalidate reports.all()/netWorthHistory.all() after
 * spend-shifting writes) stays coherent. Endpoint functions come from
 * src/api/endpoints.ts.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  IsoMonth,
  NetWorthHistoryResponse,
  ReportsFlowResponse,
  ReportsTrendsResponse,
} from '@goldfinch/shared/types';

import {
  getNetWorthHistory,
  getReportsFlow,
  getReportsTrends,
} from '../../src/api/endpoints';
import { queryKeys } from '../../src/api/queryKeys';

/**
 * Report data shifts once a day via sync plus on explicit writes (which
 * invalidate through the key factory), so these reads use the same elevated
 * staleTime as the dashboard. Pull-to-refresh is the deliberate manual path.
 */
export const REPORTS_STALE_TIME_MS = 5 * 60_000;

/** Selectable trailing windows for GET /reports/trends (P7-4). */
export type TrendsWindowMonths = 3 | 6 | 12;

/** Segmented-control key form of the window (SegmentedTabs keys are strings). */
export type TrendWindowKey = '3' | '6' | '12';

export const TREND_WINDOW_BY_KEY: Record<TrendWindowKey, TrendsWindowMonths> = {
  '3': 3,
  '6': 6,
  '12': 12,
};

/**
 * Labels restyled to the prototype's compact 3M / 6M / 1Y per
 * design-spec/screens.md 4.3; the keys (and the windows they request) are
 * unchanged.
 */
export const TREND_WINDOW_OPTIONS: ReadonlyArray<{
  key: TrendWindowKey;
  label: string;
}> = [
  { key: '3', label: '3M' },
  { key: '6', label: '6M' },
  { key: '12', label: '1Y' },
];

/** Matches the server default window for GET /reports/trends. */
export const DEFAULT_TREND_WINDOW_KEY: TrendWindowKey = '6';

/**
 * GET /networth/history -- the full accrued snapshot range (server defaults:
 * from = earliest snapshot, to = today). History accrues from first deploy;
 * the response's firstSnapshotDate drives the chart's start-date caption.
 */
export function useNetWorthHistory(): UseQueryResult<NetWorthHistoryResponse> {
  return useQuery({
    queryKey: queryKeys.netWorthHistory.range(),
    queryFn: ({ signal }) => getNetWorthHistory({}, signal),
    staleTime: REPORTS_STALE_TIME_MS,
  });
}

/** GET /reports/trends?months=N -- one TrendMonthDto per window month. */
export function useReportsTrends(
  months: TrendsWindowMonths,
): UseQueryResult<ReportsTrendsResponse> {
  return useQuery({
    queryKey: queryKeys.reports.trends(months),
    queryFn: ({ signal }) => getReportsTrends({ months }, signal),
    staleTime: REPORTS_STALE_TIME_MS,
  });
}

/** GET /reports/flow?month= -- income -> category groups for one month. */
export function useReportsFlow(
  month: IsoMonth,
): UseQueryResult<ReportsFlowResponse> {
  return useQuery({
    queryKey: queryKeys.reports.flow(month),
    queryFn: ({ signal }) => getReportsFlow({ month }, signal),
    staleTime: REPORTS_STALE_TIME_MS,
  });
}
