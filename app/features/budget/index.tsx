/**
 * Budget feature entry point (master plan section 15: budgeting, categories,
 * cash flow), restyled per design spec screens.md section 3.
 *
 * Three sub-views behind a segmented control:
 * - Budget: current-month envelope budgets -- per-category limits with
 *   GSI2-backed actuals from GET /budgets, progress bars, rollover toggle,
 *   the Income | Budgeted | Left summary strip, and the recategorize
 *   drill-down.
 * - Cash flow: GET /cashflow over a picker-selected trailing window with a
 *   paired income/spend bar chart, focused-month detail, and stat cards.
 * - Categories: full category management (create, rename, regroup,
 *   archive/restore).
 *
 * All data access rides the shell: src/api/endpoints.ts for fetches and
 * src/api/queryKeys.ts for cache keys, so mutations here invalidate the
 * dashboard's and transactions tab's caches coherently (and vice versa).
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useT } from '../../src/i18n';
import { Screen } from '../../src/ui/Screen';
import { useTheme } from '../../src/ui/ThemeProvider';
import { BudgetView } from './components/BudgetView';
import { CashflowView } from './components/CashflowView';
import { CategoriesView } from './components/CategoriesView';
import { SegmentedTabs } from './components/SegmentedTabs';

const SUB_VIEW_KEYS = ['budget', 'cashflow', 'categories'] as const;

type SubViewKey = (typeof SUB_VIEW_KEYS)[number];

export default function BudgetScreen() {
  const theme = useTheme();
  const t = useT();
  const [subView, setSubView] = useState<SubViewKey>('budget');

  const subViews: ReadonlyArray<{ key: SubViewKey; label: string }> = [
    { key: 'budget', label: t('Budget') },
    { key: 'cashflow', label: t('Cash flow') },
    { key: 'categories', label: t('Categories') },
  ];

  return (
    <Screen padded={false}>
      <View
        style={{
          paddingHorizontal: theme.density.pad,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.sm,
        }}
      >
        <Text
          accessibilityRole="header"
          style={{
            color: theme.colors.textPrimary,
            fontFamily: theme.fonts.display,
            fontWeight: theme.fonts.displayWeight,
            fontSize: theme.components.screenTitle.fontSize,
            letterSpacing: theme.components.screenTitle.letterSpacing,
          }}
        >
          {t('Budget')}
        </Text>
        <View style={{ marginTop: theme.spacing.md }}>
          <SegmentedTabs
            options={subViews}
            value={subView}
            onChange={setSubView}
          />
        </View>
      </View>

      <View style={styles.body}>
        {subView === 'budget' ? (
          <BudgetView />
        ) : subView === 'cashflow' ? (
          <CashflowView />
        ) : (
          <CategoriesView />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
});
