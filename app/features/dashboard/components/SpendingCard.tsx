/**
 * "{Month} spending" card (screens.md 1.4): current-month donut + top-5
 * category legend, with a ghost "Budget" link into the Budget tab.
 *
 * Data: the EXISTING reports hook useReportsFlow(currentIsoMonth()) --
 * GET /reports/flow through queryKeys.reports.flow(month), shared cache with
 * the Reports screen. Segments are FlowCurrencyGroupDto.categories (server
 * sorts descending, transfers excluded); the center total is expenseMinor.
 * One donut per currency group with content; the currency heading appears
 * only when more than one currency exists (P7-7 / 0.1).
 *
 * Colors are the deterministic presentation-only assignment (0.3):
 * categoryColor(categoryId, theme palette); the null (uncategorized) bucket
 * always takes the palette's `other` slot. Legend rows lead with the
 * category identity glyph in that same accent (CategoryGlyph,
 * ops/design-spec/icons.md), so the glyph and its donut segment always
 * agree. Category names are API data and render verbatim -- never through
 * t().
 */
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { ChartPie, ChevronRight } from 'lucide-react-native';
import type {
  CurrencyCode,
  FlowCategoryDto,
  FlowCurrencyGroupDto,
} from '@goldfinch/shared/types';

import { localeTag, useLang, useT } from '../../../src/i18n';
import { currentIsoMonth } from '../../../src/lib/dates';
import { logger } from '../../../src/lib/logger';
import { categoryColor, DonutChart } from '../../../src/ui/charts';
import { CategoryGlyph } from '../../../src/ui/icons';
import { CurrencyAmount, formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { useMaskMoney } from '../../../src/state/uiStore';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  hoverBackground,
  hoverTransitionStyle,
  useHover,
} from '../../../src/ui/useHover';
import { useReducedMotion } from '../../../src/ui/useReducedMotion';
import { CurrencyHeading } from '../../reports/components/CurrencyHeading';
import { useReportsFlow } from '../../reports/hooks';
import { flowGroupHasContent, flowIsEmpty } from '../../reports/lib/series';
import { DEFAULT_PERIOD_SCOPE, useWindowTransactions, type PeriodScope } from '../hooks';
import { isoMonthName, monthSpendingTitle } from '../lib/labels';
import { windowExpenseByCurrency } from '../lib/spend';
import { Card, CardHeader } from './Card';
import { CardSkeleton } from './Skeleton';
import { ErrorState } from './States';

const log = logger.child({ screen: 'dashboard', card: 'spending' });

/** Donut diameter on the dashboard (screens.md 1.4). */
const DONUT_SIZE = 132;
/** Legend rows shown (top categories by spend; server pre-sorts). */
const LEGEND_LIMIT = 5;

/**
 * One legend row. Categorized rows are drill-down links (P8-2): press
 * navigates to /transactions?category=<id>, where the screen consumes the
 * param into the category filter chip. The uncategorized bucket has no
 * category id to filter on and stays a plain row.
 */
function LegendRow({
  category,
  currency,
}: {
  category: FlowCategoryDto;
  currency: CurrencyCode;
}) {
  const theme = useTheme();
  const router = useRouter();
  const reduced = useReducedMotion();
  const drillable = category.categoryId !== null;
  const { hovered, hoverProps } = useHover(drillable);

  const body = (pressed: boolean) => (
    <View
      style={[
        styles.legendRow,
        drillable ? hoverTransitionStyle(reduced) : null,
        {
          borderRadius: theme.radius.control,
          backgroundColor: hovered ? hoverBackground(theme) : 'transparent',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <CategoryGlyph
        categoryId={category.categoryId}
        categoryName={category.categoryName}
        size={14}
      />
      <Text
        numberOfLines={1}
        style={[
          styles.legendName,
          {
            color: theme.colors.text,
            fontSize: 12.5,
            fontFamily: theme.fonts.sans,
          },
        ]}
      >
        {category.categoryName}
      </Text>
      <CurrencyAmount
        amountMinor={category.amountMinor}
        currency={currency}
        size="sm"
        style={{ color: theme.colors.dim }}
      />
    </View>
  );

  if (!drillable) return body(false);

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/transactions',
          params: { category: category.categoryId },
        })
      }
      {...hoverProps}
      accessibilityRole="link"
      accessibilityLabel={category.categoryName}
      accessibilityHint="Shows this category's transactions"
      testID={`spending-legend-${category.categoryId}`}
    >
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

function GroupDonut({
  group,
  title,
  spentLabel,
}: {
  group: FlowCurrencyGroupDto;
  title: string;
  spentLabel: string;
}) {
  const theme = useTheme();
  // Privacy mode must reach the donut's center figure, the hover/touch value
  // flags, AND the screen-reader summary -- all built here outside the
  // masking primitives (the SVG center/flag text is a pre-formatted string,
  // not a Money node).
  const { mask } = useMaskMoney();
  const spend = group.categories.filter(
    (category) => category.amountMinor > 0,
  );
  const segments = spend.map((category) => ({
    value: category.amountMinor,
    color:
      category.categoryId === null
        ? theme.colors.categoryOther
        : categoryColor(category.categoryId, theme.colors.categories),
    // Value-flag text for the hover/touch segment swell (PHASE9-DECISIONS
    // P9-2 item 4); category names are API data and render verbatim. The
    // money half is masked under privacy mode so the flag never reveals it.
    label: `${category.categoryName} · ${mask(formatMinorAmount(category.amountMinor, group.currency))}`,
  }));
  const total = mask(formatMinorAmount(group.expenseMinor, group.currency));

  return (
    <View style={styles.bodyRow}>
      <DonutChart
        segments={segments}
        size={DONUT_SIZE}
        centerTop={spentLabel}
        centerMain={total}
        animationKey={group.currency}
        accessibilityLabel={`${title}: ${total}`}
        // Segment swell + value flag on web hover and native touch (P9-2
        // item 4) -- one pointer stream via the chart kit.
        interactive
        testID={`spending-donut-${group.currency}`}
      />
      <View style={styles.legend}>
        {spend.slice(0, LEGEND_LIMIT).map((category, index) => (
          <LegendRow
            key={category.categoryId ?? `uncategorized-${index}`}
            category={category}
            currency={group.currency}
          />
        ))}
      </View>
    </View>
  );
}

/** Ghost "Budget" header link, shared by the month + week cards. */
function BudgetLink() {
  const theme = useTheme();
  const t = useT();
  return (
    <Link href="/budget" asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('Budget')}
        style={({ pressed }) =>
          StyleSheet.flatten([styles.ghostLink, { opacity: pressed ? 0.7 : 1 }])
        }
      >
        <Text
          style={{
            color: theme.colors.accent,
            fontSize: 13,
            fontFamily: theme.fonts.sansSet.semibold,
          }}
        >
          {t('Budget')}
        </Text>
        <ChevronRight size={14} color={theme.colors.accent} />
      </Pressable>
    </Link>
  );
}

/**
 * Dashboard spending card (screens.md 1.4), scope-aware per P11-5. This Month
 * is the server-aggregated `/reports/flow` donut (unchanged default); This
 * Week is the periodWindow-derived spend figure (no weekly flow route exists).
 */
export function SpendingCard({
  scope = DEFAULT_PERIOD_SCOPE,
}: {
  scope?: PeriodScope;
} = {}) {
  return scope === 'weekly' ? <WeekSpendingCard /> : <MonthSpendingCard />;
}

function MonthSpendingCard() {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  // Pinned per mount, like the recent-transactions window; a focus refetch
  // after local midnight picks the new month up on the next mount.
  const month = useMemo(() => currentIsoMonth(), []);
  const flowQuery = useReportsFlow(month);

  useEffect(() => {
    if (flowQuery.isError) {
      log.warn('reports flow failed; spending card degraded', {
        month,
        error: flowQuery.error,
      });
    }
  }, [flowQuery.isError, flowQuery.error, month]);

  const monthName = isoMonthName(month, localeTag(lang));
  const title = monthSpendingTitle(lang, monthName);

  if (flowQuery.isPending) {
    return <CardSkeleton rows={3} />;
  }
  if (flowQuery.isError) {
    return (
      <ErrorState
        title="Could not load spending"
        onRetry={() => void flowQuery.refetch()}
      />
    );
  }

  const groups = (flowQuery.data.perCurrency ?? []).filter(flowGroupHasContent);
  const empty = flowIsEmpty(flowQuery.data);

  return (
    <Card>
      <CardHeader title={title} right={<BudgetLink />} />
      {empty ? (
        <View style={styles.empty}>
          <View
            style={[
              styles.emptyTile,
              {
                backgroundColor: theme.colors.surfaceAlt,
                borderRadius: theme.radius.token,
              },
            ]}
          >
            <ChartPie size={22} color={theme.colors.dim} strokeWidth={2} />
          </View>
          <Text
            style={{
              color: theme.colors.dim,
              fontSize: 12.5,
              fontFamily: theme.fonts.sans,
              textAlign: 'center',
              marginTop: 8,
            }}
          >
            {`No spending yet in ${monthName}. Transactions appear after your next sync.`}
          </Text>
        </View>
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {groups.map((group) => (
            <View key={group.currency} style={{ gap: theme.spacing.xs }}>
              {groups.length > 1 ? (
                <CurrencyHeading currency={group.currency} />
              ) : null}
              <GroupDonut
                group={group}
                title={title}
                spentLabel={t('Spent')}
              />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/**
 * This Week spending figure (P11-5): the periodWindow('weekly')-scoped expense
 * total per currency, derived client-side because there is no weekly flow
 * route. No donut/legend (the flow category breakdown is monthly only); just
 * the headline spent figure(s) with the same Budget link.
 */
function WeekSpendingCard() {
  const theme = useTheme();
  const t = useT();
  const { mask } = useMaskMoney();
  const txnQuery = useWindowTransactions('weekly');

  useEffect(() => {
    if (txnQuery.isError) {
      log.warn('window transactions failed; week spending card degraded', {
        scope: 'weekly',
        error: txnQuery.error,
      });
    }
  }, [txnQuery.isError, txnQuery.error]);

  if (txnQuery.isPending) {
    return <CardSkeleton rows={2} />;
  }
  if (txnQuery.isError) {
    return (
      <ErrorState
        title="Could not load spending"
        onRetry={() => void txnQuery.refetch()}
      />
    );
  }

  const spends = windowExpenseByCurrency(txnQuery.data.items);
  const empty = spends.length === 0;

  return (
    <Card>
      <CardHeader title={t('This week')} right={<BudgetLink />} />
      {empty ? (
        <View style={styles.empty}>
          <View
            style={[
              styles.emptyTile,
              {
                backgroundColor: theme.colors.surfaceAlt,
                borderRadius: theme.radius.token,
              },
            ]}
          >
            <ChartPie size={22} color={theme.colors.dim} strokeWidth={2} />
          </View>
          <Text
            style={{
              color: theme.colors.dim,
              fontSize: 12.5,
              fontFamily: theme.fonts.sans,
              textAlign: 'center',
              marginTop: 8,
            }}
          >
            No spending yet this week. Transactions appear after your next sync.
          </Text>
        </View>
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          {spends.map((spend) => (
            <View key={spend.currency} style={styles.weekRow}>
              {spends.length > 1 ? (
                <CurrencyHeading currency={spend.currency} />
              ) : (
                <Text
                  style={{
                    color: theme.colors.dim,
                    fontSize: 12.5,
                    fontFamily: theme.fonts.sans,
                  }}
                >
                  {t('Spent')}
                </Text>
              )}
              <Text
                accessibilityLabel={`${t('Spent')}: ${mask(formatMinorAmount(spend.expenseMinor, spend.currency))}`}
                style={{
                  color: theme.colors.text,
                  fontSize: 22,
                  fontFamily: theme.fonts.mono,
                  fontWeight: '600',
                }}
              >
                {mask(formatMinorAmount(spend.expenseMinor, spend.currency))}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  ghostLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  bodyRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  legend: { flex: 1, gap: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendName: { flex: 1 },
  empty: { alignItems: 'center', paddingVertical: 18 },
  emptyTile: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
