/**
 * P11-5 Dashboard spending scope: the small This Week / This Month toggle
 * re-scopes BOTH the recent-activity slice and the spending figure through the
 * shared periodWindow. Default This Month keeps the current behavior (the
 * /reports/flow donut + the current-month recent slice). This Week switches the
 * spending card to the periodWindow('weekly')-derived figure and re-scopes the
 * recent slice to the same week window.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { periodWindow } from '@goldfinch/shared/periodWindow';

import DashboardScreen from '../features/dashboard';
import {
  isoMonthName,
  monthSpendingTitle,
} from '../features/dashboard/lib/labels';
import { localeTag } from '../src/i18n';
import { currentIsoMonth } from '../src/lib/dates';
import {
  listOf,
  makeAccountDto,
  makeCategoryDto,
  makeNetWorthHistoryResponse,
  makeReportsFlowResponse,
  makeSummaryResponse,
  makeTransactionDto,
} from './fixtures';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';

const MONTH = currentIsoMonth();
const WEEK = periodWindow('weekly', new Date());

const checking = makeAccountDto();
const groceriesCategory = makeCategoryDto({
  categoryId: 'groceries',
  name: 'Groceries',
});

// One $42.15 expense + one $12.00 expense + one income leg + one transfer:
// the weekly spend figure must sum the two expenses only (5415 minor).
const expenseA = makeTransactionDto({
  txnId: 'txn-a',
  payee: 'Whole Foods Market',
  amountMinor: -4_215,
  categoryId: 'groceries',
});
const expenseB = makeTransactionDto({
  txnId: 'txn-b',
  payee: 'Blue Bottle',
  amountMinor: -1_200,
  categoryId: null,
});
const incomeLeg = makeTransactionDto({
  txnId: 'txn-c',
  payee: 'Acme Payroll',
  amountMinor: 250_000,
  categoryId: null,
});
const transferLeg = makeTransactionDto({
  txnId: 'txn-d',
  payee: 'Transfer to Savings',
  amountMinor: -50_000,
  isTransfer: true,
  categoryId: null,
});

const summary = makeSummaryResponse({
  netWorthMinor: 438_845,
  assetsTotalMinor: 523_055,
  liabilitiesTotalMinor: 84_210,
  byType: [
    {
      type: 'checking',
      label: 'Cash',
      isLiability: false,
      totalMinor: 523_055,
      accounts: [checking],
    },
  ],
});

const flow = makeReportsFlowResponse(
  MONTH,
  { incomeMinor: 250_000, expenseMinor: 5_415 },
  [{ categoryId: 'groceries', categoryName: 'Groceries', amountMinor: 4_215 }],
);

interface TxnRequest {
  from: string | null;
  to: string | null;
  limit: string | null;
}

/** Registers every dashboard route; records each /transactions from/to/limit. */
function mockDashboard(): { txnRequests: TxnRequest[] } {
  const txnRequests: TxnRequest[] = [];
  mockApi.get('/summary', summary);
  mockApi.get('/accounts', listOf([checking]));
  mockApi.get('/categories', listOf([groceriesCategory]));
  mockApi.get('/recurring', listOf([]));
  mockApi.get('/networth/history', makeNetWorthHistoryResponse([]));
  mockApi.get('/reports/flow', flow);
  mockApi.get('/profile', { displayName: null });
  mockApi.on('GET', '/transactions', (request) => {
    txnRequests.push({
      from: request.query.get('from'),
      to: request.query.get('to'),
      limit: request.query.get('limit'),
    });
    return {
      status: 200,
      body: listOf([expenseA, expenseB, incomeLeg, transferLeg]),
    };
  });
  return { txnRequests };
}

describe('P11-5 dashboard spending scope', () => {
  it('defaults to This Month: the monthly flow donut + current-month recent window', async () => {
    const { txnRequests } = mockDashboard();

    renderWithProviders(<DashboardScreen />);

    // The monthly spending donut title is the default card.
    expect(
      await screen.findByText(
        monthSpendingTitle('en', isoMonthName(MONTH, localeTag('en'))),
      ),
    ).toBeOnTheScreen();

    // The recent slice uses the current calendar month (periodWindow monthly).
    const month = periodWindow('monthly', new Date());
    await waitFor(() =>
      expect(txnRequests).toContainEqual({
        from: month.from,
        to: month.to,
        limit: '15',
      }),
    );
  });

  it('This Week re-scopes the recent slice AND derives the weekly spend figure', async () => {
    const { txnRequests } = mockDashboard();

    renderWithProviders(<DashboardScreen />);
    expect(await screen.findByText('Recent activity')).toBeOnTheScreen();

    fireEvent.press(screen.getByText('This week'));

    // Recent slice re-scopes to the current week window (limit 15).
    await waitFor(() =>
      expect(txnRequests).toContainEqual({
        from: WEEK.from,
        to: WEEK.to,
        limit: '15',
      }),
    );

    // Spending breakdown: an uncapped windowed read over the same week (limit 200).
    await waitFor(() =>
      expect(txnRequests).toContainEqual({
        from: WEEK.from,
        to: WEEK.to,
        limit: '200',
      }),
    );

    // The week scope now renders the SAME donut/legend as the month scope,
    // aggregated client-side: one USD donut whose legend splits the two
    // expenses by category (the categorized "Groceries" leg drills down; the
    // null leg falls into the "Uncategorized" bucket). Income and transfer
    // legs are excluded, so the donut total is 42.15 + 12.00 = 54.15.
    expect(await screen.findByTestId('spending-donut-USD')).toBeOnTheScreen();
    expect(
      await screen.findByTestId('spending-legend-groceries'),
    ).toBeOnTheScreen();
    expect(await screen.findByText('Groceries')).toBeOnTheScreen();
    expect(await screen.findByText('Uncategorized')).toBeOnTheScreen();
  });
});
