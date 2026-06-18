/**
 * Privacy mode: money components mask when privacyMode is on AND not revealed;
 * valuesRevealed is never persisted, proving the "open hidden" contract.
 *
 * The second describe block is the REGRESSION GATE for the whole masking
 * class (PHASE9 privacy-mode leak fix): when privacy mode is on, NO money
 * figure may be readable ANYWHERE -- not in chart centers/labels, not in
 * captions, not in accessibility labels / web aria-labels. Earlier the mask
 * was gated only inside the Money/CurrencyAmount/CountUp primitives, so the
 * ~18 feature/chart/caption sites that call formatMinorAmount/
 * formatDecimalAmount directly rendered real amounts straight through. These
 * tests render the dashboard cards, a reports section, a transaction row, and
 * a goal card with privacy ON and assert no real digit run survives in the
 * visible tree OR in any accessibility label.
 */
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react-native';
import { afterEach, describe, expect, it } from '@jest/globals';

import { Money } from '../src/ui/Money';
import { CurrencyAmount } from '../src/ui/CurrencyAmount';
import { HIDDEN_AMOUNT, useUiStore } from '../src/state/uiStore';
import { ThemeProvider } from '../src/ui/ThemeProvider';
import { NetWorthCard } from '../features/dashboard/components/NetWorthCard';
import { SpendingCard } from '../features/dashboard/components/SpendingCard';
import { TrendsSection } from '../features/reports/components/TrendsSection';
import { TransactionRow } from '../features/transactions/components/TransactionRow';
import { GoalCard } from '../features/goals/components/GoalCard';
import {
  makeGoalDto,
  makeReportsFlowResponse,
  makeSummaryResponse,
  makeTransactionDto,
  makeTrendMonthDto,
} from './fixtures';
import { mockApi } from './mockApi';
import { renderWithProviders } from './render';

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

afterEach(() => {
  useUiStore.setState({ privacyMode: false, valuesRevealed: false });
});

describe('privacy masking', () => {
  it('shows the real amount when privacy mode is off', () => {
    const { queryByText } = wrap(<Money amount="1234.56" currency="USD" />);
    expect(queryByText(HIDDEN_AMOUNT)).toBeNull();
  });

  it('masks Money and CurrencyAmount when privacy is on and not revealed', () => {
    useUiStore.setState({ privacyMode: true, valuesRevealed: false });
    const m = wrap(<Money amount="1234.56" currency="USD" />);
    expect(m.queryByText(HIDDEN_AMOUNT)).not.toBeNull();
    const c = wrap(<CurrencyAmount amountMinor={123456} currency="USD" />);
    expect(c.queryByText(HIDDEN_AMOUNT)).not.toBeNull();
  });

  it('reveals when the session toggle is on', () => {
    useUiStore.setState({ privacyMode: true, valuesRevealed: true });
    const { queryByText } = wrap(<Money amount="1234.56" currency="USD" />);
    expect(queryByText(HIDDEN_AMOUNT)).toBeNull();
  });

  it('does not persist valuesRevealed (open-hidden contract)', () => {
    const persisted = useUiStore.persist
      .getOptions()
      .partialize?.(useUiStore.getState());
    expect(persisted).not.toHaveProperty('valuesRevealed');
    expect(persisted).toHaveProperty('privacyMode');
  });
});

// ---------------------------------------------------------------------------
// Regression gate: no money figure readable anywhere under privacy mode.
// ---------------------------------------------------------------------------

type JsonNode =
  | string
  | number
  | null
  | {
      type?: unknown;
      props?: Record<string, unknown>;
      children?: JsonNode[] | null;
    };

/**
 * Collect every readable string in a rendered tree: the visible text content
 * AND the accessibility-label props (accessibilityLabel, aria-label, and the
 * stringy parts of accessibilityValue / accessibilityHint). A money figure
 * that escapes masking must surface in one of these, so scanning all of them
 * makes the regression gate cover charts (SVG center/flag/axis text), plain
 * captions, and screen-reader labels uniformly.
 */
function collectReadableStrings(node: JsonNode, sink: string[]): void {
  if (node === null) return;
  if (typeof node === 'string') {
    sink.push(node);
    return;
  }
  if (typeof node === 'number') {
    sink.push(String(node));
    return;
  }
  const props = node.props ?? {};
  for (const key of [
    'accessibilityLabel',
    'aria-label',
    'accessibilityHint',
  ]) {
    const value = props[key];
    if (typeof value === 'string') sink.push(value);
  }
  const ariaValue = props.accessibilityValue;
  if (ariaValue !== null && typeof ariaValue === 'object') {
    const text = (ariaValue as { text?: unknown }).text;
    if (typeof text === 'string') sink.push(text);
  }
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) collectReadableStrings(child, sink);
  }
}

function readableStrings(): string[] {
  const tree = screen.toJSON();
  const sink: string[] = [];
  const roots = Array.isArray(tree) ? tree : [tree];
  for (const root of roots) {
    if (root !== null) collectReadableStrings(root as JsonNode, sink);
  }
  return sink;
}

/**
 * Assert that none of the engineered amounts' digit runs survive anywhere in
 * the tree. The amounts are chosen so their grouped-digit strings (e.g.
 * "8,675,309") cannot collide with percentages, dates, counts, or test ids;
 * the bare integer-minor and decimal forms are checked too so a half-masked
 * path is still caught. HIDDEN_AMOUNT is asserted present so we know masking
 * actually ran rather than the figure simply being absent.
 */
function expectNoMoneyReadable(forbiddenDigitRuns: readonly string[]): void {
  const strings = readableStrings();
  expect(strings.some((s) => s.includes(HIDDEN_AMOUNT))).toBe(true);
  // Surface the offending string in the failure: collect every readable
  // entry that still contains a forbidden run, then assert that list is empty
  // (an empty array prints cleanly and names the leak when it is not).
  const leaks = forbiddenDigitRuns.flatMap((run) =>
    strings.filter((s) => s.includes(run)).map((s) => `${run} -> ${s}`),
  );
  expect(leaks).toEqual([]);
}

function renderWithPrivacyOn(ui: ReactElement) {
  useUiStore.setState({ privacyMode: true, valuesRevealed: false });
  return renderWithProviders(ui);
}

describe('privacy masking regression gate (no figure readable anywhere)', () => {
  it('masks the dashboard NetWorthCard hero, change pill, footer, and trend chart label', async () => {
    // Distinctive grouped-digit runs that cannot collide with chrome.
    const summary = makeSummaryResponse({
      netWorthMinor: 867_530_900, // $8,675,309.00
      assetsTotalMinor: 912_345_600, // $9,123,456.00
      liabilitiesTotalMinor: 44_814_700, // $448,147.00
      byType: [],
    });
    // Two snapshots so the change pill + trend chart render (delta figures).
    mockApi.get('/networth/history', {
      items: [
        {
          date: '2026-04-30',
          currency: 'USD',
          assets: '9000000.00',
          assetsMinor: 900_000_000,
          liabilities: '448147.00',
          liabilitiesMinor: 44_814_700,
          net: '8551853.00',
          netMinor: 855_185_300,
          perCurrency: [],
        },
        {
          date: '2026-05-31',
          currency: 'USD',
          assets: '9123456.00',
          assetsMinor: 912_345_600,
          liabilities: '448147.00',
          liabilitiesMinor: 44_814_700,
          net: '8675309.00',
          netMinor: 867_530_900,
          perCurrency: [],
        },
      ],
      firstSnapshotDate: '2026-04-30',
    });

    renderWithPrivacyOn(<NetWorthCard summary={summary} />);
    // Wait for the history query so the change pill + trend label mount.
    await screen.findByTestId('networth-trend');

    expectNoMoneyReadable([
      '8,675,309', // net worth hero + trend label
      '9,123,456', // assets footer
      '448,147', // liabilities footer
      '8675309', // bare forms, in case a path skipped grouping
      '9123456',
    ]);
  });

  it('masks the dashboard SpendingCard donut center, segment flags, and a11y summary', async () => {
    const flow = makeReportsFlowResponse(
      '2026-06',
      { incomeMinor: 700_000_000, expenseMinor: 528_491_700 }, // $5,284,917.00
      [
        { categoryId: 'cat-groceries', categoryName: 'Groceries', amountMinor: 311_222_300 },
        { categoryId: 'cat-rent', categoryName: 'Rent', amountMinor: 217_269_400 },
      ],
    );
    mockApi.get('/reports/flow', flow);

    renderWithPrivacyOn(<SpendingCard />);
    await screen.findByTestId('spending-donut-USD');

    expectNoMoneyReadable([
      '5,284,917', // donut center total + a11y summary
      '311,222', // segment value-flag label
      '217,269', // segment value-flag label
      '5284917',
      '311222',
    ]);
  });

  it('masks a reports TrendsSection (bar axis, scrubber flags, totals, a11y summary)', () => {
    const months = [
      makeTrendMonthDto('2026-05', {
        incomeMinor: 633_445_500,
        expenseMinor: 411_998_800,
      }),
      makeTrendMonthDto('2026-06', {
        incomeMinor: 712_334_600,
        expenseMinor: 388_771_200,
      }),
    ];
    renderWithPrivacyOn(<TrendsSection months={months} animationKey="6m" />);

    expectNoMoneyReadable([
      '633,445', // total income magnitude
      '411,998', // total spent magnitude
      '712,334',
      '388,771',
      '633445',
      '411998',
    ]);
  });

  it('masks a transaction row amount in both the visible text and the a11y label', () => {
    const txn = makeTransactionDto({
      amountMinor: -76_543_200, // -$765,432.00
      payee: 'Whole Foods',
    });
    renderWithPrivacyOn(
      <TransactionRow
        txn={txn}
        accountName="Everyday Checking"
        categoryName="Groceries"
        onPress={() => undefined}
      />,
    );

    expectNoMoneyReadable(['765,432', '765432']);
  });

  it('masks a goal card saved/target figures in both visible text and a11y labels', () => {
    const goal = makeGoalDto({
      goalId: 'goal-house',
      name: 'House down payment',
      targetMinor: 500_000_000, // $5,000,000.00
      progressMinor: 123_456_700, // $1,234,567.00
      fundingMode: 'manual',
    });
    renderWithPrivacyOn(
      <GoalCard
        goal={goal}
        today="2026-06-11"
        onEdit={() => undefined}
        onContribute={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expectNoMoneyReadable([
      '1,234,567', // progress
      '5,000,000', // target
      '1234567',
      '5000000',
    ]);
  });

  it('reveals the real figures again once the session toggle is on', async () => {
    const summary = makeSummaryResponse({
      netWorthMinor: 867_530_900,
      assetsTotalMinor: 912_345_600,
      liabilitiesTotalMinor: 44_814_700,
      byType: [],
    });
    mockApi.get('/networth/history', { items: [], firstSnapshotDate: null });

    useUiStore.setState({ privacyMode: true, valuesRevealed: true });
    renderWithProviders(<NetWorthCard summary={summary} />);

    // With reveal on, the hero figure is readable again (no mask).
    const strings = readableStrings();
    expect(strings.some((s) => s.includes('8,675,309'))).toBe(true);
    expect(strings.some((s) => s.includes(HIDDEN_AMOUNT))).toBe(false);
  });
});
