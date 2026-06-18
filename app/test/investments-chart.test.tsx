/**
 * Investments per-holding return chart (INVESTMENTS-CHART-PLAN): tapping an
 * editable holding row no longer opens the cost-basis sheet directly -- it
 * EXPANDS an inline dropdown panel beneath the row that renders the normalized
 * %-return chart, a range toggle (1M/3M/6M/1Y), and an explicit "Set cost basis"
 * affordance. This suite exercises that interaction end to end over the real
 * data layer (endpoints + queryKeys + the useHoldingReturnSeries hook) against
 * the fetch mock:
 *
 * - expanding a row with accrued history renders the chart (no accrues-from
 *   copy), proving the price-history read is fanned out and normalized;
 * - a row whose history is empty shows the "History accrues from <date>" copy
 *   (mirrors the net-worth chart's sparse/empty honesty rule);
 * - the "Set cost basis" button inside the expanded panel still opens the
 *   existing HoldingCostBasisSheet -- cost-basis entry is NOT regressed by the
 *   tap-conflict resolution.
 *
 * Anchors are the contract-pinned surfaces only: the stable row/sheet testIDs
 * the cost-basis suite already depends on, the "Set cost basis" button label
 * (rendered as Text, present only when the panel is expanded), and a regex on
 * the load-bearing "History accrues from" lead phrase (not the full sentence,
 * which would false-fail on a one-character copy drift). The chart's own SVG
 * internals and testID are deliberately not asserted -- no contract pins them.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { HoldingPriceHistoryResponse } from '@goldfinch/shared/types';

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
// The hook fans out per (accountId, symbol); mockApi keys on the pathname only,
// so the range's from/to query string is matched implicitly (any window hits
// this same route). A clean ticker means encodeURIComponent leaves the path
// literal.
const PRICE_HISTORY_PATH = `${HOLDINGS_PATH}/VTI/price-history`;

// One investment account holding a single VTI lot -> exactly one editable
// (single-account, symboled) row, so exactly one price-history route exists.
const investmentAccount = makeAccountDto({
  accountId: ACCOUNT_ID,
  name: 'Brokerage',
  overrides: { typeOverride: 'investment' },
});

function vti() {
  return makeHoldingDto({
    holdingId: 'h-vti',
    accountId: ACCOUNT_ID,
    symbol: 'VTI',
    description: 'Vanguard Total Market',
    shares: '10',
    marketValueMinor: 120_000, // $1,200.00
  });
}

// Two ascending, positive price-per-share points -> the shared
// normalizeReturnSeries has a valid baseline and windowReturnPercent is defined
// (>= 2 usable points), so the chart takes its rendered-data path.
const HISTORY_SUFFICIENT: HoldingPriceHistoryResponse = {
  items: [
    { date: '2025-07-01', pricePerShare: '100.00', pricePerShareMinor: 10_000 },
    { date: '2026-06-15', pricePerShare: '120.00', pricePerShareMinor: 12_000 },
  ],
  firstSnapshotDate: '2025-07-01',
};

// No accrued points yet (< 2 usable) -> windowReturnPercent undefined; the chart
// states its accrual start date instead of drawing a line.
const HISTORY_EMPTY: HoldingPriceHistoryResponse = {
  items: [],
  firstSnapshotDate: '2026-06-15',
};

/**
 * Wire the accounts + holdings reads and the per-position price-history read.
 * The price-history route is registered unconditionally (regardless of whether
 * the hook enables its query on mount or only on expand) so the setup teardown's
 * unmatched-request assertion never trips on it.
 */
function mockTab(history: HoldingPriceHistoryResponse): void {
  mockApi.get('/accounts', listOf([investmentAccount]));
  mockApi.get(HOLDINGS_PATH, makeHoldingsResponse([vti()]));
  mockApi.get(PRICE_HISTORY_PATH, history);
}

describe('investments per-holding return chart', () => {
  it('expands an inline chart panel when an editable row is tapped', async () => {
    mockTab(HISTORY_SUFFICIENT);

    renderWithProviders(<InvestmentsScreen />);

    // The panel is collapsed initially: no expanded-only affordance yet.
    const row = await screen.findByTestId('holding-row-VTI');
    expect(screen.queryByText('Set cost basis')).toBeNull();

    fireEvent.press(row);

    // Expanded: the panel's "Set cost basis" affordance appears and the chart
    // is in its rendered-data state (the accrual-start copy is NOT shown,
    // because there are >= 2 usable points).
    expect(await screen.findByText('Set cost basis')).toBeOnTheScreen();
    expect(screen.queryByText(/History accrues from/)).toBeNull();
  });

  it('shows the accrues-from copy when the holding has no accrued history', async () => {
    mockTab(HISTORY_EMPTY);

    renderWithProviders(<InvestmentsScreen />);

    fireEvent.press(await screen.findByTestId('holding-row-VTI'));

    // Sparse/empty history: the chart states its accrual start date rather than
    // drawing a line (mirrors the net-worth chart). Anchor on the load-bearing
    // lead phrase, not the full sentence.
    expect(await screen.findByText(/History accrues from/)).toBeOnTheScreen();
  });

  it('collapses the panel when an expanded row is tapped again', async () => {
    mockTab(HISTORY_SUFFICIENT);

    renderWithProviders(<InvestmentsScreen />);

    const row = await screen.findByTestId('holding-row-VTI');
    fireEvent.press(row);
    expect(await screen.findByText('Set cost basis')).toBeOnTheScreen();

    fireEvent.press(row);
    await waitFor(() => expect(screen.queryByText('Set cost basis')).toBeNull());
  });

  it('still opens the cost-basis sheet from the expanded panel (cost-basis not regressed)', async () => {
    mockTab(HISTORY_SUFFICIENT);

    renderWithProviders(<InvestmentsScreen />);

    // A row tap now only EXPANDS the panel -- it must not open the sheet
    // directly anymore.
    fireEvent.press(await screen.findByTestId('holding-row-VTI'));
    expect(screen.queryByTestId('holding-cost-basis-input')).toBeNull();

    // The explicit "Set cost basis" affordance inside the panel opens the
    // existing HoldingCostBasisSheet (the decimal-pad input the cost-basis suite
    // drives).
    fireEvent.press(await screen.findByText('Set cost basis'));

    expect(
      await screen.findByTestId('holding-cost-basis-input'),
    ).toBeOnTheScreen();
  });
});
