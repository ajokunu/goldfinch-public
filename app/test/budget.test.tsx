/**
 * Budget integration: the envelope view renders the current-month caption,
 * the Income | Budgeted | Left summary strip from the cashflow read, and one
 * row per budget with the shared-formatted "{spent} / {limit}" foot line --
 * plus the designed empty state, the merged error state, and the loading
 * spinner. The segmented sub-view control exposes all three views.
 */
import { ActivityIndicator } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import BudgetScreen from '../features/budget';
import { currentIsoMonth, isoMonthLabel } from '../src/lib/dates';
import { formatMinorAmount } from '../src/ui/CurrencyAmount';
import {
  listOf,
  makeBudgetDto,
  makeCashflowResponse,
  makeCategoryDto,
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

    // Current-month caption (static period label).
    expect(await screen.findByText(isoMonthLabel(MONTH))).toBeOnTheScreen();

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
