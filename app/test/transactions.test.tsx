/**
 * Transactions (Activity) integration: the infinite list renders real rows
 * (payee, account · category line, shared-formatted signed amounts) with day
 * section headers, plus the loading / empty / error states of the list body.
 */
import { ActivityIndicator } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import TransactionsScreen from '../features/transactions';
import { isoDateDaysAgo, toIsoDate } from '../src/lib/dates';
import { formatMinorAmount } from '../src/ui/CurrencyAmount';
import {
  listOf,
  makeAccountDto,
  makeCategoryDto,
  makeTransactionDto,
} from './fixtures';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';
import { useUiStore } from '../src/state/uiStore';

const TODAY = toIsoDate(new Date());
const YESTERDAY = isoDateDaysAgo(1);

const checking = makeAccountDto(); // 'Everyday Checking'
const groceriesCategory = makeCategoryDto({
  categoryId: 'groceries',
  name: 'Groceries',
});

const wholeFoods = makeTransactionDto({
  txnId: 'txn-wf',
  date: TODAY,
  payee: 'Whole Foods Market',
  amountMinor: -4_215,
  categoryId: 'groceries',
});
const coffee = makeTransactionDto({
  txnId: 'txn-coffee',
  date: YESTERDAY,
  payee: 'Blue Bottle Coffee',
  amountMinor: -650,
  categoryId: null,
  pending: true,
});

function mockLookups(): void {
  mockApi.get('/accounts', listOf([checking]));
  mockApi.get('/categories', listOf([groceriesCategory]));
}

describe('Transactions screen', () => {
  it('renders the Activity title, day headers, and real rows', async () => {
    mockLookups();
    mockApi.get('/transactions', listOf([wholeFoods, coffee]));

    renderWithProviders(<TransactionsScreen />);

    expect(await screen.findByText('Activity')).toBeOnTheScreen();
    expect(await screen.findByText('Whole Foods Market')).toBeOnTheScreen();
    expect(screen.getByText('Blue Bottle Coffee')).toBeOnTheScreen();

    // Day section headers: localized Today/Yesterday buckets.
    expect(await screen.findByText('Today')).toBeOnTheScreen();
    expect(screen.getByText('Yesterday')).toBeOnTheScreen();

    // Amounts ride the shared minor-unit formatting (sign preserved).
    expect(
      screen.getAllByText(formatMinorAmount(-4_215, 'USD')).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(formatMinorAmount(-650, 'USD')).length,
    ).toBeGreaterThanOrEqual(1);

    // Category and account labels resolve through the lookup reads.
    expect(screen.getAllByText(/Groceries/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders first-page rows through the entrance window under full motion (P9-2 item 6)', async () => {
    // Every FlashList item keeps a FadeRise wrapper; rows inside the
    // first-page window get the staggered entrance and rows beyond it get a
    // zero-duration/zero-distance one. With animations ON, the staggered
    // delays must never blank or drop row content -- the rows the jest
    // viewport mounts all sit inside the entrance window, exercising the
    // animated branch end to end.
    useUiStore.setState({ reduceAnimations: false });
    mockLookups();
    const bulk = Array.from({ length: 14 }, (_, i) =>
      makeTransactionDto({
        txnId: `txn-bulk-${i}`,
        date: TODAY,
        payee: `Bulk Payee ${i}`,
        amountMinor: -(1_000 + i),
      }),
    );
    mockApi.get('/transactions', listOf(bulk));

    renderWithProviders(<TransactionsScreen />);

    expect(await screen.findByText('Bulk Payee 0')).toBeOnTheScreen();
    expect(await screen.findByText('Bulk Payee 5')).toBeOnTheScreen();
    expect(await screen.findByText('Today')).toBeOnTheScreen();
  });

  it('shows the searching empty state when no transactions match', async () => {
    mockLookups();
    mockApi.get('/transactions', listOf([]));

    renderWithProviders(<TransactionsScreen />);

    expect(
      await screen.findByText('No transactions match.'),
    ).toBeOnTheScreen();
  });

  it('shows the list error state with retry when the read fails', async () => {
    mockLookups();
    mockApi.error('GET', '/transactions', 500, 'INTERNAL_ERROR', 'boom');

    renderWithProviders(<TransactionsScreen />);

    expect(
      await screen.findByText('Transactions could not be loaded.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('boom')).toBeOnTheScreen();

    // Fixing the route and pressing Retry recovers the list.
    mockApi.get('/transactions', listOf([wholeFoods]));
    fireEvent.press(screen.getByText('Retry'));
    expect(await screen.findByText('Whole Foods Market')).toBeOnTheScreen();
    expect(
      screen.queryByText('Transactions could not be loaded.'),
    ).toBeNull();
  });

  it('holds a spinner while the list is in flight', async () => {
    mockLookups();
    const gate = mockApi.defer('GET', '/transactions');

    renderWithProviders(<TransactionsScreen />);

    await waitFor(() => {
      expect(
        screen.UNSAFE_getAllByType(ActivityIndicator).length,
      ).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Whole Foods Market')).toBeNull();

    gate.resolve({ status: 200, body: listOf([wholeFoods, coffee]) });
    expect(await screen.findByText('Whole Foods Market')).toBeOnTheScreen();
  });
});
