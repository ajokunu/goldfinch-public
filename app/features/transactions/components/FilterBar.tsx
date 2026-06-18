/**
 * Activity filter bar (screens.md 2.1/2.2): surface search card (debounced
 * server `q` on payeeLower/noteLower -- debounce stays in the parent), a
 * date-scope segmented control (P11-5: This Week / This Month / This Year /
 * Custom, the first three backed by the shared periodWindow), and a
 * horizontal chip row -- status chips (All / Pending mapping to the existing
 * pendingOnly toggle), the active Custom date-range preset as a labeled chip
 * (only while the scope is Custom; it opens the filter sheet), a 1px divider,
 * then one Wallet chip per account toggling the existing accountId filter.
 *
 * Income / Expenses chips are a spec'd GAP (no server sign/type param;
 * client-side sign filtering across cursor pages would silently drop
 * unloaded matches) and are deliberately omitted until the API grows one.
 *
 * All filter state lives in the parent screen; every change lands in the
 * query key and naturally starts a fresh infinite query.
 */
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Calendar, Clock, Search, Tag, Wallet, X } from 'lucide-react-native';
import type { AccountDto } from '@goldfinch/shared/types';

import { useT } from '../../../src/i18n';
import { Segmented } from '../../../src/ui/Segmented';
import { SharedMark } from '../../../src/ui/motion';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  DATE_RANGE_PRESETS,
  DATE_SCOPE_OPTIONS,
  DEFAULT_DATE_RANGE_PRESET,
  type DateRangePresetId,
  type DateScope,
} from '../lib/dateRanges';
import { FilterChip } from './FilterChip';

export interface FilterBarProps {
  searchText: string;
  onSearchTextChange: (text: string) => void;
  /** Active date scope (P11-5). Custom reveals the from/to preset chip. */
  scope: DateScope;
  onScopeChange: (scope: DateScope) => void;
  preset: DateRangePresetId;
  accountId: string | null;
  onAccountIdChange: (accountId: string | null) => void;
  accounts: readonly AccountDto[];
  pendingOnly: boolean;
  onPendingOnlyChange: (pendingOnly: boolean) => void;
  /** Opens the filter sheet (date presets + account list). */
  onOpenFilters: () => void;
  /** P8-3 category filter: the active categoryId (null = all). */
  categoryId: string | null;
  /** Resolved display name for the active category (id until lookups land). */
  categoryName: string | null;
  /** Opens the category picker sheet. */
  onOpenCategoryPicker: () => void;
  /** Clears the category filter (the chip's trailing X). */
  onClearCategory: () => void;
}

export function FilterBar({
  searchText,
  onSearchTextChange,
  scope,
  onScopeChange,
  preset,
  accountId,
  onAccountIdChange,
  accounts,
  pendingOnly,
  onPendingOnlyChange,
  onOpenFilters,
  categoryId,
  categoryName,
  onOpenCategoryPicker,
  onClearCategory,
}: FilterBarProps) {
  const theme = useTheme();
  const t = useT();

  const presetLabel =
    DATE_RANGE_PRESETS.find((option) => option.id === preset)?.label ?? preset;
  const scopeOptions = DATE_SCOPE_OPTIONS.map((option) => ({
    key: option.scope,
    label: t(option.label),
  }));

  return (
    <View
      style={{
        paddingHorizontal: theme.density.pad,
        paddingTop: theme.spacing.sm,
        paddingBottom: theme.spacing.xs,
        backgroundColor: theme.colors.bg,
      }}
    >
      <View
        style={[
          styles.searchBox,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radius.control,
            paddingHorizontal: theme.spacing.sm + theme.spacing.xs,
          },
        ]}
      >
        <Search size={16} strokeWidth={2.2} color={theme.colors.dim} />
        <TextInput
          value={searchText}
          onChangeText={onSearchTextChange}
          placeholder={t('Search payees')}
          placeholderTextColor={theme.colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search transactions"
          style={[
            styles.searchInput,
            {
              color: theme.colors.text,
              fontFamily: theme.fonts.sans,
              marginLeft: theme.spacing.sm,
            },
          ]}
        />
        {searchText.length > 0 ? (
          <Pressable
            onPress={() => onSearchTextChange('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
          >
            <X size={16} color={theme.colors.dim} />
          </Pressable>
        ) : null}
      </View>

      {/* Date-scope control (P11-5): the first three scopes resolve through
          the shared periodWindow; Custom reveals the from/to preset chip in
          the row below (and the FilterSheet's preset radio list). */}
      <View style={{ paddingTop: theme.spacing.sm }}>
        <Segmented
          options={scopeOptions}
          value={scope}
          onChange={onScopeChange}
          small
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.chipRow,
          { paddingVertical: theme.spacing.sm },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <FilterChip
          label={t('All')}
          active={!pendingOnly}
          onPress={() => onPendingOnlyChange(false)}
        />
        <FilterChip
          label={t('Pending')}
          icon={Clock}
          active={pendingOnly}
          onPress={() => onPendingOnlyChange(!pendingOnly)}
        />
        {scope === 'custom' ? (
          <FilterChip
            label={presetLabel}
            icon={Calendar}
            active={preset !== DEFAULT_DATE_RANGE_PRESET}
            onPress={onOpenFilters}
          />
        ) : null}
        {categoryId === null ? (
          <FilterChip
            label={t('Category')}
            icon={Tag}
            onPress={onOpenCategoryPicker}
          />
        ) : (
          // Removable category chip (P8-3): the body re-opens the picker,
          // the trailing X clears the filter. SharedMark (PHASE9-DECISIONS
          // P9-2 item 3, spending row -> transactions): when a dashboard
          // drill-down lands here, the chip fast-fades in place as the
          // continuity anchor of the legend row that was pressed.
          <SharedMark tag={`category-${categoryId}`}>
            <FilterChip
              label={categoryName ?? categoryId}
              categoryId={categoryId}
              categoryName={categoryName}
              active
              onPress={onOpenCategoryPicker}
              onClear={onClearCategory}
            />
          </SharedMark>
        )}
        <View style={[styles.divider, { backgroundColor: theme.colors.line }]} />
        {accounts.map((account) => (
          <FilterChip
            key={account.accountId}
            label={account.name}
            icon={Wallet}
            active={accountId === account.accountId}
            onPress={() =>
              onAccountIdChange(
                accountId === account.accountId ? null : account.accountId,
              )
            }
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 10 },
  chipRow: { gap: 8, alignItems: 'center' },
  divider: { width: 1, height: 22, marginHorizontal: 2 },
});
