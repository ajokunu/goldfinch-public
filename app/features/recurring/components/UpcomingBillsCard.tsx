/**
 * Dashboard card for upcoming bills (design-spec screens.md 1.6; P7-1
 * "upcoming-bills list on dashboard"). Owned by the recurring feature and
 * mounted by features/dashboard/index.tsx, so the dependency points
 * dashboard -> recurring only; the card surface is the shared ui-kit Card.
 *
 * Reads the same GET /recurring cache entry as the Recurring screen and
 * degrades per-card like every other dashboard section: loading, error with
 * retry, explicit empty -- never a silent blank. Shows expense series only
 * (bills), soonest due first, capped at 3 rows; the footer carries the
 * per-currency due-this-month totals (P7-7: no mixed-currency sums). Series
 * toks are surface-alt: the DTO has no categoryId, so no invented tint.
 */
import { Fragment } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import type { RecurringSeriesDto } from '@goldfinch/shared/types';

import { Card, CardHeader } from '../../../src/ui/Card';
import { CurrencyAmount, formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { useMaskMoney } from '../../../src/state/uiStore';
import { RepeatIcon } from '../../../src/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '../../../src/ui/States';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { useHover } from '../../../src/ui/useHover';
import { useLang, useT, localeTag } from '../../../src/i18n';
import { currentIsoMonth, isoMonthLabel } from '../../../src/lib/dates';
import { useRecurringSeries } from '../hooks/useRecurringSeries';
import { monthBillTotals, upcomingBills } from '../lib/upcoming';
import { useDueLabel } from './useDueLabel';

/** Row cap for the dashboard slice; the Recurring screen shows the rest. */
export const UPCOMING_CARD_LIMIT = 3;

function BillRow({ series }: { series: RecurringSeriesDto }) {
  const theme = useTheme();
  const dueLabel = useDueLabel();
  const due = dueLabel(series);
  return (
    <View style={styles.billRow}>
      <View
        style={[
          styles.tok,
          {
            borderRadius: theme.radius.token,
            backgroundColor: theme.colors.surfaceAlt,
          },
        ]}
      >
        <RepeatIcon size={16} color={theme.colors.textSecondary} weight="duotone" />
      </View>
      <View style={styles.billLeft}>
        <Text
          numberOfLines={1}
          style={{
            color: theme.colors.textPrimary,
            fontSize: 14,
            fontWeight: '600',
            fontFamily: theme.fonts.sansSet.semibold,
          }}
        >
          {series.payee}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: due.overdue ? theme.colors.neg : theme.colors.textSecondary,
            fontSize: 12,
            fontWeight: due.overdue ? '700' : '400',
            fontFamily: due.overdue ? theme.fonts.sansSet.bold : theme.fonts.sans,
            marginTop: 2,
          }}
        >
          {due.text}
        </Text>
      </View>
      <CurrencyAmount
        amountMinor={series.avgAmountMinor}
        currency={series.currency}
        style={{ fontSize: 14, fontFamily: theme.fonts.monoSet.semibold }}
      />
    </View>
  );
}

export function UpcomingBillsCard() {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  const locale = localeTag(lang);
  // The footer per-currency due-this-month totals are raw formatMinorAmount
  // strings (visible Text + accessibilityLabel), so privacy mode masks them
  // here; the bill rows themselves ride the masked CurrencyAmount primitive.
  const { mask } = useMaskMoney();
  const router = useRouter();
  const query = useRecurringSeries();
  const { hovered: allHovered, hoverProps: allHoverProps } = useHover();

  const body = query.isPending ? (
    <LoadingState />
  ) : query.isError ? (
    <ErrorState
      message="Could not load upcoming bills."
      onRetry={() => void query.refetch()}
    />
  ) : (
    (() => {
      const bills = upcomingBills(query.data.items);
      if (bills.length === 0) {
        return (
          <EmptyState
            title="No recurring bills detected yet"
            body="They appear after a few syncs."
          />
        );
      }
      const month = currentIsoMonth();
      const totals = monthBillTotals(query.data.items, month);
      return (
        <View>
          <View style={{ gap: 10 }}>
            {bills.slice(0, UPCOMING_CARD_LIMIT).map((series, position) => (
              <Fragment key={series.seriesId}>
                {position > 0 ? (
                  <View
                    style={[
                      styles.divider,
                      { backgroundColor: theme.colors.line },
                    ]}
                  />
                ) : null}
                <BillRow series={series} />
              </Fragment>
            ))}
          </View>
          <View
            style={[
              styles.footer,
              { borderTopColor: theme.colors.line, marginTop: 12 },
            ]}
          >
            <Text
              style={[
                styles.footerLabel,
                {
                  color: theme.colors.textSecondary,
                  fontSize: 12,
                  fontFamily: theme.fonts.sans,
                },
              ]}
            >
              {`Due in ${isoMonthLabel(month, locale)}`}
            </Text>
            <View style={styles.footerTotals}>
              {totals.length === 0 ? (
                <Text
                  style={{
                    color: theme.colors.textSecondary,
                    fontSize: 12,
                    fontFamily: theme.fonts.sans,
                  }}
                >
                  Nothing more due this month.
                </Text>
              ) : (
                totals.map((total) => {
                  const label = mask(
                    formatMinorAmount(total.totalMinor, total.currency, {
                      locale,
                    }),
                  );
                  return (
                    <Text
                      key={total.currency}
                      accessibilityLabel={label}
                      style={{
                        color: theme.colors.textPrimary,
                        fontSize: 13,
                        fontWeight: '700',
                        fontFamily: theme.fonts.monoSet.bold,
                        fontVariant: ['tabular-nums'],
                      }}
                    >
                      {label}
                    </Text>
                  );
                })
              )}
            </View>
          </View>
        </View>
      );
    })()
  );

  return (
    <Card>
      <CardHeader
        title={t('Upcoming bills')}
        right={
          <Pressable
            onPress={() => router.push('/more/recurring')}
            {...allHoverProps}
            accessibilityRole="button"
            accessibilityLabel="See all recurring"
            hitSlop={8}
            style={({ pressed }) => [
              styles.allLink,
              { opacity: pressed ? 0.6 : allHovered ? 0.8 : 1 },
            ]}
          >
            <Text
              style={{
                color: theme.colors.accent,
                fontSize: 12.5,
                fontWeight: '700',
                fontFamily: theme.fonts.sansSet.bold,
              }}
            >
              {t('All')}
            </Text>
            <ChevronRight size={14} color={theme.colors.accent} strokeWidth={2.5} />
          </Pressable>
        }
      />
      {body}
    </Card>
  );
}

const styles = StyleSheet.create({
  billRow: { flexDirection: 'row', alignItems: 'center' },
  billLeft: { flex: 1, marginRight: 8, minWidth: 0 },
  tok: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    flexShrink: 0,
  },
  divider: { height: StyleSheet.hairlineWidth },
  footer: {
    borderTopWidth: 1,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerLabel: { flex: 1, marginRight: 8 },
  footerTotals: { alignItems: 'flex-end', gap: 2 },
  allLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
