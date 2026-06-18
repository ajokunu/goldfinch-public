/**
 * Upcoming view (design-spec screens.md 6.2): bills-due hero card (studio
 * renders its accent-hero treatment via the theme's hero token, never a
 * direction branch), then a "Bills" card and an "Income" card of SeriesRows,
 * soonest due first.
 *
 * Money: hero totals are the per-currency monthBillTotals (expense series
 * only, occurrencesInMonth-aware; recurring income is listed but never mixed
 * into a bills total) -- one line per currency per P7-7, never a synthetic
 * mixed-currency sum. Upcoming includes confirmed AND detected series (all
 * non-ignored) per live semantics.
 */
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { RecurringSeriesDto } from '@goldfinch/shared/types';

import { Card, CardHeader } from '../../../src/ui/Card';
import { formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { useMaskMoney } from '../../../src/state/uiStore';
import { RepeatIcon } from '../../../src/ui/icons';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { withAlpha } from '../../../src/ui/mixColor';
import { shadowStyle } from '../../../src/ui/shadows';
import { useLang, useT, localeTag } from '../../../src/i18n';
import { currentIsoMonth, isoMonthLabel } from '../../../src/lib/dates';
import { FadeRise, stagger, staggerChildDelayMs } from '../../../src/ui/motion';
import { activeSeries, isBill, monthBillTotals } from '../lib/upcoming';
import { SeriesRow } from './SeriesRow';
import { useDueLabel } from './useDueLabel';

/** Context line: due label, account, and the needs-review flag (preserved). */
function seriesDetail(
  series: RecurringSeriesDto,
  dueLabel: { text: string; overdue: boolean },
): string {
  const parts = [dueLabel.text];
  if (series.accountName) parts.push(series.accountName);
  if (series.status === 'detected') parts.push('Needs review');
  return parts.join(' · ');
}

function BillsDueHeroCard({ items }: { items: readonly RecurringSeriesDto[] }) {
  const theme = useTheme();
  const lang = useLang();
  const locale = localeTag(lang);
  // The per-currency due-this-month hero totals are raw formatMinorAmount
  // strings (visible Text + accessibilityLabel), so privacy mode masks them
  // here; the series rows ride the masked CurrencyAmount primitive.
  const { mask } = useMaskMoney();

  const month = currentIsoMonth();
  const totals = monthBillTotals(items, month);
  const active = activeSeries(items);
  const billCount = active.filter(isBill).length;
  const incomeCount = active.length - billCount;

  // Studio's accent-hero structural variant, signalled by the hero token.
  const accentHero = theme.hero === 'editorial';
  const primary = accentHero ? theme.colors.onAccent : theme.colors.textPrimary;
  const muted = accentHero ? theme.colors.onAccent : theme.colors.textSecondary;

  return (
    <View
      style={[
        {
          backgroundColor: accentHero ? theme.colors.accent : theme.colors.surface,
          borderColor: accentHero ? theme.colors.accent : theme.colors.border,
          borderWidth: theme.card.borderWidth,
          borderRadius: theme.radius.card,
          padding: 16,
        },
        theme.card.shadow === 'sm' ? shadowStyle(theme.shadows.sm) : null,
      ]}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: muted,
          opacity: accentHero ? 0.8 : 1,
          fontSize: 11.5,
          fontWeight: '700',
          fontFamily: theme.fonts.sansSet.bold,
          textTransform: 'uppercase',
          letterSpacing: 0.92,
        }}
      >
        {`Bills due in ${isoMonthLabel(month, locale)}`}
      </Text>

      {totals.length === 0 ? (
        <Text
          style={{
            color: muted,
            fontSize: 14,
            fontFamily: theme.fonts.sans,
            marginTop: 8,
          }}
        >
          {`No bills left for ${isoMonthLabel(month, locale)}.`}
        </Text>
      ) : (
        <View style={{ marginTop: 6, gap: 2 }}>
          {totals.map((total) => {
            const label = mask(
              formatMinorAmount(total.totalMinor, total.currency, { locale }),
            );
            return (
              <Text
                key={total.currency}
                accessibilityLabel={label}
                style={{
                  color: primary,
                  fontSize: 30,
                  fontWeight: '700',
                  fontFamily: theme.fonts.monoSet.bold,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {label}
              </Text>
            );
          })}
        </View>
      )}

      <Text
        style={{
          color: muted,
          opacity: accentHero ? 0.8 : 1,
          fontSize: 12,
          fontFamily: theme.fonts.sans,
          marginTop: 6,
        }}
      >
        {`${billCount} active ${billCount === 1 ? 'bill' : 'bills'} · ${incomeCount} income ${incomeCount === 1 ? 'source' : 'sources'}`}
      </Text>
    </View>
  );
}

/** Card of series rows separated by hairlines. */
function SeriesCard({
  title,
  series,
}: {
  title: string;
  series: readonly RecurringSeriesDto[];
}) {
  const theme = useTheme();
  const dueLabel = useDueLabel();
  return (
    <Card>
      <CardHeader title={title} />
      {series.map((item, position) => {
        const due = dueLabel(item);
        return (
          <Fragment key={item.seriesId}>
            {position > 0 ? (
              <View
                style={[styles.divider, { backgroundColor: theme.colors.line }]}
              />
            ) : null}
            <View style={styles.rowPad}>
              <SeriesRow
                series={item}
                detail={seriesDetail(item, due)}
                detailDanger={due.overdue}
              />
            </View>
          </Fragment>
        );
      })}
    </Card>
  );
}

/** Designed empty state (screens.md 6.2): icon tile + copy. */
function UpcomingEmptyState() {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: theme.radius.token,
          backgroundColor: withAlpha(theme.colors.accent, 0.14),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <RepeatIcon size={22} color={theme.colors.accent} weight="duotone" />
      </View>
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: 16,
          fontWeight: '700',
          fontFamily: theme.fonts.sansSet.bold,
          marginTop: 12,
          textAlign: 'center',
        }}
      >
        Nothing recurring yet
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: 13,
          fontFamily: theme.fonts.sans,
          marginTop: 6,
          textAlign: 'center',
          maxWidth: 320,
        }}
      >
        GoldFinch detects bills and subscriptions from your synced
        transactions.
      </Text>
    </View>
  );
}

export function UpcomingBillsView({
  items,
}: {
  items: readonly RecurringSeriesDto[];
}) {
  const t = useT();
  const active = activeSeries(items);

  if (active.length === 0) {
    return <UpcomingEmptyState />;
  }

  const bills = active.filter(isBill);
  const income = active.filter((series) => !isBill(series));

  return (
    <View style={styles.stack}>
      {/* Hero-then-cards cascade via the shared motion module (PHASE9-
          DECISIONS P9-1/P9-2 item 1); slots compact when a card is absent. */}
      <FadeRise>
        <BillsDueHeroCard items={items} />
      </FadeRise>
      {bills.length > 0 ? (
        <FadeRise delay={staggerChildDelayMs(1, stagger.cascadeMs)}>
          <SeriesCard title={t('Bills')} series={bills} />
        </FadeRise>
      ) : null}
      {income.length > 0 ? (
        <FadeRise
          delay={staggerChildDelayMs(bills.length > 0 ? 2 : 1, stagger.cascadeMs)}
        >
          <SeriesCard title={t('Income')} series={income} />
        </FadeRise>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 14 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  rowPad: { paddingVertical: 8 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 36 },
});
