/**
 * Goals integration: the total-saved hero and one card per goal render
 * server-computed progress through the shared per-currency formatting,
 * linked goals resolve their account label from the independent accounts
 * read, and the designed empty / error / loading states hold.
 */
import { ActivityIndicator } from 'react-native';
import { screen, waitFor } from '@testing-library/react-native';

import GoalsScreen from '../features/goals';
import { formatMinorAmount } from '../src/ui/CurrencyAmount';
import { listOf, makeAccountDto, makeGoalDto } from './fixtures';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';

const checking = makeAccountDto(); // 'Everyday Checking'

const emergencyFund = makeGoalDto({
  goalId: 'goal-emergency',
  name: 'Emergency fund',
  targetMinor: 1_000_000,
  progressMinor: 250_000,
  fundingMode: 'linked-account',
  linkedAccountId: 'acct-checking',
});
const japanTrip = makeGoalDto({
  goalId: 'goal-japan',
  name: 'Japan trip',
  targetMinor: 400_000,
  progressMinor: 100_000,
  fundingMode: 'manual',
});

describe('Goals screen', () => {
  it('renders the hero and one card per goal with shared-formatted money', async () => {
    mockApi.get('/goals', listOf([emergencyFund, japanTrip]));
    mockApi.get('/accounts', listOf([checking]));

    renderWithProviders(<GoalsScreen />);

    expect(await screen.findByText('Emergency fund')).toBeOnTheScreen();
    expect(screen.getByText('Japan trip')).toBeOnTheScreen();

    // Per-goal progress and " / {target}" foot through formatMinorAmount.
    expect(
      screen.getAllByText(formatMinorAmount(250_000, 'USD')).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(` / ${formatMinorAmount(1_000_000, 'USD')}`).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(` / ${formatMinorAmount(400_000, 'USD')}`).length,
    ).toBeGreaterThanOrEqual(1);

    // Hero total: 250_000 + 100_000 saved (single currency).
    expect(
      screen.getAllByText(formatMinorAmount(350_000, 'USD')).length,
    ).toBeGreaterThanOrEqual(1);

    // Linked goal resolves its account label from the accounts read.
    expect(
      screen.getAllByText(/Everyday Checking/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('shows the designed empty state with no goals', async () => {
    mockApi.get('/goals', listOf([]));
    mockApi.get('/accounts', listOf([checking]));

    renderWithProviders(<GoalsScreen />);

    expect(await screen.findByText('No goals yet')).toBeOnTheScreen();
    expect(screen.getByText('New goal')).toBeOnTheScreen();
  });

  it('shows the error state when the goals read fails', async () => {
    mockApi.error('GET', '/goals', 500);
    mockApi.get('/accounts', listOf([checking]));

    renderWithProviders(<GoalsScreen />);

    expect(await screen.findByText('Could not load goals.')).toBeOnTheScreen();
    expect(screen.getByText('Try again')).toBeOnTheScreen();
  });

  it('keeps goals rendered when only the accounts read fails (label degrade)', async () => {
    mockApi.get('/goals', listOf([emergencyFund]));
    mockApi.error('GET', '/accounts', 500);

    renderWithProviders(<GoalsScreen />);

    expect(await screen.findByText('Emergency fund')).toBeOnTheScreen();
    expect(screen.queryByText(/Everyday Checking/)).toBeNull();
  });

  it('holds a spinner while the goals read is in flight', async () => {
    const gate = mockApi.defer('GET', '/goals');
    mockApi.get('/accounts', listOf([checking]));

    renderWithProviders(<GoalsScreen />);

    await waitFor(() => {
      expect(
        screen.UNSAFE_getAllByType(ActivityIndicator).length,
      ).toBeGreaterThan(0);
    });
    expect(screen.queryByText('Emergency fund')).toBeNull();

    gate.resolve({ status: 200, body: listOf([emergencyFund]) });
    expect(await screen.findByText('Emergency fund')).toBeOnTheScreen();
  });
});
