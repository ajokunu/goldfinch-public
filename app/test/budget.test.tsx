/**
 * Budget integration: the envelope view renders the current-month caption,
 * the Income | Budgeted | Left summary strip from the cashflow read, and one
 * row per budget with the shared-formatted "{spent} / {limit}" foot line --
 * plus the designed empty state, the merged error state, and the loading
 * spinner. The segmented sub-view control exposes all three views.
 */
import { ActivityIndicator } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { periodWindow, stepWeek } from '@goldfinch/shared/periodWindow';

import BudgetScreen from '../features/budget';
import { BudgetView } from '../features/budget/components/BudgetView';
import { currentIsoMonth, isoMonthLabel } from '../src/lib/dates';
import { resolveBudgetDateRange } from '../src/lib/dateRangePresets';
import { formatMinorAmount } from '../src/ui/CurrencyAmount';
import {
  listOf,
  makeBudgetDto,
  makeCashflowResponse,
  makeCategoryDto,
  makeTransactionDto,
} from './fixtures';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';

const MONTH = currentIsoMonth();

const groceriesCategory = makeCategoryDto({
  categoryId: 'groceries',
  name: 'Groceries',
});
const diningCategory = makeCategoryDto({
  categoryId: 'dining',
  name: 'Dining Out',
});

// Factory default limit: 60_000 minor. Spent 42_150 leaves 17_850.
const groceriesBudget = makeBudgetDto({
  categoryId: 'groceries',
  spentMinor: 42_150,
  categoryName: 'Groceries',
});

const cashflow = makeCashflowResponse([
  { month: MONTH, slice: { incomeMinor: 250_000, expenseMinor: 46_365 } },
]);

describe('Budget screen', () => {
  it('renders the month caption, summary strip, and budget rows', async () => {
    mockApi.get('/budgets', listOf([groceriesBudget]));
    mockApi.get('/categories', listOf([groceriesCategory, diningCategory]));
    mockApi.get('/cashflow', cashflow);

    renderWithProviders(<BudgetScreen />);

    // Screen title + sub-view tabs ('Budget' appears as both title and tab).
    expect((await screen.findAllByText('Budget')).length).toBeGreaterThanOrEqual(
      2,
    );
    expect(screen.getByText('Cash flow')).toBeOnTheScreen();
    expect(screen.getByText('Categories')).toBeOnTheScreen();

    // Month-header line: now a tappable date control (budget-range feature),
    // no longer a static Text. The current-month label is the button's label.
    const header = await screen.findByRole('button', {
      name: `${isoMonthLabel(MONTH)}, change date range`,
    });
    expect(header).toBeOnTheScreen();
    expect(screen.getByText(isoMonthLabel(MONTH))).toBeOnTheScreen();

    // Summary strip: Income | Budgeted | Left, integer minor-unit derived.
    expect(await screen.findByText('Income')).toBeOnTheScreen();
    expect(screen.getByText('Budgeted')).toBeOnTheScreen();
    expect(screen.getByText('Left')).toBeOnTheScreen();
    expect(
      screen.getByText(formatMinorAmount(250_000, 'USD')),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(formatMinorAmount(60_000, 'USD')),
    ).toBeOnTheScreen();
    expect(
      screen.getByText(formatMinorAmount(250_000 - 60_000, 'USD')),
    ).toBeOnTheScreen();

    // Budget row: category name + "{spent} / {limit}" through the shared
    // decimal-string formatting.
    expect(await screen.findByText('Groceries')).toBeOnTheScreen();
    expect(
      screen.getByText(
        `${formatMinorAmount(42_150, 'USD')} / ${formatMinorAmount(60_000, 'USD')}`,
      ),
    ).toBeOnTheScreen();
  });

  it('degrades the strip to Budgeted | Spent when cashflow fails', async () => {
    mockApi.get('/budgets', listOf([groceriesBudget]));
    mockApi.get('/categories', listOf([groceriesCategory]));
    mockApi.error('GET', '/cashflow', 500);

    renderWithProviders(<BudgetScreen />);

    expect(await screen.findByText('Budgeted')).toBeOnTheScreen();
    expect(screen.getByText('Spent')).toBeOnTheScreen();
    expect(screen.queryByText('Income')).toBeNull();
    // Budget rows still render -- the cashflow failure degrades only the strip.
    expect(await screen.findByText('Groceries')).toBeOnTheScreen();
  });

  it('shows the designed empty state with no budgets', async () => {
    mockApi.get('/budgets', listOf([]));
    mockApi.get('/categories', listOf([groceriesCategory, diningCategory]));
    mockApi.get('/cashflow', cashflow);

    renderWithProviders(<BudgetScreen />);

    expect(await screen.findByText('No budgets yet')).toBeOnTheScreen();
    expect(
      screen.getByText('Set a monthly limit on a category to start tracking'),
    ).toBeOnTheScreen();
    expect(screen.getByText('New budget')).toBeOnTheScreen();
  });

  it('shows the merged error state when the budgets read fails', async () => {
    mockApi.error('GET', '/budgets', 500);
    mockApi.get('/categories', listOf([groceriesCategory]));
    mockApi.get('/cashflow', cashflow);

    renderWithProviders(<BudgetScreen />);

    expect(
      await screen.findByText('Could not load your budget.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Try again')).toBeOnTheScreen();
  });

  it('holds a spinner while the reads are in flight', async () => {
    const gate = mockApi.defer('GET', '/budgets');
    mockApi.get('/categories', listOf([groceriesCategory]));
    mockApi.get('/cashflow', cashflow);

    renderWithProviders(<BudgetScreen />);

    await waitFor(() => {
      expect(
        screen.UNSAFE_getAllByType(ActivityIndicator).length,
      ).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Groceries')).toBeNull();

    gate.resolve({ status: 200, body: listOf([groceriesBudget]) });
    expect(await screen.findByText('Groceries')).toBeOnTheScreen();
  });

  it('switches to the Categories sub-view', async () => {
    mockApi.get('/budgets', listOf([groceriesBudget]));
    mockApi.get('/categories', listOf([groceriesCategory, diningCategory]));
    mockApi.get('/cashflow', cashflow);

    renderWithProviders(<BudgetScreen />);
    await screen.findByText('Groceries');

    fireEvent.press(screen.getByText('Categories'));
    expect(await screen.findByText('Dining Out')).toBeOnTheScreen();
  });

  // -------------------------------------------------------------------------
  // P11-4: per-budget period filter tabs + create/edit period threading.
  // -------------------------------------------------------------------------

  // A weekly food budget and a monthly rent budget live under different tabs.
  const weeklyFoodBudget = makeBudgetDto({
    categoryId: 'groceries',
    period: 'weekly',
    spentMinor: 12_000,
    categoryName: 'Groceries',
  });
  const monthlyRentBudget = makeBudgetDto({
    categoryId: 'rent',
    period: 'monthly',
    spentMinor: 0,
    categoryName: 'Rent',
  });
  const rentCategory = makeCategoryDto({ categoryId: 'rent', name: 'Rent' });

  it('filters the envelope list by the selected Week/Month/Year tab', async () => {
    mockApi.get('/budgets', listOf([weeklyFoodBudget, monthlyRentBudget]));
    mockApi.get('/categories', listOf([groceriesCategory, rentCategory]));
    mockApi.get('/cashflow', cashflow);

    renderWithProviders(<BudgetScreen />);

    // Default tab is Month: only the monthly rent budget is listed.
    expect(await screen.findByText('Rent')).toBeOnTheScreen();
    expect(screen.queryByText('Groceries')).toBeNull();

    // Switch to Week: the weekly food budget appears, the monthly one drops.
    fireEvent.press(screen.getByText('Weekly'));
    expect(await screen.findByText('Groceries')).toBeOnTheScreen();
    expect(screen.queryByText('Rent')).toBeNull();

    // Year has no budgets -> the per-tab empty state, not the first-run copy.
    fireEvent.press(screen.getByText('Yearly'));
    expect(await screen.findByText('No yearly budgets yet')).toBeOnTheScreen();
    expect(screen.queryByText('No budgets yet')).toBeNull();
  });

  it('creates a budget with the active tab period in the request body', async () => {
    // Groceries already has a (weekly) budget, so Rent is the unbudgeted row.
    mockApi.get('/budgets', listOf([weeklyFoodBudget]));
    mockApi.get('/categories', listOf([groceriesCategory, rentCategory]));
    mockApi.get('/cashflow', cashflow);

    let createdBody: Record<string, unknown> | undefined;
    mockApi.on('POST', '/budgets', (request) => {
      createdBody = request.body as Record<string, unknown>;
      return { status: 201, body: monthlyRentBudget };
    });

    renderWithProviders(<BudgetScreen />);

    // Go to the Week tab, then open the create editor for the unbudgeted Rent
    // category from the "Not budgeted" list (seeds initialPeriod = weekly).
    fireEvent.press(await screen.findByText('Weekly'));
    fireEvent.press(await screen.findByText('Rent'));

    // The cadence-qualified limit eyebrow confirms the seeded weekly period.
    const limitInput = await screen.findByLabelText('Weekly limit');
    fireEvent.changeText(limitInput, '450');
    fireEvent.press(screen.getByText('Save budget'));

    await waitFor(() => {
      expect(createdBody).toBeDefined();
    });
    expect(createdBody).toMatchObject({
      categoryId: 'rent',
      limit: '450.00',
      period: 'weekly',
    });
  });

  it('preserves the stored period when editing a budget', async () => {
    mockApi.get('/budgets', listOf([weeklyFoodBudget]));
    mockApi.get('/categories', listOf([groceriesCategory]));
    mockApi.get('/cashflow', cashflow);

    let patchedBody: Record<string, unknown> | undefined;
    mockApi.on('PATCH', '/budgets/groceries', (request) => {
      patchedBody = request.body as Record<string, unknown>;
      return { status: 200, body: weeklyFoodBudget };
    });

    renderWithProviders(<BudgetScreen />);

    // The weekly food budget shows under the Week tab; open its editor.
    fireEvent.press(await screen.findByText('Weekly'));
    fireEvent.press(await screen.findByLabelText('Edit budget: Groceries'));

    // Save without touching the period picker: the patch must carry the
    // stored 'weekly' cadence so an unrelated edit never silently re-windows.
    fireEvent.press(await screen.findByText('Save budget'));

    await waitFor(() => {
      expect(patchedBody).toBeDefined();
    });
    expect(patchedBody).toMatchObject({ period: 'weekly' });
  });
});

// ---------------------------------------------------------------------------
// Budget-range feature: the context-sensitive date header (Decision 5).
// Month/Year tab => a tappable label opening the presets range chooser;
// Week tab => a ‹ › prev/next Mon..Sun stepper. Range mode re-queries
// GET /budgets with from/to and renders rows + a degraded strip from it; the
// drill-down covers the same range. `now` is injected for determinism.
// ---------------------------------------------------------------------------

describe('Budget range + week stepping', () => {
  // Fixed ET-anchored instant so the resolved windows are deterministic.
  const NOW = new Date('2026-06-15T12:00:00.000Z');

  const groceriesCat = makeCategoryDto({ categoryId: 'groceries', name: 'Groceries' });
  const rentCat = makeCategoryDto({ categoryId: 'rent', name: 'Rent' });

  // Default (current-period) monthly budget vs the range-windowed variant the
  // server returns when from/to are present (prorated target in limitMinor).
  const monthlyDefault = makeBudgetDto({
    categoryId: 'rent',
    period: 'monthly',
    limitMinor: 120_000,
    spentMinor: 90_000,
    categoryName: 'Rent',
  });
  const monthlyRanged = makeBudgetDto({
    categoryId: 'rent',
    period: 'monthly',
    limitMinor: 80_000, // prorated target over the chosen range
    spentMinor: 55_000, // range spend
    categoryName: 'Rent',
  });

  const weeklyDefault = makeBudgetDto({
    categoryId: 'groceries',
    period: 'weekly',
    limitMinor: 45_000,
    spentMinor: 12_000,
    categoryName: 'Groceries',
  });
  const weeklyStepped = makeBudgetDto({
    categoryId: 'groceries',
    period: 'weekly',
    limitMinor: 45_000,
    spentMinor: 30_000, // a different week's spend
    categoryName: 'Groceries',
  });

  interface BudgetReq {
    from: string | null;
    to: string | null;
  }

  /** Registers /budgets so the default vs range request return distinct data. */
  function mockBudgets(opts: {
    categories: ReturnType<typeof makeCategoryDto>[];
    defaultItems: ReturnType<typeof makeBudgetDto>[];
    rangeItems: ReturnType<typeof makeBudgetDto>[];
  }): { reqs: BudgetReq[] } {
    const reqs: BudgetReq[] = [];
    mockApi.get('/categories', listOf(opts.categories));
    mockApi.get('/cashflow', cashflow);
    mockApi.on('GET', '/budgets', (request) => {
      const from = request.query.get('from');
      const to = request.query.get('to');
      reqs.push({ from, to });
      return {
        status: 200,
        body: listOf(from ? opts.rangeItems : opts.defaultItems),
      };
    });
    return { reqs };
  }

  it('Month-tab header tap opens the presets range chooser', async () => {
    mockBudgets({
      categories: [rentCat],
      defaultItems: [monthlyDefault],
      rangeItems: [monthlyRanged],
    });

    renderWithProviders(<BudgetView now={NOW} />);

    fireEvent.press(
      await screen.findByRole('button', {
        name: `${isoMonthLabel(MONTH)}, change date range`,
      }),
    );

    // Exactly the six signed-off presets, in order.
    expect(await screen.findByText('Date range')).toBeOnTheScreen();
    expect(screen.getByText('This month')).toBeOnTheScreen();
    expect(screen.getByText('Last month')).toBeOnTheScreen();
    expect(screen.getByText('Last 30 days')).toBeOnTheScreen();
    expect(screen.getByText('Last 90 days')).toBeOnTheScreen();
    expect(screen.getByText('This quarter')).toBeOnTheScreen();
    expect(screen.getByText('Year to date')).toBeOnTheScreen();
  });

  it('selecting a preset re-queries with from/to and renders range data', async () => {
    const { reqs } = mockBudgets({
      categories: [rentCat],
      defaultItems: [monthlyDefault],
      rangeItems: [monthlyRanged],
    });

    renderWithProviders(<BudgetView now={NOW} />);

    // Default mode first: the current-period limit + Income/Budgeted/Left strip.
    expect(await screen.findByText('Rent')).toBeOnTheScreen();
    expect(screen.getByText('Income')).toBeOnTheScreen();
    expect(screen.getByText('Left')).toBeOnTheScreen();
    expect(reqs[0]).toEqual({ from: null, to: null });

    // Open the chooser and pick "Last month".
    fireEvent.press(
      screen.getByRole('button', {
        name: `${isoMonthLabel(MONTH)}, change date range`,
      }),
    );
    fireEvent.press(await screen.findByText('Last month'));

    // The range request carries the ET-resolved Last-month window.
    const lastMonth = resolveBudgetDateRange('lastMonth', NOW);
    await waitFor(() =>
      expect(reqs).toContainEqual({ from: lastMonth.from, to: lastMonth.to }),
    );

    // Rows re-render from the range data (prorated target + range spend).
    expect(
      await screen.findByText(
        `${formatMinorAmount(55_000, 'USD')} / ${formatMinorAmount(80_000, 'USD')}`,
      ),
    ).toBeOnTheScreen();
    // Header now reflects the selected preset.
    expect(
      screen.getByRole('button', { name: 'Last month, change date range' }),
    ).toBeOnTheScreen();
  });

  it('range mode degrades the strip to Budgeted | Spent (no Income/Left)', async () => {
    mockBudgets({
      categories: [rentCat],
      defaultItems: [monthlyDefault],
      rangeItems: [monthlyRanged],
    });

    renderWithProviders(<BudgetView now={NOW} />);
    await screen.findByText('Rent');

    fireEvent.press(
      screen.getByRole('button', {
        name: `${isoMonthLabel(MONTH)}, change date range`,
      }),
    );
    fireEvent.press(await screen.findByText('This quarter'));

    // The Budgeted | Spent degrade path: Income and Left are gone.
    expect(await screen.findByText('Spent')).toBeOnTheScreen();
    expect(screen.getByText('Budgeted')).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('Income')).toBeNull());
    expect(screen.queryByText('Left')).toBeNull();
  });

  it('Week-tab header steps prev/next a Monday..Sunday window', async () => {
    const { reqs } = mockBudgets({
      categories: [groceriesCat],
      defaultItems: [weeklyDefault],
      rangeItems: [weeklyStepped],
    });

    renderWithProviders(<BudgetView now={NOW} />);

    // Switch to the Week tab: the stepper replaces the month label, and the
    // current week (delta 0) still uses the default per-cadence query.
    fireEvent.press(await screen.findByText('Weekly'));
    expect(await screen.findByLabelText('Previous week')).toBeOnTheScreen();
    expect(screen.getByLabelText('Next week')).toBeOnTheScreen();
    expect(await screen.findByText('Groceries')).toBeOnTheScreen();

    // Step to next week: the range request carries stepWeek(now, +1) Mon..Sun.
    fireEvent.press(screen.getByLabelText('Next week'));
    const nextWeek = stepWeek(NOW, 1);
    await waitFor(() =>
      expect(reqs).toContainEqual({ from: nextWeek.from, to: nextWeek.to }),
    );

    // Step back two: from next week to the previous week (delta -1).
    fireEvent.press(screen.getByLabelText('Previous week'));
    fireEvent.press(screen.getByLabelText('Previous week'));
    const prevWeek = stepWeek(NOW, -1);
    await waitFor(() =>
      expect(reqs).toContainEqual({ from: prevWeek.from, to: prevWeek.to }),
    );

    // The stepper never opens the range chooser.
    expect(screen.queryByText('Date range')).toBeNull();
  });

  it('does not open the range sheet while on the Week tab', async () => {
    mockBudgets({
      categories: [groceriesCat],
      defaultItems: [weeklyDefault],
      rangeItems: [weeklyStepped],
    });

    renderWithProviders(<BudgetView now={NOW} />);
    fireEvent.press(await screen.findByText('Weekly'));

    // No Month/Year header button exists on the Week tab.
    expect(
      screen.queryByRole('button', {
        name: `${isoMonthLabel(MONTH)}, change date range`,
      }),
    ).toBeNull();
  });

  it('range-mode drill-down opens the full [from,to] range', async () => {
    const rangeTxn = makeTransactionDto({
      txnId: 'txn-range',
      payee: 'Costco',
      amountMinor: -55_000,
      categoryId: 'rent',
    });
    const txnReqs: BudgetReq[] = [];

    mockBudgets({
      categories: [rentCat],
      defaultItems: [monthlyDefault],
      rangeItems: [monthlyRanged],
    });
    mockApi.on('GET', '/transactions', (request) => {
      txnReqs.push({
        from: request.query.get('from'),
        to: request.query.get('to'),
      });
      return { status: 200, body: listOf([rangeTxn]) };
    });

    renderWithProviders(<BudgetView now={NOW} />);
    await screen.findByText('Rent');

    // Enter range mode via "This month".
    fireEvent.press(
      screen.getByRole('button', {
        name: `${isoMonthLabel(MONTH)}, change date range`,
      }),
    );
    fireEvent.press(await screen.findByText('This month'));

    // Tap the row's spent/limit foot line to open the drill-down.
    fireEvent.press(
      await screen.findByText(
        `${formatMinorAmount(55_000, 'USD')} / ${formatMinorAmount(80_000, 'USD')}`,
      ),
    );

    // The drill-down lists transactions over the SAME range, not the month.
    const thisMonth = resolveBudgetDateRange('thisMonth', NOW);
    expect(await screen.findByText('Costco')).toBeOnTheScreen();
    await waitFor(() =>
      expect(txnReqs).toContainEqual({
        from: thisMonth.from,
        to: thisMonth.to,
      }),
    );
  });
});
