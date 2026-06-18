/**
 * Dashboard (Home) integration: the independent card reads render real
 * content -- server-computed net worth, grouped accounts, recent activity,
 * upcoming bills, monthly spending -- with per-card loading/empty/error
 * isolation, against the live data layer over the mocked fetch edge.
 */
import { ActivityIndicator } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  PROFILE_DISPLAY_NAME_MIN_LENGTH,
} from '@goldfinch/shared/constants';
import type { PatchProfileRequest } from '@goldfinch/shared/types';

import DashboardScreen from '../features/dashboard';
import { GreetingNameSheet } from '../features/dashboard/components/GreetingNameSheet';
import { CardSkeleton } from '../features/dashboard/components/Skeleton';
import {
  isoMonthName,
  monthSpendingTitle,
} from '../features/dashboard/lib/labels';
import { displayNameLengthError, greeting, localeTag } from '../src/i18n';
import { setTokens } from '../src/auth/tokenStore';
import { currentIsoMonth, isoDateDaysAgo, toIsoDate } from '../src/lib/dates';
import { formatMinorAmount } from '../src/ui/CurrencyAmount';
import {
  listOf,
  makeAccountDto,
  makeCategoryDto,
  makeNetWorthHistoryResponse,
  makeRecurringSeriesDto,
  makeReportsFlowResponse,
  makeSummaryResponse,
  makeTransactionDto,
} from './fixtures';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';

const TODAY = toIsoDate(new Date());
const MONTH = currentIsoMonth();

const checking = makeAccountDto(); // 'Everyday Checking', 523_055 minor USD
const visa = makeAccountDto({
  accountId: 'acct-visa',
  name: 'Travel Visa',
  accountType: 'credit',
  balanceMinor: -84_210,
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
    {
      type: 'credit',
      label: 'Credit Cards',
      isLiability: true,
      totalMinor: -84_210,
      accounts: [visa],
    },
  ],
  byInstitution: [
    {
      institution: 'Test Credit Union',
      totalMinor: 438_845,
      accounts: [checking, visa],
    },
  ],
});

const groceriesCategory = makeCategoryDto({
  categoryId: 'groceries',
  name: 'Groceries',
});

const groceries = makeTransactionDto({
  txnId: 'txn-wf',
  date: TODAY,
  payee: 'Whole Foods Market',
  amountMinor: -4_215,
  categoryId: 'groceries',
});
const payroll = makeTransactionDto({
  txnId: 'txn-pay',
  date: isoDateDaysAgo(2),
  payee: 'Acme Payroll',
  amountMinor: 250_000,
  categoryId: null,
});

const netflix = makeRecurringSeriesDto({
  seriesId: 'ser-netflix',
  payee: 'Netflix',
  cadence: 'monthly',
  avgAmountMinor: -1_599,
  lastDate: isoDateDaysAgo(28),
  nextExpectedDate: TODAY,
  status: 'confirmed',
});

const history = makeNetWorthHistoryResponse([
  { date: isoDateDaysAgo(2), assetsMinor: 500_000, liabilitiesMinor: 90_000 },
  { date: isoDateDaysAgo(1), assetsMinor: 510_000, liabilitiesMinor: 87_000 },
  { date: TODAY, assetsMinor: 523_055, liabilitiesMinor: 84_210 },
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
  mockApi.get('/summary', summary);
  mockApi.get('/accounts', listOf([checking, visa]));
  mockApi.get('/transactions', listOf([groceries, payroll]));
  mockApi.get('/categories', listOf([groceriesCategory]));
  mockApi.get('/recurring', listOf([netflix]));
  mockApi.get('/networth/history', history);
  mockApi.get('/reports/flow', flow);
  // The header's greeting read; individual tests override per scenario.
  mockApi.get('/profile', { displayName: null });
}

/** Unsigned JWT with the given payload -- display-claims decoding only. */
function fakeJwt(payload: Record<string, unknown>): string {
  const segment = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${segment({ alg: 'none', typ: 'JWT' })}.${segment(payload)}.signature`;
}

describe('Dashboard screen', () => {
  it('renders net worth, accounts, spending, bills, and recent activity', async () => {
    mockHappyRoutes();
    renderWithProviders(<DashboardScreen />);

    // Net-worth hero: the server-computed minor units through the shared
    // per-currency formatting (reduced motion renders the final frame).
    expect(await screen.findByText('Net worth')).toBeOnTheScreen();
    expect(
      (await screen.findAllByText(formatMinorAmount(438_845, 'USD'))).length,
    ).toBeGreaterThanOrEqual(1);

    // Accounts card: group labels and account rows with real names/balances.
    expect(await screen.findByText('Accounts')).toBeOnTheScreen();
    expect(screen.getByText('Everyday Checking')).toBeOnTheScreen();
    expect(screen.getByText('Travel Visa')).toBeOnTheScreen();
    expect(
      screen.getAllByText(formatMinorAmount(523_055, 'USD')).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(formatMinorAmount(-84_210, 'USD')).length,
    ).toBeGreaterThanOrEqual(1);

    // Spending donut card for the current month.
    expect(
      await screen.findByText(
        monthSpendingTitle('en', isoMonthName(MONTH, localeTag('en'))),
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('Groceries')).toBeOnTheScreen();

    // Upcoming bills (recurring read) + recent activity rows.
    expect(await screen.findByText('Upcoming bills')).toBeOnTheScreen();
    expect(screen.getByText('Netflix')).toBeOnTheScreen();
    expect(await screen.findByText('Recent activity')).toBeOnTheScreen();
    expect(screen.getByText('Whole Foods Market')).toBeOnTheScreen();
    expect(screen.getByText('Acme Payroll')).toBeOnTheScreen();
  });

  it('mounts the greeting-first cascade structure (P9-2 item 1)', async () => {
    // The greeting rides its own FadeRise entrance wrapper ahead of the card
    // cascade; the wrapper testID documents that the app-open cascade is
    // wired (greeting first, sections following at the 45ms interval).
    // Reduced motion (suite default) renders the final frame immediately, so
    // the same structure also proves the entrance never gates content.
    mockHappyRoutes();
    renderWithProviders(<DashboardScreen />);

    expect(
      await screen.findByTestId('dash-greeting-entrance'),
    ).toBeOnTheScreen();
    expect(await screen.findByText('Net worth')).toBeOnTheScreen();
    expect(await screen.findByText('Recent activity')).toBeOnTheScreen();
  });

  it('holds skeletons while reads are in flight, then renders content', async () => {
    const summaryGate = mockApi.defer('GET', '/summary');
    const transactionsGate = mockApi.defer('GET', '/transactions');
    mockApi.get('/accounts', listOf([checking, visa]));
    mockApi.get('/categories', listOf([groceriesCategory]));
    mockApi.get('/recurring', listOf([netflix]));
    mockApi.get('/networth/history', history);
    mockApi.get('/reports/flow', flow);
    mockApi.get('/profile', { displayName: null });

    renderWithProviders(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.UNSAFE_getAllByType(CardSkeleton).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Everyday Checking')).toBeNull();

    summaryGate.resolve({ status: 200, body: summary });
    transactionsGate.resolve({
      status: 200,
      body: listOf([groceries, payroll]),
    });

    expect(await screen.findByText('Everyday Checking')).toBeOnTheScreen();
    expect(await screen.findByText('Whole Foods Market')).toBeOnTheScreen();
    expect(screen.UNSAFE_queryAllByType(CardSkeleton)).toHaveLength(0);
  });

  it('shows the connect-your-first-account empty state with no accounts', async () => {
    mockApi.get(
      '/summary',
      makeSummaryResponse({
        netWorthMinor: 0,
        assetsTotalMinor: 0,
        liabilitiesTotalMinor: 0,
        byType: [],
      }),
    );
    mockApi.get('/accounts', listOf([]));
    mockApi.get('/transactions', listOf([]));
    mockApi.get('/categories', listOf([]));
    mockApi.get('/recurring', listOf([]));
    mockApi.get('/networth/history', makeNetWorthHistoryResponse([]));
    mockApi.get(
      '/reports/flow',
      makeReportsFlowResponse(MONTH, { incomeMinor: 0, expenseMinor: 0 }, []),
    );
    mockApi.get('/profile', { displayName: null });

    renderWithProviders(<DashboardScreen />);

    expect(
      await screen.findByText('Connect your first account'),
    ).toBeOnTheScreen();
    expect(await screen.findByText('No transactions yet')).toBeOnTheScreen();
    expect(
      await screen.findByText('No recurring bills detected yet'),
    ).toBeOnTheScreen();
  });

  it('degrades only the summary card on a summary failure, and retries', async () => {
    mockHappyRoutes();
    mockApi.error('GET', '/summary', 500);

    renderWithProviders(<DashboardScreen />);

    expect(
      await screen.findByText('Could not load your summary'),
    ).toBeOnTheScreen();
    // Other cards keep their real content (per-card isolation).
    expect(await screen.findByText('Whole Foods Market')).toBeOnTheScreen();
    expect(await screen.findByText('Netflix')).toBeOnTheScreen();

    // Retry: fix the route, press the card's retry affordance.
    mockApi.get('/summary', summary);
    fireEvent.press(screen.getByLabelText('Try again'));
    expect(
      (await screen.findAllByText(formatMinorAmount(438_845, 'USD'))).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Could not load your summary')).toBeNull();
  });

  it('shows the recent-activity error state when transactions fail', async () => {
    mockHappyRoutes();
    mockApi.error('GET', '/transactions', 500);

    renderWithProviders(<DashboardScreen />);

    expect(
      await screen.findByText('Could not load recent activity'),
    ).toBeOnTheScreen();
    // The summary read is unaffected.
    expect(
      (await screen.findAllByText(formatMinorAmount(438_845, 'USD'))).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toBeDefined();
  });
});

describe('Dashboard greeting (display name)', () => {
  // The greeting is time-of-day dependent; build expectations through the
  // same i18n function the header uses, at the test's own current hour.
  const HOUR = new Date().getHours();

  it('prefers the user-chosen profile display name over the claim label', async () => {
    mockHappyRoutes();
    mockApi.get('/profile', { displayName: 'Dami' });
    await setTokens({
      accessToken: 'test-access-token',
      idToken: fakeJwt({ email: 'wpffkejd@example.com' }),
    });

    renderWithProviders(<DashboardScreen />);

    expect(
      await screen.findByText(greeting('en', HOUR, 'Dami')),
    ).toBeOnTheScreen();
    expect(screen.queryByText(greeting('en', HOUR, 'wpffkejd'))).toBeNull();
  });

  it('falls back to the email local-part when no display name is set', async () => {
    mockHappyRoutes(); // GET /profile -> { displayName: null }
    await setTokens({
      accessToken: 'test-access-token',
      idToken: fakeJwt({ email: 'wpffkejd@example.com' }),
    });

    renderWithProviders(<DashboardScreen />);

    expect(
      await screen.findByText(greeting('en', HOUR, 'wpffkejd')),
    ).toBeOnTheScreen();
  });

  it('falls back to the given_name claim when the profile read 404s', async () => {
    mockHappyRoutes();
    mockApi.error(
      'GET',
      '/profile',
      404,
      'NOT_FOUND',
      'no profile exists for this user yet',
    );
    await setTokens({
      accessToken: 'test-access-token',
      idToken: fakeJwt({ given_name: 'Aaron' }),
    });

    renderWithProviders(<DashboardScreen />);

    expect(
      await screen.findByText(greeting('en', HOUR, 'Aaron')),
    ).toBeOnTheScreen();
  });

  it('renders the bare greeting when neither profile nor claims have a name', async () => {
    mockHappyRoutes();

    renderWithProviders(<DashboardScreen />);

    expect(await screen.findByText(greeting('en', HOUR))).toBeOnTheScreen();
  });
});

describe('P8 greeting name edit', () => {
  const HOUR = new Date().getHours();

  /** Happy dashboard + a stateful profile the PATCH route can flip. */
  function mockEditableProfile(initialName: string): {
    patchBodies: PatchProfileRequest[];
  } {
    let displayName = initialName;
    const patchBodies: PatchProfileRequest[] = [];
    mockHappyRoutes();
    mockApi.on('GET', '/profile', () => ({
      status: 200,
      body: { displayName },
    }));
    mockApi.on('PATCH', '/profile', (request) => {
      const body = request.body as PatchProfileRequest;
      patchBodies.push(body);
      displayName = body.displayName;
      return { status: 200, body: { displayName } };
    });
    return { patchBodies };
  }

  async function openSheet(): Promise<void> {
    renderWithProviders(<DashboardScreen />);
    fireEvent.press(await screen.findByTestId('dash-greeting'));
    await screen.findByTestId('greeting-name-input');
  }

  it('opens the edit sheet from the greeting, prefilled with the current name', async () => {
    mockEditableProfile('Dami');

    await openSheet();

    const input = await screen.findByTestId('greeting-name-input');
    await waitFor(() => expect(input.props.value).toBe('Dami'));
    expect(screen.getByText('Save name')).toBeOnTheScreen();
  });

  it('saves through the same optimistic PATCH as Settings', async () => {
    mockEditableProfile('Dami');
    // Hold the PATCH so the optimistic window is observable.
    const gate = mockApi.defer('PATCH', '/profile');

    await openSheet();
    fireEvent.changeText(screen.getByTestId('greeting-name-input'), '  Mina  ');
    fireEvent.press(screen.getByText('Save name'));

    // Optimistic: the greeting flips while the PATCH is still in flight.
    expect(
      await screen.findByText(greeting('en', HOUR, 'Mina')),
    ).toBeOnTheScreen();

    gate.resolve({ status: 200, body: { displayName: 'Mina' } });

    // Converged: the settled invalidation refetches GET /profile (Mina here)
    // and no failure note ever appears.
    await waitFor(() =>
      expect(screen.getByText(greeting('en', HOUR, 'Mina'))).toBeOnTheScreen(),
    );
    expect(screen.queryByText('Could not save your name')).toBeNull();
  });

  it('requests close exactly once, on the successful save', async () => {
    // The sheet's own close contract, asserted directly (the ModalSheet
    // unmount itself rides an Animated completion the jest native-animated
    // mock never fires, so the dashboard-level tree cannot observe it).
    mockApi.get('/profile', { displayName: 'Dami' });
    mockApi.on('PATCH', '/profile', {
      status: 200,
      body: { displayName: 'Mina' },
    });
    const onClose = jest.fn();
    renderWithProviders(<GreetingNameSheet visible onClose={onClose} />);

    fireEvent.changeText(
      await screen.findByTestId('greeting-name-input'),
      'Mina',
    );
    fireEvent.press(screen.getByText('Save name'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does not request close when the save fails', async () => {
    mockApi.get('/profile', { displayName: 'Dami' });
    mockApi.error('PATCH', '/profile', 409, 'VERSION_CONFLICT', 'lost the race');
    const onClose = jest.fn();
    renderWithProviders(<GreetingNameSheet visible onClose={onClose} />);

    fireEvent.changeText(
      await screen.findByTestId('greeting-name-input'),
      'Mina',
    );
    fireEvent.press(screen.getByText('Save name'));

    expect(
      await screen.findByText('Could not save your name'),
    ).toBeOnTheScreen();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends the trimmed name as the PATCH body', async () => {
    const { patchBodies } = mockEditableProfile('Dami');

    await openSheet();
    fireEvent.changeText(screen.getByTestId('greeting-name-input'), '  Mina  ');
    fireEvent.press(screen.getByText('Save name'));

    await waitFor(() =>
      expect(patchBodies).toEqual([{ displayName: 'Mina' }]),
    );
  });

  it('rejects an out-of-bounds name locally without any PATCH', async () => {
    // No PATCH route registered: a stray request would fail in teardown.
    mockHappyRoutes();
    mockApi.get('/profile', { displayName: 'Dami' });

    await openSheet();
    fireEvent.changeText(screen.getByTestId('greeting-name-input'), '   ');
    fireEvent.press(screen.getByText('Save name'));

    expect(
      await screen.findByText(
        displayNameLengthError(
          'en',
          PROFILE_DISPLAY_NAME_MIN_LENGTH,
          PROFILE_DISPLAY_NAME_MAX_LENGTH,
        ),
      ),
    ).toBeOnTheScreen();
    // The sheet stays open for correction.
    expect(screen.getByTestId('greeting-name-input')).toBeOnTheScreen();
  });

  it('rolls the greeting back and keeps the sheet open on a 409', async () => {
    mockHappyRoutes();
    mockApi.get('/profile', { displayName: 'Dami' });
    mockApi.error('PATCH', '/profile', 409, 'VERSION_CONFLICT', 'other device won');

    await openSheet();
    fireEvent.changeText(screen.getByTestId('greeting-name-input'), 'Mina');
    fireEvent.press(screen.getByText('Save name'));

    // Failure surfaces inline; the optimistic greeting rolls back to the
    // server name (the settled refetch also returns Dami).
    expect(
      await screen.findByText('Could not save your name'),
    ).toBeOnTheScreen();
    await waitFor(() =>
      expect(
        screen.getByText(greeting('en', HOUR, 'Dami')),
      ).toBeOnTheScreen(),
    );
    expect(screen.queryByText(greeting('en', HOUR, 'Mina'))).toBeNull();
    expect(screen.getByTestId('greeting-name-input')).toBeOnTheScreen();
  });
});
