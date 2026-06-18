/**
 * One recurring series row (design-spec screens.md 6.2 anatomy): identity
 * icon well left (duotone Repeat for bills, ArrowCircleDown for income, from
 * the icons module -- surface-alt tinted; the series category tint is a
 * documented gap, RecurringSeriesDto carries no categoryId, so no invented
 * color), payee + cadence pill + context line in the middle, the average
 * amount right (income rendered in `pos` with a leading +, bills in the
 * plain text color -- integer minor units through the shared per-currency
 * digit table, P7-7), and an optional action row (review buttons) below.
 *
 * Rendered inside a Card by its parents: the Upcoming view stacks rows in
 * one card per section, the Review view gives each detected series its own.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RecurringSeriesDto } from '@goldfinch/shared/types';

import { CurrencyAmount } from '../../../src/ui/CurrencyAmount';
import { ArrowCircleDownIcon, RepeatIcon } from '../../../src/ui/icons';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { isBill } from '../lib/upcoming';
import { CadenceBadge } from './CadenceBadge';

export interface SeriesRowProps {
  series: RecurringSeriesDto;
  /** Context line, e.g. "Due Jun 15 · Chase Checking". */
  detail: string;
  /** Render the context line in the danger color (overdue). */
  detailDanger?: boolean;
  /** Action buttons (review list) rendered under the row. */
  actions?: ReactNode;
}

export function SeriesRow({
  series,
  detail,
  detailDanger = false,
  actions,
}: SeriesRowProps) {
  const theme = useTheme();
  const bill = isBill(series);
  const TokIcon = bill ? RepeatIcon : ArrowCircleDownIcon;

  return (
    <View>
      <View style={styles.topRow}>
        <View
          style={[
            styles.tok,
            {
              borderRadius: theme.radius.token,
              backgroundColor: theme.colors.surfaceAlt,
            },
          ]}
        >
          <TokIcon size={18} color={theme.colors.textSecondary} weight="duotone" />
        </View>
        <View style={styles.left}>
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.textPrimary,
              fontSize: 14.5,
              fontWeight: '600',
              fontFamily: theme.fonts.sansSet.semibold,
            }}
          >
            {series.payee}
          </Text>
          <View style={[styles.detailRow, { marginTop: 4 }]}>
            <CadenceBadge cadence={series.cadence} />
            <Text
              numberOfLines={1}
              style={[
                styles.detailText,
                {
                  color: detailDanger
                    ? theme.colors.neg
                    : theme.colors.textSecondary,
                  fontSize: 12,
                  fontWeight: detailDanger ? '700' : '400',
                  fontFamily: detailDanger
                    ? theme.fonts.sansSet.bold
                    : theme.fonts.sans,
                  marginLeft: 8,
                },
              ]}
            >
              {detail}
            </Text>
          </View>
        </View>
        <CurrencyAmount
          amountMinor={series.avgAmountMinor}
          currency={series.currency}
          signDisplay={bill ? 'auto' : 'always'}
          style={{
            color: bill ? theme.colors.textPrimary : theme.colors.pos,
            fontSize: 14.5,
            fontFamily: theme.fonts.monoSet.semibold,
          }}
        />
      </View>
      {actions ? (
        <View style={[styles.actions, { marginTop: 10 }]}>{actions}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center' },
  tok: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
    flexShrink: 0,
  },
  left: { flex: 1, marginRight: 8, minWidth: 0 },
  detailRow: { flexDirection: 'row', alignItems: 'center' },
  detailText: { flexShrink: 1 },
  actions: { flexDirection: 'row', gap: 10 },
});
