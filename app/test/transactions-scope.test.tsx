/**
 * P11-5 Activity date-scope: the FilterBar's This Week / This Month / This
 * Year / Custom control sets the transactions from/to via the SHARED
 * periodWindow (the same source budgets use), so each preset lands the correct
 * inclusive window on the wire. Custom keeps the existing from/to preset path.
 *
 * The default scope is This Month (current behavior), so the first request
 * carries the current calendar month. Pressing a scope tab refetches with the
 * window periodWindow() computes for that period at "now".
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { periodWindow } from '@goldfinch/shared/periodWindow';

import TransactionsScreen from '../features/transactions';
import {
  DATE_RANGE_PRESETS,
  resolveDateRange,
} from '../features/transactions/lib/dateRanges';
import {
  listOf,
  makeAccountDto,
  makeCategoryDto,
  makeTransactionDto,
} from './fixtures';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';

interface Range {
  from: string | null;
  to: string | null;
}

const checking = makeAccountDto();
const groceries = makeCategoryDto({ categoryId: 'groceries', name: 'Groceries' });
const txn = makeTransactionDto({ txnId: 'txn-1', payee: 'Blue Bottle' });

/** Registers lookups + a /transactions route that records every from/to. */
function mockRoutes(): { ranges: Range[] } {
  const ranges: Range[] = [];
  mockApi.get('/accounts', listOf([checking]));
  mockApi.get('/categories', listOf([groceries]));
  mockApi.on('GET', '/transactions', (request) => {
    ranges.push({
      from: request.query.get('from'),
      to: request.query.get('to'),
    });
    return { status: 200, body: listOf([txn]) };
  });
  return { ranges };
}

/** The from/to periodWindow computes for `period` at the test's current instant. */
function windowFor(period: 'weekly' | 'monthly' | 'yearly'): Range {
  const w = periodWindow(period, new Date());
  return { from: w.from, to: w.to };
}

describe('P11-5 Activity date-scope', () => {
  it('defaults to This Month: the first request carries the current month window', async () => {
    const { ranges } = mockRoutes();

    renderWithProviders(<TransactionsScreen />);

    expect(await screen.findByText('Blue Bottle')).toBeOnTheScreen();
    expect(ranges[0]).toEqual(windowFor('monthly'));
  });

  it('This Week sets the current Monday..Sunday window on the wire', async () => {
    const { ranges } = mockRoutes();

    renderWithProviders(<TransactionsScreen />);
    expect(await screen.findByText('Blue Bottle')).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Week'));

    await waitFor(() =>
      expect(ranges).toContainEqual(windowFor('weekly')),
    );
  });

  it('This Year sets the Jan 1..Dec 31 window on the wire', async () => {
    const { ranges } = mockRoutes();

    renderWithProviders(<TransactionsScreen />);
    expect(await screen.findByText('Blue Bottle')).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Year'));

    await waitFor(() => expect(ranges).toContainEqual(windowFor('yearly')));
  });

  it('Custom keeps the existing from/to preset (reveals the preset chip)', async () => {
    const { ranges } = mockRoutes();

    renderWithProviders(<TransactionsScreen />);
    expect(await screen.findByText('Blue Bottle')).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Custom'));

    // The default Custom preset is the last-90-days window; its labeled chip
    // appears in the row (the period scopes hide it).
    const defaultPreset =
      DATE_RANGE_PRESETS.find((preset) => preset.id === 'last90')?.label ??
      '90 days';
    expect(await screen.findByText(defaultPreset)).toBeOnTheScreen();

    const expected = resolveDateRange('last90');
    await waitFor(() =>
      expect(ranges).toContainEqual({
        from: expected.from,
        to: expected.to,
      }),
    );
  });
});
