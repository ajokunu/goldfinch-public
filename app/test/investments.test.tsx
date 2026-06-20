/**
 * Investments tab integration: the aggregate holdings view fans out one
 * GET /accounts/{id}/holdings per INVESTMENT account, folds the rows by
 * ticker, and renders a per-currency hero total + a symbol-grouped table.
 *
 * It verifies the cross-account contract end to end through the real data
 * layer (endpoints + queryKeys + TanStack hooks) over the fetch mock: only
 * investment accounts are queried, holdingsSupported:false contributes no rows
 * (and is surfaced, never blank, P7-3), and the designed empty/error states
 * hold. Money masking in privacy mode is asserted on the totals.
 */
import { ActivityIndicator } from 'react-native';
import { screen, waitFor } from '@testing-library/react-native';

import InvestmentsScreen from '../features/investments/InvestmentsScreen';
import { formatMinorAmount } from '../src/ui/CurrencyAmount';
import { HIDDEN_AMOUNT, useUiStore } from '../src/state/uiStore';
import {
  listOf,
  makeAccountDto,
  makeHoldingDto,
  makeHoldingsResponse,
} from './fixtures';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';

const checking = makeAccountDto({
  accountId: 'acct-checking',
  accountType: 'checking',
  name: 'Everyday Checking',
});
const brokerage = makeAccountDto({
  accountId: 'acct-brokerage',
  accountType: 'investment',
  name: 'Brokerage',
  institution: 'Vanguard',
});
const ira = makeAccountDto({
  accountId: 'acct-ira',
  accountType: 'investment',
  name: 'Roth IRA',
  institution: 'Vanguard',
});

describe('Investments tab', () => {
  it('aggregates the same ticker across two investment accounts with a per-currency hero total', async () => {
    mockApi.get('/accounts', listOf([checking, brokerage, ira]));
    // VTI is held in BOTH investment accounts; the non-investment checking
    // account must never be queried (asserted by the teardown unmatched check
    // -- no /accounts/acct-checking/holdings route is registered).
    mockApi.get(
      '/accounts/acct-brokerage/holdings',
      makeHoldingsResponse([
        makeHoldingDto({
          holdingId: 'h-vti-1',
          accountId: 'acct-brokerage',
          symbol: 'VTI',
          description: 'Vanguard Total Market',
          shares: '1.5',
          marketValueMinor: 30_000,
          costBasisMinor: 20_000,
        }),
      ]),
    );
    mockApi.get(
      '/accounts/acct-ira/holdings',
      makeHoldingsResponse([
        makeHoldingDto({
          holdingId: 'h-vti-2',
          accountId: 'acct-ira',
          symbol: 'VTI',
          description: 'Vanguard Total Market',
          shares: '2.25',
          marketValueMinor: 45_000,
          costBasisMinor: 30_000,
        }),
      ]),
    );

    renderWithProviders(<InvestmentsScreen />);

    // One grouped row for VTI with the summed exact share count (1.5 + 2.25).
    expect(await screen.findByText('VTI')).toBeOnTheScreen();
    expect(screen.getByText('3.75')).toBeOnTheScreen();

    // Per-currency hero + table total: 30_000 + 45_000 market value.
    expect(
      screen.getAllByText(formatMinorAmount(75_000, 'USD')).length,
    ).toBeGreaterThanOrEqual(1);
    // Cost basis total (complete): 20_000 + 30_000. The hero renders it inside a
    // labeled caption ("Cost basis $500.00"), so match the amount as a substring
    // (RegExp) of the text node rather than as a standalone element.
    const costBasisTotal = formatMinorAmount(50_000, 'USD');
    const costBasisPattern = new RegExp(
      costBasisTotal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    expect(screen.getAllByText(costBasisPattern).length).toBeGreaterThanOrEqual(1);
  });

  it('counts holdingsSupported:false accounts as unsupported, never blank', async () => {
    mockApi.get('/accounts', listOf([brokerage, ira]));
    mockApi.get(
      '/accounts/acct-brokerage/holdings',
      makeHoldingsResponse([
        makeHoldingDto({
          holdingId: 'h-voo',
          accountId: 'acct-brokerage',
          symbol: 'VOO',
          description: 'Vanguard S&P 500',
          shares: '4',
          marketValueMinor: 100_000,
          costBasisMinor: 80_000,
        }),
      ]),
    );
    // The IRA does not provide holdings.
    mockApi.get('/accounts/acct-ira/holdings', makeHoldingsResponse([], false));

    renderWithProviders(<InvestmentsScreen />);

    expect(await screen.findByText('VOO')).toBeOnTheScreen();
    // The unsupported account is surfaced as an explicit caption.
    expect(
      screen.getByText('1 account does not provide holdings.'),
    ).toBeOnTheScreen();
  });

  it('shows the no-investment-accounts empty state', async () => {
    mockApi.get('/accounts', listOf([checking]));

    renderWithProviders(<InvestmentsScreen />);

    expect(
      await screen.findByText('No investment accounts'),
    ).toBeOnTheScreen();
  });

  it('shows the holdings-not-provided state when every investment account is unsupported', async () => {
    mockApi.get('/accounts', listOf([brokerage, ira]));
    mockApi.get(
      '/accounts/acct-brokerage/holdings',
      makeHoldingsResponse([], false),
    );
    mockApi.get('/accounts/acct-ira/holdings', makeHoldingsResponse([], false));

    renderWithProviders(<InvestmentsScreen />);

    expect(await screen.findByText('Holdings not provided')).toBeOnTheScreen();
  });

  it('shows the no-holdings-yet state when supported accounts report zero positions', async () => {
    mockApi.get('/accounts', listOf([brokerage]));
    mockApi.get('/accounts/acct-brokerage/holdings', makeHoldingsResponse([]));

    renderWithProviders(<InvestmentsScreen />);

    expect(await screen.findByText('No holdings yet')).toBeOnTheScreen();
  });

  it('surfaces the error state when a holdings read fails', async () => {
    mockApi.get('/accounts', listOf([brokerage]));
    mockApi.error('GET', '/accounts/acct-brokerage/holdings', 500);

    renderWithProviders(<InvestmentsScreen />);

    expect(
      await screen.findByText('Holdings could not be loaded.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Try again')).toBeOnTheScreen();
  });

  it('masks the totals when privacy mode is on', async () => {
    // Hidden requires privacyMode AND no active reveal (the "open hidden"
    // contract from uiStore).
    useUiStore.setState({ privacyMode: true, valuesRevealed: false });
    mockApi.get('/accounts', listOf([brokerage]));
    mockApi.get(
      '/accounts/acct-brokerage/holdings',
      makeHoldingsResponse([
        makeHoldingDto({
          holdingId: 'h-voo',
          accountId: 'acct-brokerage',
          symbol: 'VOO',
          shares: '4',
          marketValueMinor: 100_000,
          costBasisMinor: 80_000,
        }),
      ]),
    );

    renderWithProviders(<InvestmentsScreen />);

    expect(await screen.findByText('VOO')).toBeOnTheScreen();
    // The unmasked total must not be visible; HIDDEN_AMOUNT appears instead.
    expect(screen.queryByText(formatMinorAmount(100_000, 'USD'))).toBeNull();
    expect(
      screen.getAllByText(HIDDEN_AMOUNT).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('holds a spinner while the accounts read is in flight', async () => {
    const gate = mockApi.defer('GET', '/accounts');

    renderWithProviders(<InvestmentsScreen />);

    await waitFor(() => {
      expect(
        screen.UNSAFE_getAllByType(ActivityIndicator).length,
      ).toBeGreaterThan(0);
    });

    gate.resolve({ status: 200, body: listOf([checking]) });
    expect(
      await screen.findByText('No investment accounts'),
    ).toBeOnTheScreen();
  });
});
