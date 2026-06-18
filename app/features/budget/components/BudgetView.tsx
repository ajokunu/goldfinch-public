/**
 * Envelope budget view for the current month (design spec screens.md 3.3).
 * Actuals come from the GSI2-backed server math: per-category spent/remaining
 * ride on GET /budgets, and the summary strip's income figure rides on
 * GET /cashflow for the same month. The view is current-month only because
 * the API computes budget actuals for the open period -- hence the static
 * month caption without chevrons (3.2 gap: no month param on GET /budgets).
 *
 * Summary strip: Income | Budgeted | Left (integer minor-unit math only).
 * When the cashflow read fails or is empty while budgets load fine, the strip
 * degrades to Budgeted + Spent -- never a blank or invented income.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChartPie, Plus, Tag } from 'lucide-react-native';
import { stepWeek } from '@goldfinch/shared/periodWindow';
import type {
  BudgetDto,
  BudgetPeriod,
  CategoryDto,
  CurrencyCode,
} from '@goldfinch/shared/types';

import { localeTag, useLang, useT } from '../../../src/i18n';
import {
  GoldfinchRefreshControl,
  GoldfinchRefreshMark,
} from '../../../src/ui/GoldfinchRefresh';
import { ListRow } from '../../../src/ui/ListRow';
import { mixColor, withAlpha } from '../../../src/ui/mixColor';
import {
  CountUp,
  FadeRise,
  stagger,
  staggerChildDelayMs,
} from '../../../src/ui/motion';
import { shadowStyle } from '../../../src/ui/shadows';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { groupLabel, UNGROUPED_KEY } from '../lib/grouping';
import { colorForCategory } from '../lib/colors';
import { currentIsoMonth, isoMonthLabel } from '../../../src/lib/dates';
import {
  BUDGET_DATE_RANGE_PRESETS,
  resolveBudgetDateRange,
  type DateRangePresetId,
} from '../../../src/lib/dateRangePresets';
import {
  useBudgetsQuery,
  useBudgetsRangeQuery,
  useCashflowQuery,
  useCategoriesQuery,
} from '../hooks/useBudgetQueries';
import {
  BUDGET_PERIOD_EMPTY,
  BUDGET_PERIOD_KEYS,
  BUDGET_PERIOD_ORDER,
  DEFAULT_BUDGET_PERIOD,
} from '../lib/periods';
import { BudgetCategoryRow } from './BudgetCategoryRow';
import { BudgetEditorModal, type BudgetEditorTarget } from './BudgetEditorModal';
import { Button } from './Buttons';
import { SegmentedTabs } from './SegmentedTabs';
import { CategoryPickerModal } from './CategoryPickerModal';
import {
  CategoryTransactionsModal,
  type CategoryTransactionsTarget,
} from './CategoryTransactionsModal';
import { RangeChooserSheet } from './RangeChooserSheet';
import { WeekStepper } from './WeekStepper';
import { ErrorState, LoadingState } from '../../../src/ui/States';

interface BudgetRowData {
  budget: BudgetDto;
  category: CategoryDto | undefined;
  name: string;
}

interface BudgetSection {
  key: string;
  label: string;
  rows: BudgetRowData[];
}

function buildSections(
  budgets: BudgetDto[],
  categories: CategoryDto[],
): BudgetSection[] {
  const categoryById = new Map(categories.map((c) => [c.categoryId, c]));
  const buckets = new Map<string, BudgetRowData[]>();
  for (const budget of budgets) {
    const category = categoryById.get(budget.categoryId);
    const row: BudgetRowData = {
      budget,
      category,
      name: budget.categoryName ?? category?.name ?? budget.categoryId,
    };
    const key = category?.groupId ?? UNGROUPED_KEY;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      buckets.set(key, [row]);
    }
  }

  const sections: BudgetSection[] = [];
  for (const [key, rows] of buckets) {
    rows.sort((a, b) => {
      const aOrder = a.category?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = b.category?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.name.localeCompare(b.name);
    });
    sections.push({
      key,
      label: key === UNGROUPED_KEY ? 'Other' : groupLabel(key),
      rows,
    });
  }
  sections.sort((a, b) => {
    if (a.key === UNGROUPED_KEY) return 1;
    if (b.key === UNGROUPED_KEY) return -1;
    const aMin = a.rows[0]?.category?.sortOrder ?? 0;
    const bMin = b.rows[0]?.category?.sortOrder ?? 0;
    if (aMin !== bMin) return aMin - bMin;
    return a.label.localeCompare(b.label);
  });
  return sections;
}

export interface BudgetViewProps {
  /**
   * Injectable "now" for the week/range window derivation (tests). All NEW
   * window math (stepWeek, resolveBudgetDateRange) anchors on this; the existing
   * default-mode month label/cashflow path is unchanged.
   */
  now?: Date;
}

export function BudgetView({ now }: BudgetViewProps = {}) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  const month = currentIsoMonth();
  const anchor = now ?? new Date();

  const [editorTarget, setEditorTarget] = useState<BudgetEditorTarget | null>(null);
  const [txnTarget, setTxnTarget] = useState<CategoryTransactionsTarget | null>(null);
  const [pickingCategory, setPickingCategory] = useState(false);
  // P11-4: the Week/Month/Year tabs FILTER the list to budgets of the selected
  // cadence (per-budget-period model). Default Month, the pre-Phase-11 cadence.
  const [periodTab, setPeriodTab] = useState<BudgetPeriod>(DEFAULT_BUDGET_PERIOD);
  // Budget-range feature: the context-sensitive date header above the cadence
  // tabs. Week tab => a whole-week offset (0 = current week); Month/Year tab =>
  // a date-range preset (null = default current-period view).
  const [weekDelta, setWeekDelta] = useState(0);
  const [rangePreset, setRangePreset] = useState<DateRangePresetId | null>(null);
  const [rangeSheetOpen, setRangeSheetOpen] = useState(false);

  // The active scope window, and whether it departs from the default current
  // period. Week tab: any non-zero step is a range; delta 0 is the current week
  // the default query already covers. Month/Year tab: any selected preset is a
  // range. All window math goes through the shared periodWindow/stepWeek and the
  // ET preset resolvers -- never app/src/lib/dates.ts local math.
  const activeWindow =
    periodTab === 'weekly'
      ? stepWeek(anchor, weekDelta)
      : rangePreset !== null
        ? resolveBudgetDateRange(rangePreset, anchor)
        : null;
  const rangeActive =
    periodTab === 'weekly' ? weekDelta !== 0 : rangePreset !== null;

  const categoriesQuery = useCategoriesQuery();
  const budgetsQuery = useBudgetsQuery();
  const rangeQuery = useBudgetsRangeQuery(
    activeWindow?.from ?? '',
    activeWindow?.to ?? '',
    rangeActive && activeWindow !== null,
  );
  const cashflowQuery = useCashflowQuery(month, month);

  const currency: CurrencyCode = cashflowQuery.data?.currency ?? 'USD';
  const monthCashflow = cashflowQuery.data?.months.find((m) => m.month === month);

  const categories = useMemo(
    () => categoriesQuery.data?.items ?? [],
    [categoriesQuery.data],
  );
  // In range mode the rows + per-row prorated targets ride the range query
  // (limitMinor carries the prorated target server-side); otherwise the default
  // current-period query.
  const budgets = useMemo(
    () =>
      (rangeActive ? rangeQuery.data?.items : budgetsQuery.data?.items) ?? [],
    [rangeActive, rangeQuery.data, budgetsQuery.data],
  );

  // P11-4: only the budgets whose own cadence matches the selected tab. Each
  // budget's limit + spent are already for ITS period (server-windowed), so no
  // re-scaling here -- the tab is a pure filter, not a conversion.
  const visibleBudgets = useMemo(
    () => budgets.filter((b) => b.period === periodTab),
    [budgets, periodTab],
  );

  const sections = useMemo(
    () => buildSections(visibleBudgets, categories),
    [visibleBudgets, categories],
  );

  const unbudgeted = useMemo(() => {
    const budgeted = new Set(budgets.map((b) => b.categoryId));
    return categories
      .filter(
        (category) =>
          !category.archived &&
          category.type === 'EXPENSE' &&
          !budgeted.has(category.categoryId),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }, [budgets, categories]);

  // Integer minor-unit sums only (P7-7 posture); no decimal math on the
  // client. The strip's Left column is income - budgeted. Scoped to the visible
  // (filtered) cadence so the totals describe what is on screen -- summing
  // weekly + monthly + yearly limits into one figure would be meaningless.
  const budgetedMinor = useMemo(
    () => visibleBudgets.reduce((sum, b) => sum + b.limitMinor, 0),
    [visibleBudgets],
  );
  const spentTotalMinor = useMemo(
    () => visibleBudgets.reduce((sum, b) => sum + b.spentMinor, 0),
    [visibleBudgets],
  );

  // The budgets query that backs the current view: the range query in range
  // mode, the default current-period query otherwise.
  const activeBudgetsQuery = rangeActive ? rangeQuery : budgetsQuery;

  const isPending = activeBudgetsQuery.isPending || categoriesQuery.isPending;
  const isError = activeBudgetsQuery.isError || categoriesQuery.isError;
  const refreshing =
    activeBudgetsQuery.isRefetching ||
    categoriesQuery.isRefetching ||
    cashflowQuery.isRefetching;

  const refetchAll = () => {
    void activeBudgetsQuery.refetch();
    void categoriesQuery.refetch();
    void cashflowQuery.refetch();
  };

  if (isPending) return <LoadingState />;
  if (isError) {
    return (
      <ErrorState message="Could not load your budget." onRetry={refetchAll} />
    );
  }

  // Studio's "accent hero card" treatment (spec 0.5) applies to the budget
  // summary strip; `hero === 'editorial'` is the studio-only token.
  const accentStrip = theme.hero === 'editorial';
  const stripBg = accentStrip ? theme.colors.accent : theme.colors.surface;
  const stripText = accentStrip ? theme.colors.onAccent : theme.colors.textPrimary;
  const stripDim = accentStrip
    ? withAlpha(theme.colors.onAccent, 0.72)
    : theme.colors.textSecondary;
  const stripDivider = accentStrip
    ? withAlpha(theme.colors.onAccent, 0.25)
    : theme.colors.line;
  // Income | Budgeted | Left only makes sense against the monthly cadence --
  // the cashflow income figure is a per-MONTH number, so comparing it to a
  // weekly or yearly budgeted total would be apples to oranges. On the Week /
  // Year tabs the strip degrades to Budgeted | Spent (both for that cadence).
  // Section 9.3 A: in range mode the strip degrades to Budgeted | Spent (the
  // cashflow income figure is a current-month number that cannot be compared to
  // an arbitrary range), reusing the existing degrade path.
  const hasIncome =
    !rangeActive &&
    periodTab === 'monthly' &&
    monthCashflow !== undefined &&
    !cashflowQuery.isError;

  const stripColumns: Array<{ label: string; valueMinor: number }> = hasIncome
    ? [
        { label: t('Income'), valueMinor: monthCashflow.incomeMinor },
        { label: t('Budgeted'), valueMinor: budgetedMinor },
        {
          label: t('Left'),
          valueMinor: monthCashflow.incomeMinor - budgetedMinor,
        },
      ]
    : [
        { label: t('Budgeted'), valueMinor: budgetedMinor },
        { label: t('Spent'), valueMinor: spentTotalMinor },
      ];

  const eyebrowStyle = {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontFamily: theme.fonts.sansSet.bold,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.96,
    marginBottom: 8,
  };

  // Week / Month / Year filter options, from the single period source so the
  // tabs, the row caption, and the editor picker can never disagree.
  const periodTabOptions = BUDGET_PERIOD_ORDER.map((period) => ({
    key: period,
    label: t(BUDGET_PERIOD_KEYS[period]),
  }));

  // Month/Year header label: the selected preset's name when range mode is
  // active, else the current-month caption (now a tap target that opens the
  // range chooser). The Week tab renders the WeekStepper instead of this label.
  const activePresetLabel = BUDGET_DATE_RANGE_PRESETS.find(
    (p) => p.id === rangePreset,
  )?.label;
  const monthHeaderLabel =
    activePresetLabel !== undefined
      ? t(activePresetLabel)
      : isoMonthLabel(month, localeTag(lang));

  return (
    <>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.density.pad,
          paddingBottom: theme.spacing.xl,
        }}
        refreshControl={
          <GoldfinchRefreshControl
            refreshing={refreshing}
            onRefresh={refetchAll}
          />
        }
      >
        {/* Context-sensitive date header (budget-range feature, Decision 5):
            Week tab => a prev/next week stepper; Month/Year tab => a tappable
            label that opens the date-range chooser. Entrance cascade via the
            shared motion module (PHASE9-DECISIONS P9-1/P9-2 item 1). */}
        <FadeRise>
          <View style={{ marginBottom: 12 }}>
            {periodTab === 'weekly' ? (
              <WeekStepper
                weekDelta={weekDelta}
                onChange={setWeekDelta}
                now={anchor}
              />
            ) : (
              <Pressable
                onPress={() => setRangeSheetOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`${monthHeaderLabel}, change date range`}
                hitSlop={theme.spacing.sm}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text
                  style={[
                    styles.monthCaption,
                    {
                      color: theme.colors.textPrimary,
                      fontFamily: theme.fonts.display,
                      fontWeight: theme.fonts.displayWeight,
                    },
                  ]}
                >
                  {monthHeaderLabel}
                </Text>
              </Pressable>
            )}
          </View>

          {/* Summary strip: Income | Budgeted | Left (degraded: Budgeted |
              Spent when the cashflow read failed or is empty). */}
          <View
            style={[
              theme.card.shadow === 'sm' ? shadowStyle(theme.shadows.sm) : null,
              styles.strip,
              {
                backgroundColor: stripBg,
                borderColor: accentStrip ? stripBg : theme.colors.border,
                borderWidth: theme.card.borderWidth,
                borderRadius: theme.radius.card,
                marginBottom: 14,
              },
            ]}
          >
            {stripColumns.map((column, index) => (
              <View
                key={column.label}
                style={[
                  styles.stripCell,
                  index > 0
                    ? { borderLeftWidth: 1, borderLeftColor: stripDivider }
                    : null,
                ]}
              >
                <Text style={[styles.stripLabel, { color: stripDim, fontFamily: theme.fonts.sans }]}>
                  {column.label}
                </Text>
                {/* Budget totals headline (PHASE9-DECISIONS P9-2 item 4):
                    rolling-digit CountUp on mount and on value change. The
                    mono family IS the weight cut; never synthesize on top
                    of a loaded custom font (tokens.md 8.3). */}
                <CountUp
                  amountMinor={column.valueMinor}
                  currency={currency}
                  style={[
                    styles.stripValue,
                    {
                      color: stripText,
                      fontFamily: theme.fonts.monoSet.bold,
                      fontWeight: 'normal',
                    },
                  ]}
                  testID={`budget-strip-${index}`}
                />
              </View>
            ))}
          </View>

          {/* P11-4: Week / Month / Year filter. Each budget has its OWN cadence
              (weekly food, monthly rent), so the tab narrows the list to one
              cadence rather than converting limits between periods. */}
          <View style={{ marginBottom: 14 }}>
            <SegmentedTabs
              options={periodTabOptions}
              value={periodTab}
              onChange={setPeriodTab}
            />
          </View>
        </FadeRise>

        {sections.length === 0 ? (
          <FadeRise delay={staggerChildDelayMs(1, stagger.cascadeMs)}>
            <View
              style={[
                styles.emptyCard,
                theme.card.shadow === 'sm' ? shadowStyle(theme.shadows.sm) : null,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  borderWidth: theme.card.borderWidth,
                  borderRadius: theme.radius.card,
                  marginBottom: 14,
                },
              ]}
            >
              <View
                style={[
                  styles.emptyTile,
                  {
                    backgroundColor: mixColor(
                      theme.colors.accent,
                      0.15,
                      theme.colors.surface,
                    ),
                  },
                ]}
              >
                <ChartPie size={22} color={theme.colors.accent} strokeWidth={2.2} />
              </View>
              <Text
                style={[
                  styles.emptyTitle,
                  { color: theme.colors.textPrimary, fontFamily: theme.fonts.sansSet.bold },
                ]}
              >
                {/* P11-4 per-tab empty state: "No weekly budgets yet" when the
                    user has budgets but none of THIS cadence; the original
                    first-run copy only when there are no budgets at all. */}
                {budgets.length === 0
                  ? 'No budgets yet'
                  : BUDGET_PERIOD_EMPTY[periodTab]}
              </Text>
              <Text
                style={[
                  styles.emptyBody,
                  { color: theme.colors.textSecondary, fontFamily: theme.fonts.sans },
                ]}
              >
                {budgets.length === 0
                  ? 'Set a monthly limit on a category to start tracking'
                  : 'Add a budget for this period or switch tabs'}
              </Text>
              <Button
                label="New budget"
                onPress={() => setPickingCategory(true)}
              />
            </View>
          </FadeRise>
        ) : (
          sections.map((section, sectionIndex) => (
            <FadeRise
              key={section.key}
              delay={staggerChildDelayMs(sectionIndex + 1, stagger.cascadeMs)}
            >
              <View style={{ marginBottom: theme.spacing.sm }}>
                <Text style={eyebrowStyle}>{section.label}</Text>
                {section.rows.map((row) => (
                  <BudgetCategoryRow
                    key={row.budget.categoryId}
                    name={row.name}
                    budget={row.budget}
                    currency={currency}
                    color={colorForCategory(row.budget.categoryId, theme)}
                    periodLabel={t(BUDGET_PERIOD_KEYS[row.budget.period])}
                    onPress={() =>
                      setTxnTarget({
                        categoryId: row.budget.categoryId,
                        title: row.name,
                      })
                    }
                    onEdit={() =>
                      setEditorTarget({
                        categoryId: row.budget.categoryId,
                        categoryName: row.name,
                        budget: row.budget,
                        currency,
                      })
                    }
                  />
                ))}
              </View>
            </FadeRise>
          ))
        )}

        <View style={{ marginTop: theme.spacing.sm, marginBottom: theme.spacing.md }}>
          <ListRow
            label="Review uncategorized"
            icon={Tag}
            onPress={() =>
              setTxnTarget({ categoryId: null, title: t('Uncategorized') })
            }
          />
        </View>

        {unbudgeted.length > 0 ? (
          <View>
            <Text style={eyebrowStyle}>Not budgeted</Text>
            {unbudgeted.map((category) => (
              <ListRow
                key={category.categoryId}
                label={category.name}
                icon={Plus}
                onPress={() =>
                  setEditorTarget({
                    categoryId: category.categoryId,
                    categoryName: category.name,
                    currency,
                    // Seed the new budget's cadence from the active tab (P11-4).
                    initialPeriod: periodTab,
                  })
                }
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
      <GoldfinchRefreshMark active={refreshing} />

      <BudgetEditorModal
        target={editorTarget}
        onClose={() => setEditorTarget(null)}
      />
      {/* Section 9.3 C: in range mode the drill-down opens the category's
          transactions for the SAME [from,to] the row's spend was computed over;
          otherwise the current month. */}
      <CategoryTransactionsModal
        target={txnTarget}
        month={month}
        range={rangeActive ? activeWindow : undefined}
        currency={currency}
        onClose={() => setTxnTarget(null)}
      />
      <RangeChooserSheet
        visible={rangeSheetOpen}
        preset={rangePreset}
        onPresetChange={(preset) => {
          setRangePreset(preset);
          setRangeSheetOpen(false);
        }}
        onClose={() => setRangeSheetOpen(false)}
      />
      {/* Designed empty state's create flow: pick a category, then open the
          existing editor in create mode. */}
      <CategoryPickerModal
        visible={pickingCategory}
        currentCategoryId={null}
        onSelect={(category) => {
          setPickingCategory(false);
          setEditorTarget({
            categoryId: category.categoryId,
            categoryName: category.name,
            currency,
            // Seed the new budget's cadence from the active tab (P11-4).
            initialPeriod: periodTab,
          });
        }}
        onClose={() => setPickingCategory(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  monthCaption: { fontSize: 17, textAlign: 'center' },
  strip: { flexDirection: 'row' },
  stripCell: { flex: 1, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6 },
  stripLabel: { fontSize: 11.5, marginBottom: 4 },
  stripValue: { fontSize: 18 },
  emptyCard: { alignItems: 'center', padding: 24, gap: 8 },
  emptyTile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 15, textAlign: 'center' },
  emptyBody: { fontSize: 12.5, textAlign: 'center', marginBottom: 8 },
});
