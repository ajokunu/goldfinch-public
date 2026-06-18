/**
 * Manual cost-basis entry on the Investments tab (Investments enrichment,
 * Part A + §9). Tapping an editable aggregate row opens a numeric cost-basis
 * sheet (decimal-pad); saving POSTs the typed TOTAL and optimistically flips the
 * row's gain/% through the SHARED holdingBasis helper before the server replies;
 * an empty draft sends amount:null to CLEAR; any error rolls the row back and
 * surfaces the inline note.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { SetHoldingCostBasisRequest } from '@goldfinch/shared/types';

import InvestmentsScreen from '../features/investments/InvestmentsScreen';
import {
  listOf,
  makeAccountDto,
  makeHoldingDto,
  makeHoldingsResponse,
} from './fixtures';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';

const ACCOUNT_ID = 'acct-brokerage';
const HOLDINGS_PATH = `/accounts/${ACCOUNT_ID}/holdings`;
const COST_BASIS_PATH = `${HOLDINGS_PATH}/VTI/cost-basis`;

// One investment account holding VTI with NO cost basis -> the row is a tappable
// edit target with a dash in the gain column until a basis is entered.
const investmentAccount = makeAccountDto({
  accountId: ACCOUNT_ID,
  name: 'Brokerage',
  overrides: { typeOverride: 'investment' },
});

function vtiNoBasis() {
  return makeHoldingDto({
    holdingId: 'h-vti',
    accountId: ACCOUNT_ID,
    symbol: 'VTI',
    description: 'Vanguard Total Market',
    shares: '10',
    marketValueMinor: 100_000, // $1,000.00
  });
}

// The server response after setting a $600.00 manual basis: gain $400.00, +66%.
function vtiManualBasis() {
  return makeHoldingDto({
    holdingId: 'h-vti',
    accountId: ACCOUNT_ID,
    symbol: 'VTI',
    description: 'Vanguard Total Market',
    shares: '10',
    marketValueMinor: 100_000,
    costBasisMinor: 60_000,
    costBasisSource: 'manual',
  });
}

function mockTab(holdingsItems = [vtiNoBasis()]): void {
  mockApi.get('/accounts', listOf([investmentAccount]));
  mockApi.get(HOLDINGS_PATH, makeHoldingsResponse(holdingsItems));
  // Tapping a row now expands the chart panel, which fans out a per-position
  // price-history read; register it (empty history is fine here) so the mock's
  // unmatched-request guard does not trip while we drive the cost-basis flow.
  mockApi.get(`${HOLDINGS_PATH}/VTI/price-history`, {
    items: [],
    firstSnapshotDate: null,
  });
}

async function openSheet(): Promise<void> {
  renderWithProviders(<InvestmentsScreen />);
  // Tapping the row EXPANDS the inline chart panel; the cost-basis sheet is
  // opened by the explicit "Set cost basis" affordance inside that panel.
  fireEvent.press(await screen.findByTestId('holding-row-VTI'));
  fireEvent.press(await screen.findByText('Set cost basis'));
  await screen.findByTestId('holding-cost-basis-input');
}

describe('holding cost-basis entry', () => {
  it('opens a decimal-pad sheet when an editable row is tapped', async () => {
    mockTab();

    await openSheet();

    const input = screen.getByTestId('holding-cost-basis-input');
    expect(input.props.keyboardType).toBe('decimal-pad');
    expect(input.props.autoCorrect).toBe(false);
  });

  it('POSTs the typed total and optimistically shows the gain before the server replies', async () => {
    mockTab();
    const gate = mockApi.defer('POST', COST_BASIS_PATH);

    await openSheet();
    fireEvent.changeText(screen.getByTestId('holding-cost-basis-input'), '600');
    fireEvent.press(screen.getByText('Save'));

    // Optimistic: gain = 100_000 - 60_000 = 40_000 -> "+$400.00" appears while
    // the POST is still held (recomputed via the shared helper, never inline).
    await waitFor(() =>
      expect(screen.getAllByText('+$400.00').length).toBeGreaterThan(0),
    );

    gate.resolve({ status: 200, body: makeHoldingsResponse([vtiManualBasis()]) });

    await waitFor(() =>
      expect(screen.getAllByText('+$400.00').length).toBeGreaterThan(0),
    );
    expect(
      screen.queryByText('The cost basis could not be saved. Your change was undone.'),
    ).toBeNull();
  });

  it('sends the typed amount as the POST body', async () => {
    mockTab();
    const bodies: SetHoldingCostBasisRequest[] = [];
    mockApi.on('POST', COST_BASIS_PATH, (request) => {
      bodies.push(request.body as SetHoldingCostBasisRequest);
      return { status: 200, body: makeHoldingsResponse([vtiManualBasis()]) };
    });

    await openSheet();
    fireEvent.changeText(screen.getByTestId('holding-cost-basis-input'), '600');
    fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(bodies).toEqual([{ amount: '600' }]));
  });

  it('sends amount:null to CLEAR when the input is emptied', async () => {
    // Start from a row that already has a manual basis so clearing is meaningful.
    mockTab([vtiManualBasis()]);
    const bodies: SetHoldingCostBasisRequest[] = [];
    mockApi.on('POST', COST_BASIS_PATH, (request) => {
      bodies.push(request.body as SetHoldingCostBasisRequest);
      return { status: 200, body: makeHoldingsResponse([vtiNoBasis()]) };
    });

    renderWithProviders(<InvestmentsScreen />);
    fireEvent.press(await screen.findByTestId('holding-row-VTI'));
    fireEvent.press(await screen.findByText('Set cost basis'));
    fireEvent.changeText(await screen.findByTestId('holding-cost-basis-input'), '   ');
    fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(bodies).toEqual([{ amount: null }]));
  });

  it('rolls back and surfaces the inline note on error', async () => {
    mockTab();
    mockApi.error('POST', COST_BASIS_PATH, 400, 'VALIDATION_ERROR', 'bad amount');

    await openSheet();
    fireEvent.changeText(screen.getByTestId('holding-cost-basis-input'), '600');
    fireEvent.press(screen.getByText('Save'));

    expect(
      await screen.findByText(
        'The cost basis could not be saved. Your change was undone.',
      ),
    ).toBeOnTheScreen();
    // The optimistic gain is undone (no basis -> no gain figure for VTI).
    await waitFor(() => expect(screen.queryByText('+$400.00')).toBeNull());
  });
});
