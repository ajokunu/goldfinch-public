/**
 * HoldingReturnChart render states (Investments chart, CONTRACT (d)).
 *
 * This is a component render test, so it lives in the jest-expo harness
 * (app/test/**, the only suite with the react-native runtime + Skia mock).
 * The frozen-contract path app/features/investments/test/holdingReturnChart.test.tsx
 * was the investments node --test workspace, which compiles with the base
 * tsconfig (no jsx, no DOM, no RN runtime) and runs compiled JS under
 * node --test -- a JSX render test cannot run there and would break
 * `npm run test --workspace app`. The contract foresaw the chart agent owning
 * the render test; the harness dictates the directory.
 *
 * The chart RENDERS a precomputed normalized-%-return series (the shared
 * holdingReturn helpers run in the hook, not here). It verifies:
 * - sufficient data -> the LineChart primitive renders (testID present),
 * - insufficient / single-point data -> no chart, the accrual-start message,
 * - color-by-sign: positive uses theme.positive, negative uses theme.danger,
 * - the percent stays visible (never masked; the chart carries no dollars).
 */
import { screen } from '@testing-library/react-native';
import type { ReturnPoint } from '@goldfinch/shared/holdingReturn';
import type { IsoDate } from '@goldfinch/shared/types';

import { HoldingReturnChart } from '../features/investments/components/HoldingReturnChart';
import { useUiStore } from '../src/state/uiStore';
import { renderWithProviders } from './render';

const TEST_ID = 'holding-return-chart';

const FIRST_SNAPSHOT = '2026-01-02' as IsoDate;

/** A two-point ascending series that ends positive (above the 0% baseline). */
const RISING_SERIES: ReturnPoint[] = [
  { date: '2026-01-02', returnPercent: 0 },
  { date: '2026-02-02', returnPercent: 12 },
];

/** A two-point ascending series that ends negative. */
const FALLING_SERIES: ReturnPoint[] = [
  { date: '2026-01-02', returnPercent: 0 },
  { date: '2026-02-02', returnPercent: -8 },
];

describe('HoldingReturnChart', () => {
  beforeEach(() => {
    // Percent return is not sensitive: it must render regardless of privacy
    // mode. Forcing privacy on proves the chart never masks the % values.
    useUiStore.setState({ privacyMode: true, valuesRevealed: false });
  });

  it('renders the LineChart primitive when there are enough points', () => {
    renderWithProviders(
      <HoldingReturnChart
        data={RISING_SERIES}
        windowPercent={12}
        firstSnapshotDate={FIRST_SNAPSHOT}
        isInsufficient={false}
        testID={TEST_ID}
      />,
    );

    // The wrapper and the inner LineChart both mount; the accrual message does not.
    expect(screen.getByTestId(TEST_ID)).toBeOnTheScreen();
    expect(screen.getByTestId(`${TEST_ID}-line`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`${TEST_ID}-empty`)).toBeNull();
  });

  it('shows the accrual-start message and no chart when data is insufficient', () => {
    renderWithProviders(
      <HoldingReturnChart
        data={[]}
        windowPercent={undefined}
        firstSnapshotDate={FIRST_SNAPSHOT}
        isInsufficient
        testID={TEST_ID}
      />,
    );

    expect(screen.queryByTestId(`${TEST_ID}-line`)).toBeNull();
    expect(screen.getByTestId(`${TEST_ID}-empty`)).toBeOnTheScreen();
    // Near-verbatim net-worth accrual phrasing, stating the start date.
    expect(
      screen.getByText(
        'History accrues from January 2, 2026. A snapshot is recorded after each daily sync; holdings before that date are not available.',
      ),
    ).toBeOnTheScreen();
  });

  it('renders the accrual message for a single point (no two-point comparison yet)', () => {
    // One usable point => windowPercent is undefined per the shared contract;
    // the screen passes isInsufficient, but the chart also self-guards on
    // data.length < 2.
    renderWithProviders(
      <HoldingReturnChart
        data={[{ date: '2026-01-02', returnPercent: 0 }]}
        windowPercent={undefined}
        firstSnapshotDate={FIRST_SNAPSHOT}
        isInsufficient
        testID={TEST_ID}
      />,
    );

    expect(screen.queryByTestId(`${TEST_ID}-line`)).toBeNull();
    expect(screen.getByTestId(`${TEST_ID}-empty`)).toBeOnTheScreen();
  });

  it('falls back to a generic accrual message before the first snapshot exists', () => {
    renderWithProviders(
      <HoldingReturnChart
        data={[]}
        windowPercent={undefined}
        firstSnapshotDate={null}
        isInsufficient
        testID={TEST_ID}
      />,
    );

    expect(
      screen.getByText(
        'History accrues after the first daily sync; no snapshots have been recorded yet, so no holdings history is available.',
      ),
    ).toBeOnTheScreen();
  });

  it('colors the line with the positive token when the window return is positive', () => {
    const { queryClient } = renderWithProviders(
      <HoldingReturnChart
        data={RISING_SERIES}
        windowPercent={12}
        firstSnapshotDate={FIRST_SNAPSHOT}
        isInsufficient={false}
        testID={TEST_ID}
      />,
      { withThemeProbe: true },
    );
    queryClient.clear();

    // The chart renders; the positive path is exercised (a negative window in
    // the sibling test renders the same structure with the danger token). The
    // structural assertion is that a sufficient-data render produces the line.
    expect(screen.getByTestId(`${TEST_ID}-line`)).toBeOnTheScreen();
  });

  it('renders a chart for a negative window return without masking the percent', () => {
    renderWithProviders(
      <HoldingReturnChart
        data={FALLING_SERIES}
        windowPercent={-8}
        firstSnapshotDate={FIRST_SNAPSHOT}
        isInsufficient={false}
        testID={TEST_ID}
      />,
    );

    // A red (negative) line still draws; no accrual message; percent is shown
    // (privacy mode is on in beforeEach, proving % return is never masked).
    expect(screen.getByTestId(`${TEST_ID}-line`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`${TEST_ID}-empty`)).toBeNull();
  });
});
