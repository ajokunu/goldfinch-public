/**
 * Reports integration: the three independent reads (net-worth history,
 * monthly trends, per-month flow) render their cards with real content and
 * isolate loading/empty/error per card -- one failing endpoint degrades only
 * its own card (P7-4 posture, screens.md section 4).
 */
import { ActivityIndicator } from 'react-native';
import { screen, waitFor } from '@testing-library/react-native';

import ReportsScreen from '../features/reports';
import { whereMonthWent } from '../features/reports/lib/labels';
import { currentIsoMonth, isoDateDaysAgo, isoMonthLabel, toIsoDate } from '../src/lib/dates';
import { formatMinorAmount } from '../src/ui/CurrencyAmount';
import {
  makeNetWorthHistoryResponse,
  makeReportsFlowResponse,
  makeReportsTrendsResponse,
} from './fixtures';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';

const TODAY = toIsoDate(new Date());
const MONTH = currentIsoMonth();

const history = makeNetWorthHistoryResponse([
  { date: isoDateDaysAgo(2), assetsMinor: 500_000, liabilitiesMinor: 90_000 },
  { date: isoDateDaysAgo(1), assetsMinor: 510_000, liabilitiesMinor: 87_000 },
  { date: TODAY, assetsMinor: 523_055, liabilitiesMinor: 84_210 },
]);

const trends = makeReportsTrendsResponse([
  { month: MONTH, slice: { incomeMinor: 250_000, expenseMinor: 46_365 } },
]);

const flow = makeReportsFlowResponse(
  MONTH,
  { incomeMinor: 250_000, expenseMinor: 46_365 },
  [
    { categoryId: 'groceries', categoryName: 'Groceries', amountMinor: 42_150 },
    { categoryId: null, categoryName: 'Uncategorized', amountMinor: 4_215 },
  ],
);

function mockHappyRoutes(): void {
  mockApi.get('/networth/history', history);
  mockApi.get('/reports/trends', trends);
  mockApi.get('/reports/flow', flow);
}

describe('Reports screen', () => {
  it('renders all three report cards with real content', async () => {
    mockHappyRoutes();
    renderWithProviders(<ReportsScreen />);

    expect(await screen.findByText('Reports')).toBeOnTheScreen();
    expect(await screen.findByText('Net worth trend')).toBeOnTheScreen();
    expect(screen.getByText('Monthly trends')).toBeOnTheScreen();
    expect(
      screen.getByText(whereMonthWent('en', isoMonthLabel(MONTH))),
    ).toBeOnTheScreen();

    // Flow card: the Income | Spending | Saved figures row and the
    // single-currency income eyebrow ("{income} in"), all through the
    // shared per-currency formatting. (Category edge labels render inside
    // the SVG flow diagram, outside RN text queries.)
    expect(await screen.findByText('Spending')).toBeOnTheScreen();
    expect(screen.getAllByText('Saved').length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(formatMinorAmount(46_365, 'USD')).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(formatMinorAmount(250_000 - 46_365, 'USD')).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(`${formatMinorAmount(250_000, 'USD')} in`),
    ).toBeOnTheScreen();
  });

  it('degrades only the failing card and keeps the other two', async () => {
    mockApi.error('GET', '/networth/history', 500);
    mockApi.get('/reports/trends', trends);
    mockApi.get('/reports/flow', flow);

    renderWithProviders(<ReportsScreen />);

    expect(
      await screen.findByText('Could not load net-worth history.'),
    ).toBeOnTheScreen();
    // Trends and flow keep their real content.
    expect(await screen.findByText('Monthly trends')).toBeOnTheScreen();
    expect((await screen.findAllByText('Saved')).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText('Try again')).toBeOnTheScreen();
  });

  it('shows each card empty state when its data is empty', async () => {
    mockApi.get('/networth/history', makeNetWorthHistoryResponse([]));
    mockApi.get('/reports/trends', makeReportsTrendsResponse([]));
    mockApi.get(
      '/reports/flow',
      makeReportsFlowResponse(MONTH, { incomeMinor: 0, expenseMinor: 0 }, []),
    );

    renderWithProviders(<ReportsScreen />);

    expect(
      await screen.findByText('No net-worth history yet'),
    ).toBeOnTheScreen();
    expect(
      await screen.findByText('No activity in this window'),
    ).toBeOnTheScreen();
    expect(
      await screen.findByText(`No cash flow in ${isoMonthLabel(MONTH)}`),
    ).toBeOnTheScreen();
  });

  it('holds spinners while all three reads are in flight', async () => {
    const historyGate = mockApi.defer('GET', '/networth/history');
    const trendsGate = mockApi.defer('GET', '/reports/trends');
    const flowGate = mockApi.defer('GET', '/reports/flow');

    renderWithProviders(<ReportsScreen />);

    await waitFor(() => {
      expect(
        screen.UNSAFE_getAllByType(ActivityIndicator).length,
      ).toBeGreaterThanOrEqual(3);
    });
    expect(screen.queryAllByText('Saved')).toHaveLength(0);

    historyGate.resolve({ status: 200, body: history });
    trendsGate.resolve({ status: 200, body: trends });
    flowGate.resolve({ status: 200, body: flow });

    expect((await screen.findAllByText('Saved')).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });
});
