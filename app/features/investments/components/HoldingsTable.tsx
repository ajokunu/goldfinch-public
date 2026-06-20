/**
 * Holdings positions table (P7-3): symbol / shares / market value / cost
 * basis, with per-currency totals (P7-7: subtotals are grouped strictly by
 * currency -- a mixed-currency grand total is never synthesized) and an
 * as-of caption from the newest holding snapshot.
 *
 * The cost-basis total for a currency renders only when EVERY holding in
 * that currency reports a cost basis; a partial sum would understate it.
 */
import { StyleSheet, Text, View } from 'react-native';
import type { CurrencyCode, HoldingDto } from '@goldfinch/shared/types';

import { useTheme } from '../../../src/ui/ThemeProvider';
import { Money } from '../../../src/ui/Money';
import { formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { useMaskMoney } from '../../../src/state/uiStore';
import { formatAsOf } from '../../../src/lib/dates';
import { formatShares } from '../lib/format';

export interface HoldingsTableProps {
  holdings: HoldingDto[];
}

interface CurrencyTotals {
  currency: CurrencyCode;
  marketValueMinor: number;
  costBasisMinor: number;
  /** False when any holding in this currency lacks a cost basis. */
  costBasisComplete: boolean;
}

function totalsByCurrency(holdings: HoldingDto[]): CurrencyTotals[] {
  const map = new Map<CurrencyCode, CurrencyTotals>();
  for (const holding of holdings) {
    const existing = map.get(holding.currency) ?? {
      currency: holding.currency,
      marketValueMinor: 0,
      costBasisMinor: 0,
      costBasisComplete: true,
    };
    existing.marketValueMinor += holding.marketValueMinor;
    if (holding.costBasisMinor === undefined) {
      existing.costBasisComplete = false;
    } else {
      existing.costBasisMinor += holding.costBasisMinor;
    }
    map.set(holding.currency, existing);
  }
  return [...map.values()].sort((a, b) =>
    a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0,
  );
}

const NO_VALUE = '—'; // em dash

export function HoldingsTable({ holdings }: HoldingsTableProps) {
  const theme = useTheme();
  // The per-currency total rows render raw formatMinorAmount strings (the
  // per-holding market values ride the masked Money primitive), so privacy
  // mode masks the totals here.
  const { mask } = useMaskMoney();

  const totals = totalsByCurrency(holdings);
  const multiCurrency = totals.length > 1;
  const newestAsOf = holdings.reduce(
    (max, holding) => (holding.asOf > max ? holding.asOf : max),
    0,
  );

  const headerStyle = {
    color: theme.colors.textSecondary,
    fontSize: theme.text.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  } as const;
  const cellCaption = {
    color: theme.colors.textSecondary,
    fontSize: theme.text.caption,
  } as const;

  return (
    <View
      style={[
        styles.card,
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
        <Text style={[styles.symbolCol, headerStyle]}>Symbol</Text>
        <Text style={[styles.sharesCol, styles.right, headerStyle]}>Shares</Text>
        <Text style={[styles.valueCol, styles.right, headerStyle]}>Value</Text>
        <Text style={[styles.valueCol, styles.right, headerStyle]}>Cost basis</Text>
      </View>

      {holdings.map((holding) => (
        <View
          key={holding.holdingId}
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
          <View style={styles.symbolCol}>
            <Text
              numberOfLines={1}
              style={{
                color: theme.colors.textPrimary,
                fontSize: theme.text.body,
                fontWeight: '600',
              }}
            >
              {holding.symbol ?? NO_VALUE}
            </Text>
            <Text numberOfLines={1} style={cellCaption}>
              {holding.description}
            </Text>
          </View>
          <Text
            style={[
              styles.sharesCol,
              styles.right,
              styles.tabular,
              { color: theme.colors.textPrimary, fontSize: theme.text.caption },
            ]}
          >
            {formatShares(holding.shares)}
          </Text>
          <View style={[styles.valueCol, styles.rightAlign]}>
            <Money amount={holding.marketValue} currency={holding.currency} size="sm" />
          </View>
          <View style={[styles.valueCol, styles.rightAlign]}>
            {holding.costBasis !== undefined ? (
              <Money amount={holding.costBasis} currency={holding.currency} size="sm" />
            ) : (
              <Text style={cellCaption}>{NO_VALUE}</Text>
            )}
          </View>
        </View>
      ))}

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
            {total.costBasisComplete
              ? mask(formatMinorAmount(total.costBasisMinor, total.currency))
              : NO_VALUE}
          </Text>
        </View>
      ))}

      {newestAsOf > 0 ? (
        <Text
          style={[
            cellCaption,
            {
              paddingHorizontal: theme.spacing.md,
              paddingBottom: theme.spacing.sm,
            },
          ]}
        >
          Positions as of {formatAsOf(newestAsOf)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center' },
  symbolCol: { flex: 2.1, paddingRight: 6 },
  sharesCol: { flex: 1 },
  valueCol: { flex: 1.4, paddingLeft: 6 },
  right: { textAlign: 'right' },
  rightAlign: { alignItems: 'flex-end' },
  tabular: { fontVariant: ['tabular-nums'] },
});
