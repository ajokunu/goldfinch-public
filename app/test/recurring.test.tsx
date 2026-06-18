/**
 * Recurring integration: one GET /recurring read behind two sub-views --
 * Upcoming (bills-due hero + series rows with cadence pills and
 * shared-formatted averages) and Review (detected series with the count in
 * the tab label) -- plus the error and loading states.
 */
import { ActivityIndicator } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import RecurringScreen from '../features/recurring';
import { isoDateDaysAgo, toIsoDate } from '../src/lib/dates';
import { formatMinorAmount } from '../src/ui/CurrencyAmount';
import { listOf, makeRecurringSeriesDto } from './fixtures';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';

const TODAY = toIsoDate(new Date());

const netflix = makeRecurringSeriesDto({
  seriesId: 'ser-netflix',
  payee: 'Netflix',
  cadence: 'monthly',
  avgAmountMinor: -1_599,
  lastDate: isoDateDaysAgo(28),
  nextExpectedDate: TODAY,
  status: 'confirmed',
});
const payroll = makeRecurringSeriesDto({
  seriesId: 'ser-payroll',
  payee: 'Acme Payroll',
  cadence: 'biweekly',
  avgAmountMinor: 250_000,
  lastDate: isoDateDaysAgo(10),
  nextExpectedDate: isoDateDaysAgo(-4),
  status: 'confirmed',
});
const spotify = makeRecurringSeriesDto({
  seriesId: 'ser-spotify',
  payee: 'Spotify',
  cadence: 'monthly',
  avgAmountMinor: -999,
  lastDate: isoDateDaysAgo(5),
  nextExpectedDate: isoDateDaysAgo(-25),
  status: 'detected',
});

describe('Recurring screen', () => {
  it('renders the upcoming view with series rows and shared-formatted amounts', async () => {
    mockApi.get('/recurring', listOf([netflix, payroll, spotify]));

    renderWithProviders(<RecurringScreen />);

    expect(await screen.findByText('Upcoming')).toBeOnTheScreen();
    expect(await screen.findByText('Netflix')).toBeOnTheScreen();
    expect(screen.getByText('Acme Payroll')).toBeOnTheScreen();

    expect(
      screen.getAllByText(formatMinorAmount(-1_599, 'USD')).length,
    ).toBeGreaterThanOrEqual(1);
    // Income series render their average with an explicit plus sign.
    expect(
      screen.getAllByText(
        formatMinorAmount(250_000, 'USD', { signDisplay: 'always' }),
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('shows the detected count in the Review tab and lists it there', async () => {
    mockApi.get('/recurring', listOf([netflix, spotify]));

    renderWithProviders(<RecurringScreen />);

    const reviewTab = await screen.findByText('Review (1)');
    fireEvent.press(reviewTab);

    expect(await screen.findByText('Spotify')).toBeOnTheScreen();
  });

  it('shows the error state with retry when the read fails', async () => {
    mockApi.error('GET', '/recurring', 500);

    renderWithProviders(<RecurringScreen />);

    expect(
      await screen.findByText('Could not load recurring series.'),
    ).toBeOnTheScreen();

    mockApi.get('/recurring', listOf([netflix]));
    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Netflix')).toBeOnTheScreen();
  });

  it('holds a spinner while the read is in flight', async () => {
    const gate = mockApi.defer('GET', '/recurring');

    renderWithProviders(<RecurringScreen />);

    await waitFor(() => {
      expect(
        screen.UNSAFE_getAllByType(ActivityIndicator).length,
      ).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Netflix')).toBeNull();

    gate.resolve({ status: 200, body: listOf([netflix]) });
    expect(await screen.findByText('Netflix')).toBeOnTheScreen();
  });
});
