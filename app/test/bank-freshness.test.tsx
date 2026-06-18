/**
 * Bank-data freshness line: shows the as-of time + relative age, flips to the
 * stale treatment past the threshold, and "Sync now" issues POST /sync/run and
 * invalidates the bank-fed queries.
 */
import { fireEvent, waitFor } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { BankFreshness } from '../features/dashboard/components/BankFreshness';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';

const HOUR = 3600;

beforeEach(() => mockApi.install());
afterEach(() => {
  mockApi.reset();
  mockApi.uninstall();
});

describe('bank-data freshness', () => {
  it('renders the as-of caption with a relative age', () => {
    const asOf = Math.floor(Date.now() / 1000) - 2 * HOUR;
    const { getByText } = renderWithProviders(<BankFreshness asOf={asOf} />);
    expect(getByText(/Bank data/)).toBeTruthy();
    expect(getByText(/2h ago/)).toBeTruthy();
  });

  it('treats a few days as normal lag, not stale (SimpleFIN ingestion delay)', () => {
    const asOf = Math.floor(Date.now() / 1000) - 48 * HOUR; // 2 days
    const { getByText, queryByText } = renderWithProviders(
      <BankFreshness asOf={asOf} />,
    );
    expect(getByText(/2 days ago/)).toBeTruthy();
    expect(getByText(/banks can lag a few days/)).toBeTruthy();
    expect(queryByText(/refresh in SimpleFIN/)).toBeNull();
  });

  it('warns to refresh in SimpleFIN only once genuinely stuck (>5 days)', () => {
    const asOf = Math.floor(Date.now() / 1000) - 7 * 24 * HOUR; // 7 days
    const { getByText } = renderWithProviders(<BankFreshness asOf={asOf} />);
    expect(getByText(/refresh in SimpleFIN/)).toBeTruthy();
  });

  it('Sync now POSTs /sync/run', async () => {
    let hit = false;
    mockApi.on('POST', '/sync/run', () => {
      hit = true;
      return { status: 202, body: { accepted: true } };
    });
    const asOf = Math.floor(Date.now() / 1000) - HOUR;
    const { getByText } = renderWithProviders(<BankFreshness asOf={asOf} />);
    fireEvent.press(getByText('Sync now'));
    await waitFor(() => expect(hit).toBe(true));
  });
});
