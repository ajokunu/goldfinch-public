/**
 * P8-2 / P8-3 integration: the dashboard spending drill-down lands its
 * ?category= param in the transactions category filter on mount, the
 * FilterBar category picker adds a removable chip that sends categoryId on
 * the wire (server GSI2 leg), and clearing the chip drops the param again.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { SpendingCard } from '../features/dashboard/components/SpendingCard';
import TransactionsScreen from '../features/transactions';
import { currentIsoMonth, toIsoDate } from '../src/lib/dates';
import {
  listOf,
  makeAccountDto,
  makeCategoryDto,
  makeReportsFlowResponse,
  makeTransactionDto,
} from './fixtures';
import { mockApi } from './mockApi';
import { routerMock, setSearchParams } from './expoRouterMock';
import { renderWithProviders } from './render';

const TODAY = toIsoDate(new Date());

const checking = makeAccountDto(); // 'Everyday Checking'
const groceries = makeCategoryDto({ categoryId: 'groceries', name: 'Groceries' });

const wholeFoods = makeTransactionDto({
  txnId: 'txn-wf',
  date: TODAY,
  payee: 'Whole Foods Market',
  amountMinor: -4_215,
  categoryId: 'groceries',
});

/** Registers lookups + a /transactions route that records categoryId. */
function mockRoutes(): { categoryIds: Array<string | null> } {
  const categoryIds: Array<string | null> = [];
  mockApi.get('/accounts', listOf([checking]));
  mockApi.get('/categories', listOf([groceries]));
  mockApi.on('GET', '/transactions', (request) => {
    categoryIds.push(request.query.get('categoryId'));
    return { status: 200, body: listOf([wholeFoods]) };
  });
  return { categoryIds };
}

describe('P8-2 spending drill-down', () => {
  it('SpendingCard legend rows navigate to /transactions?category=<id>', async () => {
    mockApi.get(
      '/reports/flow',
      makeReportsFlowResponse(
        currentIsoMonth(),
        { incomeMinor: 0, expenseMinor: 4_215 },
        [
          {
            categoryId: 'groceries',
            categoryName: 'Groceries',
            amountMinor: 4_215,
          },
        ],
      ),
    );

    renderWithProviders(<SpendingCard />);

    fireEvent.press(await screen.findByTestId('spending-legend-groceries'));
    expect(routerMock.push).toHaveBeenCalledWith({
      pathname: '/transactions',
      params: { category: 'groceries' },
    });
  });

  it('the transactions screen consumes ?category= into the filter on mount', async () => {
    const { categoryIds } = mockRoutes();
    setSearchParams({ category: 'groceries' });

    renderWithProviders(<TransactionsScreen />);

    // The filter lands on the wire (server GSI2 leg).
    await waitFor(() => expect(categoryIds).toContain('groceries'));
    // The removable chip is present (its clear affordance carries the name).
    expect(
      await screen.findByLabelText('Clear Groceries filter'),
    ).toBeOnTheScreen();
    // The consumed param is cleared from the route so chip removal sticks.
    expect(routerMock.setParams).toHaveBeenCalledWith({ category: undefined });
  });
});

describe('P8-3 category filter chip', () => {
  it('adds the category filter through the picker and removes it via the chip X', async () => {
    const { categoryIds } = mockRoutes();

    renderWithProviders(<TransactionsScreen />);
    expect(await screen.findByText('Whole Foods Market')).toBeOnTheScreen();
    expect(categoryIds).toEqual([null]);

    // Open the picker from the Category chip and select Groceries.
    fireEvent.press(screen.getByLabelText('Category'));
    fireEvent.press(
      await screen.findByTestId('category-filter-option-groceries'),
    );

    // The list refetches with categoryId on the query string.
    await waitFor(() => expect(categoryIds).toContain('groceries'));
    const clearButton = await screen.findByLabelText('Clear Groceries filter');

    // Removing the chip drops the param and refetches unfiltered.
    fireEvent.press(clearButton);
    await waitFor(() =>
      expect(categoryIds.filter((id) => id === null).length).toBeGreaterThan(1),
    );
    expect(screen.queryByLabelText('Clear Groceries filter')).toBeNull();
  });
});
