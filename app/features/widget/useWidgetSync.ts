/**
 * Widget refresh hook (WIDGET-PLAN.md task 4). Mounted ONCE inside the
 * authenticated tree (under QueryClientProvider), it keeps the home-screen
 * weekly-spend widget's shared-container snapshot current by:
 *
 *   1. Watching the already-fetched dashboard/budget data and, whenever it is
 *      all loaded (and when the persisted "Show amounts on widget" setting
 *      flips), building the snapshot and writing it via WidgetBridge.
 *   2. Refetching those data dependencies on two triggers so the build above
 *      runs against fresh data:
 *        - AppState -> 'active' (the app comes to the foreground), and
 *        - post-sync: summary.asOf advances past the last value we saw (the
 *          daily sync Lambda landed new data; mirrors the dashboard's own
 *          asOf-advance invalidation in features/dashboard/index.tsx).
 *
 * The snapshot math is NOT re-derived here: the window comes from the shared
 * periodWindow('weekly'); the weekly total + top categories come from the same
 * windowFlowByCurrency the dashboard donut uses; the weekly budget + percent
 * come from the budgets query. All of that lives in the pure
 * buildWeeklySpendWidgetSnapshot (a sibling file); this hook only orchestrates
 * trigger -> refetch -> build -> bridge-write, threading the persisted
 * showAmounts setting through.
 *
 * The bridge write is a safe no-op until the native widget target ships (see
 * WidgetBridge), so mounting this hook is harmless on web / Expo Go / tests.
 *
 * MOUNT POINT: this hook is exported, NOT mounted here. The orchestrator must
 * call useWidgetSync() once inside the authenticated app tree, beneath the
 * QueryClientProvider (e.g. in app/app/(app)/_layout.tsx). See openIssues.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../src/api/queryKeys';
import { logger } from '../../src/lib/logger';
import { useUiStore } from '../../src/state/uiStore';
import { lightTheme } from '../../src/ui/theme';
import {
  useSummary,
  useWindowTransactions,
} from '../dashboard/hooks';
import {
  useBudgetsQuery,
  useCategoriesQuery,
} from '../budget/hooks/useBudgetQueries';
import { buildWeeklySpendWidgetSnapshot } from './snapshot';
import { setWeeklySpendSnapshot } from './WidgetBridge';

const log = logger.child({ feature: 'widget-sync' });

/**
 * Fixed, compile-time category color palette for the widget. The sandboxed
 * native widget extension cannot read the app's live 4-direction theme, so the
 * snapshot bakes in deterministic colors from the default (meridian) direction
 * via categoryColor(id, palette) inside the builder. lightTheme is a static
 * export resolved at module load, giving us a frozen palette without a new
 * file. (WIDGET-PLAN.md "Theming"; contract #2 palette source, option 1.)
 */
const WIDGET_PALETTE: readonly string[] = lightTheme.colors.categories;

export function useWidgetSync(): void {
  const queryClient = useQueryClient();
  const showAmountsOnWidget = useUiStore((s) => s.showAmountsOnWidget);

  // The same reads the dashboard's This Week spending card uses; reusing the
  // hooks means we share their cache entries and their sync/refresh
  // invalidation, never issuing duplicate network traffic.
  const txnQuery = useWindowTransactions('weekly');
  const budgetsQuery = useBudgetsQuery();
  const categoriesQuery = useCategoriesQuery();
  const summaryQuery = useSummary();

  // Category id -> name / type lookups, mirroring the dashboard spending card.
  const categoryNameFor = useMemo(() => {
    const byId = new Map(
      (categoriesQuery.data?.items ?? []).map((c) => [c.categoryId, c.name]),
    );
    return (id: string): string | undefined => byId.get(id);
  }, [categoriesQuery.data]);

  const categoryTypeFor = useMemo(() => {
    const byId = new Map(
      (categoriesQuery.data?.items ?? []).map((c) => [c.categoryId, c.type]),
    );
    return (id: string) => byId.get(id);
  }, [categoriesQuery.data]);

  // Refetch every data dependency; both triggers funnel through here. Failures
  // are logged (house rule: no silent void) and never rejected up to the
  // listener, so a refetch error can't crash a foreground transition.
  const refetchDependencies = useCallback((): void => {
    void Promise.all([
      queryClient.refetchQueries({ queryKey: queryKeys.transactions.all() }),
      queryClient.refetchQueries({ queryKey: queryKeys.budgets.all() }),
      queryClient.refetchQueries({ queryKey: queryKeys.categories.all() }),
    ]).catch((error: unknown) => {
      log.warn('widget dependency refetch failed', { error });
    });
  }, [queryClient]);

  // Build + write the snapshot whenever all inputs are ready (or when the
  // persisted showAmounts setting changes). The pure builder owns all of the
  // weekly-spend / budget / top-category math; this effect only feeds it the
  // already-fetched data and hands the JSON to the bridge.
  const txnItems = txnQuery.data?.items;
  const budgetItems = budgetsQuery.data?.items;
  useEffect(() => {
    if (
      !txnQuery.isSuccess ||
      !budgetsQuery.isSuccess ||
      !categoriesQuery.isSuccess ||
      txnItems === undefined ||
      budgetItems === undefined
    ) {
      return;
    }
    try {
      const snapshot = buildWeeklySpendWidgetSnapshot({
        transactions: txnItems,
        categoryNameFor,
        categoryTypeFor,
        budgets: budgetItems,
        showAmountsOnWidget,
        palette: WIDGET_PALETTE,
      });
      setWeeklySpendSnapshot(JSON.stringify(snapshot));
    } catch (error) {
      log.warn('widget snapshot build failed', { error });
    }
  }, [
    txnQuery.isSuccess,
    budgetsQuery.isSuccess,
    categoriesQuery.isSuccess,
    txnItems,
    budgetItems,
    categoryNameFor,
    categoryTypeFor,
    showAmountsOnWidget,
  ]);

  // Trigger 1: AppState -> 'active'. Returning to the foreground refetches the
  // dependencies; the build effect above re-runs when the fresh data settles.
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (status: AppStateStatus) => {
        if (status === 'active') refetchDependencies();
      },
    );
    return () => subscription.remove();
  }, [refetchDependencies]);

  // Trigger 2: post-sync. summary.asOf is max(balance-date) across accounts;
  // when a focus refetch of /summary reports a newer asOf than last seen, the
  // daily sync has landed new data, so refetch the widget's dependencies. The
  // first observed asOf only primes the ref (no refetch on initial load).
  const lastSeenAsOf = useRef<number | null>(null);
  const asOf = summaryQuery.data?.asOf;
  useEffect(() => {
    if (asOf === undefined) return;
    if (lastSeenAsOf.current !== null && asOf > lastSeenAsOf.current) {
      refetchDependencies();
    }
    lastSeenAsOf.current = asOf;
  }, [asOf, refetchDependencies]);
}
