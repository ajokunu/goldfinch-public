/**
 * useWidgetSync wiring tests (WIDGET-PLAN.md task 4).
 *
 * These assert ONLY the hook's orchestration -- trigger -> refetch -> build ->
 * bridge-write, and the showAmounts threading -- with every collaborator
 * mocked: the data hooks (useWindowTransactions / useBudgetsQuery /
 * useCategoriesQuery / useSummary), the pure builder (buildWeeklySpendWidget-
 * Snapshot, which has its own tests), the WidgetBridge (so no native module is
 * touched), the persisted uiStore selector, and useQueryClient (so no real
 * QueryClientProvider is required). React-Native's AppState is mocked to a
 * controllable listener so the foreground trigger can be fired by hand.
 *
 * Jest hoists jest.mock() factories above imports, so every variable a factory
 * references is `mock`-prefixed (the only out-of-scope names jest permits).
 *
 * HARNESS NOTE: this is a jest + renderHook test (the hook imports React +
 * react-native, which the node --test feature suites cannot load). It lives at
 * features/widget/test/ but jest.config.js currently only collects
 * <rootDir>/test/**. See the owner's openIssues: the orchestrator must extend
 * jest `testMatch` to include features/**\/test (or relocate this file under
 * app/test/) for it to run in `npm run test:component`.
 */
import { renderHook } from '@testing-library/react-native';

import type { WeeklySpendWidgetSnapshot } from '../features/widget/snapshot';

// --- AppState: capture the 'change' listener so tests can fire foreground ---
let mockAppStateListener: ((status: string) => void) | undefined;
const mockAppStateRemove = jest.fn();
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn((event: string, cb: (status: string) => void) => {
      if (event === 'change') mockAppStateListener = cb;
      return { remove: mockAppStateRemove };
    }),
  },
}));

// --- WidgetBridge: spy the snapshot write (no native module under test) ---
const mockSetWeeklySpendSnapshot = jest.fn();
jest.mock('../features/widget/WidgetBridge', () => ({
  setWeeklySpendSnapshot: (json: string) => mockSetWeeklySpendSnapshot(json),
}));

// --- Pure builder: a sentinel snapshot so we can assert it is written ---
const mockBuiltSnapshot = { schemaVersion: 1, marker: 'built' } as unknown as
  WeeklySpendWidgetSnapshot;
const mockBuildSnapshot = jest.fn(
  (_args: unknown): WeeklySpendWidgetSnapshot => mockBuiltSnapshot,
);
jest.mock('../features/widget/snapshot', () => ({
  buildWeeklySpendWidgetSnapshot: (args: unknown) => mockBuildSnapshot(args),
}));

// --- Fixed palette source (lightTheme.colors.categories) ---
jest.mock('../src/ui/theme', () => ({
  lightTheme: { colors: { categories: ['#111111', '#222222'] } },
}));

// --- Logger: silent child ---
jest.mock('../src/lib/logger', () => ({
  logger: {
    child: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// --- queryClient: spy refetchQueries; resolve so the Promise.all settles ---
const mockRefetchQueries = jest.fn(
  (_filters: { queryKey: readonly unknown[] }) => Promise.resolve(),
);
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ refetchQueries: mockRefetchQueries }),
}));

// --- uiStore selector: return showAmountsOnWidget through the selector ---
const mockStore = { state: { showAmountsOnWidget: true } };
jest.mock('../src/state/uiStore', () => ({
  useUiStore: (selector: (s: { showAmountsOnWidget: boolean }) => unknown) =>
    selector(mockStore.state),
}));

// --- Data hooks: controllable query results ---
type QueryStub<T> = { isSuccess: boolean; data?: T };
const mockQueries = {
  txn: { isSuccess: false } as QueryStub<{ items: unknown[] }>,
  budgets: { isSuccess: false } as QueryStub<{ items: unknown[] }>,
  categories: { isSuccess: false } as QueryStub<{
    items: { categoryId: string; name: string; type: string }[];
  }>,
  summary: { isSuccess: false } as QueryStub<{ asOf: number }>,
};

jest.mock('../features/dashboard/hooks', () => ({
  useWindowTransactions: () => mockQueries.txn,
  useSummary: () => mockQueries.summary,
}));
jest.mock('../features/budget/hooks/useBudgetQueries', () => ({
  useBudgetsQuery: () => mockQueries.budgets,
  useCategoriesQuery: () => mockQueries.categories,
}));

import { useWidgetSync } from '../features/widget/useWidgetSync';

function allReady(): void {
  mockQueries.txn = { isSuccess: true, data: { items: [{ txnId: 't1' }] } };
  mockQueries.budgets = {
    isSuccess: true,
    data: { items: [{ categoryId: 'c', period: 'weekly' }] },
  };
  mockQueries.categories = {
    isSuccess: true,
    data: {
      items: [{ categoryId: 'groceries', name: 'Groceries', type: 'EXPENSE' }],
    },
  };
  mockQueries.summary = { isSuccess: true, data: { asOf: 1000 } };
}

beforeEach(() => {
  mockAppStateListener = undefined;
  mockAppStateRemove.mockClear();
  mockSetWeeklySpendSnapshot.mockClear();
  mockBuildSnapshot.mockClear();
  mockRefetchQueries.mockClear();
  mockStore.state = { showAmountsOnWidget: true };
  mockQueries.txn = { isSuccess: false };
  mockQueries.budgets = { isSuccess: false };
  mockQueries.categories = { isSuccess: false };
  mockQueries.summary = { isSuccess: false };
});

describe('useWidgetSync', () => {
  it('does not build or write a snapshot until every dependency has loaded', () => {
    mockQueries.txn = { isSuccess: true, data: { items: [] } };
    mockQueries.budgets = { isSuccess: true, data: { items: [] } };
    // categories still pending
    renderHook(() => useWidgetSync());

    expect(mockBuildSnapshot).not.toHaveBeenCalled();
    expect(mockSetWeeklySpendSnapshot).not.toHaveBeenCalled();
  });

  it('builds and writes the snapshot once all data is ready', () => {
    allReady();
    renderHook(() => useWidgetSync());

    expect(mockBuildSnapshot).toHaveBeenCalledTimes(1);
    expect(mockSetWeeklySpendSnapshot).toHaveBeenCalledTimes(1);
    // The exact sentinel snapshot is serialized to the bridge.
    expect(mockSetWeeklySpendSnapshot).toHaveBeenCalledWith(
      JSON.stringify(mockBuiltSnapshot),
    );
  });

  it('threads the persisted showAmountsOnWidget setting into the builder', () => {
    allReady();
    mockStore.state = { showAmountsOnWidget: false };
    renderHook(() => useWidgetSync());

    expect(mockBuildSnapshot).toHaveBeenCalledTimes(1);
    const args = mockBuildSnapshot.mock.calls[0]?.[0] as unknown as {
      showAmountsOnWidget: boolean;
      transactions: unknown[];
      budgets: unknown[];
      palette: readonly string[];
    };
    expect(args.showAmountsOnWidget).toBe(false);
    // The fixed (non-live-theme) palette is passed through.
    expect(args.palette).toEqual(['#111111', '#222222']);
  });

  it('registers a category name/type lookup over the categories query', () => {
    allReady();
    renderHook(() => useWidgetSync());
    const args = mockBuildSnapshot.mock.calls[0]?.[0] as unknown as {
      categoryNameFor: (id: string) => string | undefined;
      categoryTypeFor: (id: string) => string | undefined;
    };
    expect(args.categoryNameFor('groceries')).toBe('Groceries');
    expect(args.categoryTypeFor('groceries')).toBe('EXPENSE');
    expect(args.categoryNameFor('missing')).toBeUndefined();
  });

  it('refetches the three data dependencies when the app returns to the foreground', () => {
    allReady();
    renderHook(() => useWidgetSync());
    mockRefetchQueries.mockClear();

    expect(mockAppStateListener).toBeDefined();
    // Background then foreground.
    mockAppStateListener?.('background');
    expect(mockRefetchQueries).not.toHaveBeenCalled();
    mockAppStateListener?.('active');

    expect(mockRefetchQueries).toHaveBeenCalledTimes(3);
    const refetched = mockRefetchQueries.mock.calls.map(
      (call) => (call[0] as unknown as { queryKey: readonly unknown[] }).queryKey,
    );
    expect(refetched).toEqual([
      ['goldfinch', 'transactions'],
      ['goldfinch', 'budgets'],
      ['goldfinch', 'categories'],
    ]);
  });

  it('removes the AppState listener on unmount', () => {
    allReady();
    const { unmount } = renderHook(() => useWidgetSync());
    unmount();
    expect(mockAppStateRemove).toHaveBeenCalled();
  });

  it('refetches on a post-sync asOf advance, but not on the first observed asOf', () => {
    allReady();
    mockQueries.summary = { isSuccess: true, data: { asOf: 1000 } };
    const { rerender } = renderHook(() => useWidgetSync());
    mockRefetchQueries.mockClear();

    // asOf advances -> post-sync trigger fires.
    mockQueries.summary = { isSuccess: true, data: { asOf: 2000 } };
    rerender(undefined);
    expect(mockRefetchQueries).toHaveBeenCalledTimes(3);
  });

  it('does not refetch when asOf is unchanged across renders', () => {
    allReady();
    mockQueries.summary = { isSuccess: true, data: { asOf: 1000 } };
    const { rerender } = renderHook(() => useWidgetSync());
    mockRefetchQueries.mockClear();

    mockQueries.summary = { isSuccess: true, data: { asOf: 1000 } };
    rerender(undefined);
    expect(mockRefetchQueries).not.toHaveBeenCalled();
  });
});
