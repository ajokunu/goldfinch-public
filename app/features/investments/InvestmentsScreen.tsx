/**
 * Investments tab (top-level destination): the household's stock holdings
 * AGGREGATED across every investment-type account, grouped by ticker.
 *
 * Reuses the existing holdings infrastructure end to end -- the per-account
 * GET /accounts/{id}/holdings endpoint (fanned out by useInvestmentsHoldings),
 * the HoldingDto wire shape, and HoldingsTable's column/total conventions --
 * rather than rebuilding any of it. A new aggregate API route was deliberately
 * avoided (it would pull in shared API_ROUTES + infra + router-parity, all out
 * of this stream's domain); the aggregation is client-side.
 *
 * Enrichment (Investments enrichment plan §4 Layer 4 + §9): each editable row
 * (a single (accountId, symbol)) opens a numeric cost-basis sheet; the manual
 * TOTAL the user enters POSTs through useSetHoldingCostBasis (optimistic, the
 * gain/% recomputed via the SHARED holdingBasis helpers). Rows show gain/loss
 * (red loss / green gain), price-per-share, and allocation %, with per-currency
 * total P/L in the hero (P7-7: never a mixed-currency total).
 *
 * Masking (§9.3): the gain dollar amount AND its % mask together under
 * useAmountsHidden (CurrencyAmount masks the $; the % string mirrors it);
 * price/share masks (CurrencyAmount); allocation % is not sensitive -> always
 * visible.
 *
 * The no-silent-blank rule (P7-3) is preserved exactly as the per-account
 * detail screen renders it:
 * - zero investment accounts              -> "No investment accounts";
 * - every account holdingsSupported:false -> "Holdings not provided";
 * - supported but zero positions          -> "No holdings yet".
 *
 * Amounts here are integer minor units (aggregated by lib/aggregate.ts), so
 * they render through CurrencyAmount -- the minor-unit primitive that already
 * masks via the shared privacy gate -- rather than Money (which the per-
 * account table uses because the API hands it per-holding decimal strings).
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

import {
  GoldfinchRefreshControl,
  GoldfinchRefreshMark,
} from '../../src/ui/GoldfinchRefresh';
import { Screen } from '../../src/ui/Screen';
import { Button } from '../../src/ui/Button';
import { Segmented } from '../../src/ui/Segmented';
import { FadeRise } from '../../src/ui/motion';
import { CurrencyAmount, formatMinorAmount } from '../../src/ui/CurrencyAmount';
import { HIDDEN_AMOUNT, useAmountsHidden, useMaskMoney } from '../../src/state/uiStore';
import { useSetHoldingCostBasis } from '../../src/api/mutations';
import { useTheme } from '../../src/ui/ThemeProvider';
import { EmptyState, ErrorState, LoadingState } from '../../src/ui/States';
import { useInvestmentsHoldings } from './hooks/useInvestmentsHoldings';
import {
  useHoldingReturnSeries,
  RANGE_OPTIONS,
  type HoldingReturnRange,
} from './hooks/useHoldingReturnSeries';
import { HoldingCostBasisSheet } from './components/HoldingCostBasisSheet';
import { HoldingReturnChart } from './components/HoldingReturnChart';
import {
  aggregateHoldings,
  allocationPercent,
  totalsByCurrency,
  type AggregatePosition,
  type CurrencyTotal,
} from './lib/aggregate';
import { formatShares } from './lib/format';
import { toCurrencyDecimalString } from '@goldfinch/shared/money';

const NO_VALUE = '—'; // em dash

/** Signed percent label, e.g. "+12%" / "-149%"; masked in lockstep with gain. */
function formatPercent(percent: number, hidden: boolean): string {
  if (hidden) return HIDDEN_AMOUNT;
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent}%`;
}

interface CostBasisTarget {
  accountId: string;
  symbol: string;
  /** Current manual basis decimal string (edit prefill), '' when none. */
  prefill: string;
}

/**
 * Identity key for the currently expanded row's inline return-chart panel. Holds
 * only the grouping fields (mirrors the position's identity); the per-position
 * query target (accountId, symbol) is read off the live position when the panel
 * mounts, so a stale/ambiguous accountId can never be captured here.
 */
interface ExpandedPosition {
  currency: string;
  symbol?: string;
  description: string;
}

export default function InvestmentsScreen() {
  const theme = useTheme();
  const { mask } = useMaskMoney();
  const {
    isPending,
    isError,
    isRefetching,
    holdings,
    investmentAccountCount,
    unsupportedCount,
    refetchAll,
  } = useInvestmentsHoldings();

  const positions = aggregateHoldings(holdings);
  const totals = totalsByCurrency(positions);
  const multiCurrency = totals.length > 1;

  const setCostBasis = useSetHoldingCostBasis();
  const [target, setTarget] = useState<CostBasisTarget | null>(null);

  // The inline return-chart panel lives below exactly one expanded row at a time
  // (owned here so the whole screen shares one expand state). Tapping a row
  // toggles this; the cost-basis sheet is now opened from a button INSIDE the
  // panel (the row press no longer opens it directly).
  const [expandedPosition, setExpandedPosition] = useState<ExpandedPosition | null>(null);

  const isExpanded = (position: AggregatePosition): boolean =>
    expandedPosition !== null &&
    expandedPosition.currency === position.currency &&
    expandedPosition.symbol === position.symbol &&
    expandedPosition.description === position.description;

  const toggleExpand = (position: AggregatePosition): void => {
    if (isExpanded(position)) {
      setExpandedPosition(null);
    } else {
      setExpandedPosition({
        currency: position.currency,
        symbol: position.symbol,
        description: position.description,
      });
    }
  };

  const openSheet = (position: AggregatePosition): void => {
    if (!position.editable || position.accountId === undefined || position.symbol === undefined) {
      return;
    }
    // Prefill ONLY a manual basis (the user's own value); a feed value is not
    // re-shown as the editable amount.
    const prefill =
      position.costBasisComplete && position.holdingCount === 1
        ? toCurrencyDecimalString(position.costBasisMinor, position.currency)
        : '';
    setTarget({ accountId: position.accountId, symbol: position.symbol, prefill });
    setCostBasis.reset();
  };

  const closeSheet = (): void => setTarget(null);

  const onSave = (draft: string): void => {
    if (target === null) return;
    const trimmed = draft.trim();
    const amount = trimmed.length > 0 ? trimmed : null;
    setCostBasis.mutate(
      { accountId: target.accountId, symbol: target.symbol, body: { amount } },
      { onSuccess: () => setTarget(null) },
    );
  };

  let body;
  if (isPending) {
    body = <LoadingState />;
  } else if (isError) {
    body = <ErrorState message="Holdings could not be loaded." onRetry={refetchAll} />;
  } else if (investmentAccountCount === 0) {
    body = (
      <EmptyState
        title="No investment accounts"
        body="Link or set an account's type to Investment to track its holdings here."
      />
    );
  } else if (
    unsupportedCount === investmentAccountCount &&
    positions.length === 0
  ) {
    // Every investment account reports holdingsSupported:false (P7-3).
    body = (
      <EmptyState
        title="Holdings not provided"
        body="Your investment accounts do not provide holdings via SimpleFIN, so positions cannot be shown."
      />
    );
  } else if (positions.length === 0) {
    body = (
      <EmptyState
        title="No holdings yet"
        body="Your investment accounts support holdings, but the latest sync reported no positions."
      />
    );
  } else {
    body = (
      <PopulatedBody
        positions={positions}
        totals={totals}
        multiCurrency={multiCurrency}
        unsupportedCount={unsupportedCount}
        mask={mask}
        onEditRow={openSheet}
        isExpanded={isExpanded}
        onToggleExpand={toggleExpand}
      />
    );
  }

  return (
    <Screen>
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: theme.text.heading,
          fontWeight: '700',
          marginBottom: theme.spacing.md,
        }}
      >
        Investments
      </Text>
      <ScrollView
        contentContainerStyle={{ paddingBottom: theme.spacing.xl }}
        refreshControl={
          <GoldfinchRefreshControl refreshing={isRefetching} onRefresh={refetchAll} />
        }
      >
        {body}
      </ScrollView>
      <GoldfinchRefreshMark active={isRefetching} />
      <HoldingCostBasisSheet
        visible={target !== null}
        onClose={closeSheet}
        title={target?.symbol ?? 'Cost basis'}
        prefill={target?.prefill ?? ''}
        hint="The total amount paid for this position. Leave blank to clear."
        saving={setCostBasis.isPending}
        error={
          setCostBasis.isError
            ? 'The cost basis could not be saved. Your change was undone.'
            : null
        }
        onSave={onSave}
        testID="holding-cost-basis-input"
      />
    </Screen>
  );
}

function PopulatedBody({
  positions,
  totals,
  multiCurrency,
  unsupportedCount,
  mask,
  onEditRow,
  isExpanded,
  onToggleExpand,
}: {
  positions: AggregatePosition[];
  totals: CurrencyTotal[];
  multiCurrency: boolean;
  unsupportedCount: number;
  mask: (formatted: string) => string;
  onEditRow: (position: AggregatePosition) => void;
  isExpanded: (position: AggregatePosition) => boolean;
  onToggleExpand: (position: AggregatePosition) => void;
}) {
  const theme = useTheme();
  const hidden = useAmountsHidden();
  // Per-currency market-value total drives each row's allocation %.
  const totalByCurrency = new Map(totals.map((t) => [t.currency, t]));
  const cellCaption = {
    color: theme.colors.textSecondary,
    fontSize: theme.text.caption,
  } as const;
  const headerStyle = {
    color: theme.colors.textSecondary,
    fontSize: theme.text.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  } as const;

  return (
    <View>
      {/* Top-line hero: one total market value per currency, with the
          per-currency cost basis and total P/L (gain $ + % masked together)
          rendered only when that currency's basis is complete. No mixed-
          currency grand total (P7-7). CurrencyAmount masks via the privacy
          gate. */}
      <View
        style={[
          styles.heroCard,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.md,
            padding: theme.spacing.md,
            marginBottom: theme.spacing.lg,
          },
        ]}
      >
        <Text style={[headerStyle, { marginBottom: theme.spacing.xs }]}>
          Total market value
        </Text>
        {totals.map((total) => (
          <View key={total.currency} style={styles.heroLine}>
            <CurrencyAmount
              amountMinor={total.marketValueMinor}
              currency={total.currency}
              size="xl"
              style={styles.tabular}
            />
            <Text style={[cellCaption, { marginTop: theme.spacing.xs }]}>
              {multiCurrency ? `${total.currency} · ` : ''}
              Cost basis{' '}
              {total.costBasisComplete
                ? mask(formatMinorAmount(total.costBasisMinor, total.currency))
                : NO_VALUE}
            </Text>
            {total.costBasisComplete ? (
              <View style={styles.heroPlLine}>
                <Text style={cellCaption}>Total P/L </Text>
                <CurrencyAmount
                  amountMinor={total.gainMinor}
                  currency={total.currency}
                  size="sm"
                  colorBySign
                  signDisplay="always"
                  style={styles.tabular}
                />
                {total.percentReturn !== undefined ? (
                  <Text
                    style={[
                      styles.plPercent,
                      {
                        color:
                          total.gainMinor < 0
                            ? theme.colors.danger
                            : theme.colors.positive,
                        fontSize: theme.text.caption,
                      },
                    ]}
                  >
                    {' '}
                    {formatPercent(total.percentReturn, hidden)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ))}
        {unsupportedCount > 0 ? (
          <Text style={[cellCaption, { marginTop: theme.spacing.sm }]}>
            {unsupportedCount === 1
              ? '1 account does not provide holdings.'
              : `${unsupportedCount} accounts do not provide holdings.`}
          </Text>
        ) : null}
      </View>

      {/* Aggregate positions grouped by ticker. Each editable row opens the
          cost-basis sheet; gain/loss, price-per-share, and allocation % render
          per row. */}
      <View
        style={[
          styles.tableCard,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.md,
          },
        ]}
      >
        <View
          style={[
            styles.row,
            {
              paddingHorizontal: theme.spacing.md,
              paddingVertical: theme.spacing.sm,
              borderBottomColor: theme.colors.border,
              borderBottomWidth: StyleSheet.hairlineWidth,
            },
          ]}
        >
          <Text numberOfLines={1} style={[styles.symbolCol, headerStyle]}>Symbol</Text>
          <Text numberOfLines={1} style={[styles.sharesCol, styles.right, headerStyle]}>Shares</Text>
          <Text numberOfLines={1} style={[styles.valueCol, styles.right, headerStyle]}>Value</Text>
          <Text numberOfLines={1} style={[styles.valueCol, styles.right, headerStyle]}>Gain</Text>
        </View>

        {positions.map((position) => {
          const currencyTotal = totalByCurrency.get(position.currency);
          const allocation =
            currencyTotal !== undefined
              ? allocationPercent(position, currencyTotal.marketValueMinor)
              : undefined;
          const expanded = position.editable && isExpanded(position);
          const key = `${position.currency}-${position.symbol ?? position.description}`;
          const rowName = position.symbol ?? position.description;
          // Editable rows (single account + symbol) toggle the inline return-chart
          // panel; non-editable rows render static (no press, no chevron).
          if (position.editable) {
            return (
              <View key={key}>
                <Pressable
                  onPress={() => onToggleExpand(position)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} return chart for ${rowName}`}
                  testID={`holding-row-${rowName}`}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.sm,
                      borderBottomColor: theme.colors.border,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <RowBody
                    position={position}
                    allocation={allocation}
                    hidden={hidden}
                    cellCaption={cellCaption}
                    expanded={expanded}
                  />
                </Pressable>
                {expanded ? (
                  <ExpandPanel position={position} onEditRow={onEditRow} />
                ) : null}
              </View>
            );
          }
          return (
            <View
              key={key}
              style={[
                styles.row,
                {
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                  borderBottomColor: theme.colors.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              <RowBody
                position={position}
                allocation={allocation}
                hidden={hidden}
                cellCaption={cellCaption}
                expanded={false}
              />
            </View>
          );
        })}

        {totals.map((total) => (
          <View
            key={total.currency}
            style={[
              styles.row,
              {
                paddingHorizontal: theme.spacing.md,
                paddingVertical: theme.spacing.sm,
              },
            ]}
          >
            <Text
              style={[
                styles.symbolCol,
                {
                  color: theme.colors.textPrimary,
                  fontSize: theme.text.caption,
                  fontWeight: '700',
                },
              ]}
            >
              {multiCurrency ? `Total (${total.currency})` : 'Total'}
            </Text>
            <Text style={[styles.sharesCol, styles.right, cellCaption]}> </Text>
            <Text
              style={[
                styles.valueCol,
                styles.right,
                styles.tabular,
                {
                  color: theme.colors.textPrimary,
                  fontSize: theme.text.caption,
                  fontWeight: '700',
                },
              ]}
            >
              {mask(formatMinorAmount(total.marketValueMinor, total.currency))}
            </Text>
            <View style={[styles.valueCol, styles.rightAlign]}>
              {total.costBasisComplete ? (
                <CurrencyAmount
                  amountMinor={total.gainMinor}
                  currency={total.currency}
                  size="sm"
                  colorBySign
                  signDisplay="always"
                  style={styles.tabular}
                />
              ) : (
                <Text style={cellCaption}>{NO_VALUE}</Text>
              )}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The inline dropdown panel rendered beneath an expanded (editable) row: the
 * window % return headline, the 1M/3M/6M/1Y range toggle, the normalized-return
 * chart, and a "Set cost basis" button that opens the EXISTING cost-basis sheet
 * (the cost-basis edit affordance moved here from the row press).
 *
 * The hook is called HERE, not at the screen top, because it needs this row's
 * concrete (accountId, symbol) -- both guaranteed present since the parent only
 * mounts this panel for editable positions (single account + symbol). The panel
 * mounts only while expanded, so the price-history query fires for exactly the
 * open row and is dropped on collapse.
 *
 * Masking: the window % return is a price movement, NOT a private dollar figure
 * (Contract h) -- it is shown unmasked, with the em-dash for missing data. This
 * is a DIFFERENT number from the row's cost-basis gain %, which masks in lockstep
 * with the gain $ (§9.3); the two must not share a masking path.
 */
function ExpandPanel({
  position,
  onEditRow,
}: {
  position: AggregatePosition;
  onEditRow: (position: AggregatePosition) => void;
}) {
  const theme = useTheme();
  const {
    normalizedSeries,
    windowPercent,
    firstSnapshotDate,
    isInsufficient,
    isLoading,
    range,
    setRange,
  } = useHoldingReturnSeries(position.accountId, position.symbol);

  const headline =
    windowPercent === undefined ? NO_VALUE : formatPercent(windowPercent, false);

  return (
    <FadeRise
      style={[
        styles.panel,
        {
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          backgroundColor: theme.colors.surfaceAlt,
          borderBottomColor: theme.colors.border,
          gap: theme.spacing.sm,
        },
      ]}
      testID={`holding-chart-panel-${position.symbol ?? position.description}`}
    >
      <View style={styles.panelHeadline}>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.text.caption,
            fontWeight: '600',
          }}
        >
          % return
        </Text>
        {/* Price-movement %: never masked (Contract h); em-dash when undefined. */}
        <Text
          style={[
            styles.tabular,
            {
              color:
                windowPercent === undefined
                  ? theme.colors.textSecondary
                  : windowPercent > 0
                    ? theme.colors.positive
                    : theme.colors.danger,
              fontSize: theme.text.body,
              fontWeight: '700',
            },
          ]}
        >
          {headline}
        </Text>
      </View>

      <Segmented<HoldingReturnRange>
        options={RANGE_OPTIONS}
        value={range}
        onChange={setRange}
        small
      />

      {/* While the price-history read is in flight, show a spinner -- never the
          "History accrues from" empty copy, which would falsely flash before the
          data arrives. */}
      {isLoading ? (
        <View
          style={{ height: 150, alignItems: 'center', justifyContent: 'center' }}
          testID={`holding-return-chart-${position.symbol ?? position.description}-loading`}
        >
          <ActivityIndicator color={theme.colors.accent} />
        </View>
      ) : (
        <HoldingReturnChart
          data={normalizedSeries}
          windowPercent={windowPercent}
          firstSnapshotDate={firstSnapshotDate}
          isInsufficient={isInsufficient}
          animationKey={range}
          testID={`holding-return-chart-${position.symbol ?? position.description}`}
        />
      )}

      {/* Opens the EXISTING cost-basis sheet (the edit affordance moved here);
          findable in tests by its accessibilityLabel "Set cost basis". */}
      <Button
        label="Set cost basis"
        variant="outline"
        onPress={() => onEditRow(position)}
      />
    </FadeRise>
  );
}

/** Shared row content (so the Pressable and the read-only View render the same). */
function RowBody({
  position,
  allocation,
  hidden,
  cellCaption,
  expanded,
}: {
  position: AggregatePosition;
  allocation: number | undefined;
  hidden: boolean;
  cellCaption: { color: string; fontSize: number };
  /** True when this editable row's inline return-chart panel is open. */
  expanded: boolean;
}) {
  const theme = useTheme();
  const gainColor =
    position.gainMinor !== undefined && position.gainMinor < 0
      ? theme.colors.danger
      : theme.colors.positive;
  // Only editable rows expand, so only they carry the chevron affordance
  // (utilitarian chrome -> lucide, never an identity icon).
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return (
    <>
      <View style={styles.symbolCol}>
        <View style={styles.symbolHeading}>
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.textPrimary,
              fontSize: theme.text.body,
              fontWeight: '600',
              flexShrink: 1,
            }}
          >
            {position.symbol ?? NO_VALUE}
          </Text>
          {position.editable ? (
            <Chevron
              size={14}
              color={theme.colors.textSecondary}
              strokeWidth={2.4}
            />
          ) : null}
        </View>
        <Text numberOfLines={1} style={cellCaption}>
          {position.description}
        </Text>
      </View>
      <View style={[styles.sharesCol, styles.rightAlign]}>
        <Text
          numberOfLines={1}
          style={[
            styles.right,
            styles.tabular,
            { color: theme.colors.textPrimary, fontSize: theme.text.caption },
          ]}
        >
          {formatShares(position.shares)}
        </Text>
        {/* Price per share masks (it is a dollar amount). */}
        {position.currentPriceMinor !== undefined ? (
          <CurrencyAmount
            amountMinor={position.currentPriceMinor}
            currency={position.currency}
            size="sm"
            style={[styles.tabular, cellCaption]}
          />
        ) : null}
      </View>
      <View style={[styles.valueCol, styles.rightAlign]}>
        <CurrencyAmount
          amountMinor={position.marketValueMinor}
          currency={position.currency}
          size="sm"
          style={styles.tabular}
        />
        {/* Allocation % is not sensitive -> always visible (§9.3). */}
        {allocation !== undefined ? (
          <Text numberOfLines={1} style={[styles.tabular, cellCaption]}>
            {allocation}%
          </Text>
        ) : null}
      </View>
      <View style={[styles.valueCol, styles.rightAlign]}>
        {position.gainMinor !== undefined ? (
          <>
            <CurrencyAmount
              amountMinor={position.gainMinor}
              currency={position.currency}
              size="sm"
              colorBySign
              signDisplay="always"
              style={styles.tabular}
            />
            {/* Gain % masks together with the gain $ (§9.3). */}
            {position.percentReturn !== undefined ? (
              <Text
                numberOfLines={1}
                style={[
                  styles.tabular,
                  { color: gainColor, fontSize: theme.text.caption },
                ]}
              >
                {formatPercent(position.percentReturn, hidden)}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={cellCaption}>{NO_VALUE}</Text>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  heroCard: { borderWidth: StyleSheet.hairlineWidth },
  heroLine: { marginBottom: 4 },
  heroPlLine: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  plPercent: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  tableCard: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center' },
  symbolCol: { flex: 1.9, paddingRight: 6 },
  symbolHeading: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  panel: { borderBottomWidth: StyleSheet.hairlineWidth },
  panelHeadline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 6,
  },
  sharesCol: { flex: 1.1 },
  valueCol: { flex: 1.5, paddingLeft: 6 },
  right: { textAlign: 'right' },
  rightAlign: { alignItems: 'flex-end' },
  tabular: { fontVariant: ['tabular-nums'] },
});
