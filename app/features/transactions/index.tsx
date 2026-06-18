/**
 * Transactions feature entry point (master plan section 14) -- the
 * "Activity" screen in the adopted design (ops/design-spec/screens.md 2).
 *
 * FlashList-based infinite list over GET /transactions:
 * - cursor pagination via useInfiniteQuery; "has next" comes ONLY from the
 *   server's nextCursor token (never from page length);
 * - date-range presets, account filter (GSI1 server-side), debounced text
 *   search (server contains() on payeeLower/noteLower), pending-only toggle;
 * - date section headers grouped client-side from the already newest-first
 *   items, with per-currency day totals once a day is fully loaded
 *   (screens.md 2.4 completeness rule);
 * - detail sheet with staged category reassignment (PATCH
 *   /transactions/{txnId}, optimistic update + 409 rollback), note editing,
 *   and the live-backed "Always tag" rule flow; confirmation toast on save.
 *
 * The FAB and Add sheet are shell-owned (shell.md 2.1) and not rendered
 * here; the list keeps bottom clearance for them.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, CircleAlert, ListFilter, Search, Sparkles } from 'lucide-react-native';
import type { TransactionDto } from '@goldfinch/shared/types';

import { categorizedAs, useLang, useT } from '../../src/i18n';
import type { TransactionListFilters } from '../../src/api/queryKeys';
import { formatDateHeading, isoDateDaysAgo, toIsoDate } from '../../src/lib/dates';
import { Button } from '../../src/ui/Button';
import { CurrencyAmount } from '../../src/ui/CurrencyAmount';
import { IconButton } from '../../src/ui/IconButton';
import { FadeRise, stagger, staggerChildDelayMs } from '../../src/ui/motion';
import { Screen } from '../../src/ui/Screen';
import { useTheme } from '../../src/ui/ThemeProvider';
import { CategoryFilterSheet } from './components/CategoryFilterSheet';
import { FilterBar } from './components/FilterBar';
import { FilterSheet } from './components/FilterSheet';
import { Toast, type ToastData } from './components/Toast';
import {
  TransactionDetailModal,
  type DetailSaveResult,
} from './components/TransactionDetailModal';
import { TransactionRow } from './components/TransactionRow';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import {
  useAccountsById,
  useAccountsQuery,
  useActiveCategories,
  useCategoryNames,
} from './hooks/useLookups';
import { useTransactionsQuery } from './hooks/useTransactionsQuery';
import {
  DEFAULT_DATE_RANGE_PRESET,
  DEFAULT_DATE_SCOPE,
  resolveDateRange,
  resolveScopeRange,
  type DateRangePresetId,
  type DateScope,
} from './lib/dateRanges';
import { dayHeadingKind } from './lib/display';
import {
  buildListItems,
  findTransaction,
  flattenPages,
  type SectionHeaderItem,
  type TransactionListItem,
} from './lib/sections';

const SEARCH_DEBOUNCE_MS = 300;
/**
 * FlashList entrance window (PHASE9-DECISIONS P9-2 item 6): only the first
 * screenful of freshly loaded items FadeRises in. Items beyond this index --
 * later pages, rows mounted while scrolling -- render statically, and the
 * mount-only FadeRise wrapper (constant element shape across recycling)
 * guarantees nothing ever re-animates on scroll.
 */
const FIRST_PAGE_ENTRANCE_ROWS = 12;
/** Bottom clearance for the shell FAB (56) + its offset above the tab bar. */
const LIST_BOTTOM_CLEARANCE = 96;

export default function TransactionsScreen() {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 1024;

  // ---- filter state (each change lands in the query key) -----------------
  const [searchText, setSearchText] = useState('');
  // Date scope (P11-5): the three period scopes resolve through the shared
  // periodWindow; Custom falls back to the from/to preset below. Default This
  // Month preserves the pre-P11 window.
  const [scope, setScope] = useState<DateScope>(DEFAULT_DATE_SCOPE);
  const [preset, setPreset] = useState<DateRangePresetId>(
    DEFAULT_DATE_RANGE_PRESET,
  );
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [selectedTxnId, setSelectedTxnId] = useState<string | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);

  // ---- drill-down params (P8-2) -------------------------------------------
  // Dashboard surfaces navigate here with ?category= (spending card) or
  // ?accountId= (account rows). Each param is consumed into the matching
  // filter and then cleared from the route, so removing the chip later
  // cannot be undone by a stale param and the same drill-down can re-fire.
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string; accountId?: string }>();
  const paramCategory = typeof params.category === 'string' ? params.category : '';
  const paramAccountId = typeof params.accountId === 'string' ? params.accountId : '';
  useEffect(() => {
    if (paramCategory.length > 0) {
      setCategoryId(paramCategory);
      router.setParams({ category: undefined });
    }
  }, [paramCategory, router]);
  useEffect(() => {
    if (paramAccountId.length > 0) {
      setAccountId(paramAccountId);
      router.setParams({ accountId: undefined });
    }
  }, [paramAccountId, router]);

  const debouncedSearch = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS);

  const filters = useMemo<TransactionListFilters>(() => {
    // Custom scope keeps the existing from/to preset; the period scopes
    // resolve through the shared periodWindow (DEFAULT_TZ calendar).
    const { from, to } =
      scope === 'custom' ? resolveDateRange(preset) : resolveScopeRange(scope);
    const q = debouncedSearch.trim().toLowerCase();
    return {
      from,
      to,
      accountId: accountId ?? undefined,
      categoryId: categoryId ?? undefined,
      q: q.length > 0 ? q : undefined,
      pendingOnly: pendingOnly ? true : undefined,
    };
  }, [scope, preset, debouncedSearch, accountId, categoryId, pendingOnly]);

  // ---- data ---------------------------------------------------------------
  const query = useTransactionsQuery(filters);
  const accountsQuery = useAccountsQuery();
  const accountsById = useAccountsById();
  const categoryNames = useCategoryNames();
  const activeCategories = useActiveCategories();

  const transactions = useMemo(
    () => flattenPages(query.data?.pages),
    [query.data],
  );
  const listItems = useMemo(
    () => buildListItems(transactions, !query.hasNextPage),
    [transactions, query.hasNextPage],
  );

  const selectedTxn = findTransaction(transactions, selectedTxnId);
  const selectedAccountName = selectedTxn
    ? (selectedTxn.accountName ??
      accountsById.get(selectedTxn.accountId)?.name ??
      '')
    : '';

  // ---- callbacks -----------------------------------------------------------
  const openDetail = useCallback((txnId: string) => {
    setSelectedTxnId(txnId);
  }, []);

  const loadMore = useCallback(() => {
    // hasNextPage derives solely from getNextPageParam -> nextCursor token.
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [query]);

  const dismissToast = useCallback(() => setToast(null), []);

  const handleSaved = useCallback(
    (result: DetailSaveResult) => {
      if (result.kind === 'rule') {
        setToast({
          id: Date.now(),
          icon: Sparkles,
          title: t('GoldFinch learned a rule'),
          sub: `${result.payee} → ${result.categoryName}`,
        });
      } else if (result.kind === 'plain') {
        setToast({
          id: Date.now(),
          icon: Check,
          title: categorizedAs(lang, result.categoryName),
          // Success checkmark draw-on after a categorize lands (P9-2 item 7).
          drawCheck: true,
        });
      } else if (result.kind === 'note') {
        setToast({
          id: Date.now(),
          icon: Check,
          title: result.cleared ? t('Note cleared') : t('Note saved'),
          drawCheck: true,
        });
      } else {
        // Rule POST/apply failed after a successful categorize (already
        // logged with context in the detail sheet).
        setToast({
          id: Date.now(),
          icon: CircleAlert,
          title: 'Rule could not be saved',
          sub: categorizedAs(lang, result.categoryName),
        });
      }
    },
    [lang, t],
  );

  const todayIso = toIsoDate(new Date());
  const yesterdayIso = isoDateDaysAgo(1);

  const renderHeader = useCallback(
    (item: SectionHeaderItem) => {
      const kind = dayHeadingKind(item.date, todayIso, yesterdayIso);
      const label =
        kind === 'today'
          ? t('Today')
          : kind === 'yesterday'
            ? t('Yesterday')
            : formatDateHeading(item.date);
      return (
        <View
          style={[
            styles.headerRow,
            {
              paddingTop: theme.spacing.md + theme.spacing.xs,
              paddingBottom: theme.spacing.xs,
              paddingHorizontal: 6,
              backgroundColor: theme.colors.bg,
            },
          ]}
        >
          <Text
            accessibilityRole="header"
            style={[
              styles.headerLabel,
              { color: theme.colors.dim, fontFamily: theme.fonts.sans },
            ]}
          >
            {label}
          </Text>
          {item.totals ? (
            <View style={styles.headerTotals}>
              {item.totals.map((total) => (
                <CurrencyAmount
                  key={total.currency}
                  amountMinor={total.totalMinor}
                  currency={total.currency}
                  signDisplay={total.totalMinor > 0 ? 'always' : 'auto'}
                  style={{
                    fontSize: 11.5,
                    fontWeight: '600',
                    color: theme.colors.faint,
                    fontFamily: theme.fonts.mono,
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>
      );
    },
    [theme, t, todayIso, yesterdayIso],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<TransactionListItem>) => {
      const content =
        item.kind === 'header' ? (
          renderHeader(item)
        ) : (
          <TransactionRow
            txn={item.txn}
            accountName={
              item.txn.accountName ??
              accountsById.get(item.txn.accountId)?.name ??
              ''
            }
            categoryName={
              item.txn.categoryId
                ? (categoryNames.get(item.txn.categoryId) ?? item.txn.categoryId)
                : null
            }
            onPress={openDetail}
          />
        );
      // First-page entrance (P9-2 item 6). EVERY item keeps the FadeRise
      // wrapper -- rows past the window get a zero-duration/zero-distance
      // one -- so the element shape is identical across FlashList recycling
      // and a recycled instance can never remount (and replay) the entrance.
      const entering = index < FIRST_PAGE_ENTRANCE_ROWS;
      return (
        <FadeRise
          delay={entering ? staggerChildDelayMs(index, stagger.cascadeMs) : 0}
          durationMs={entering ? undefined : 0}
          distance={entering ? undefined : 0}
        >
          {content}
        </FadeRise>
      );
    },
    [renderHeader, accountsById, categoryNames, openDetail],
  );

  // ---- render -------------------------------------------------------------
  let body: ReactNode;
  if (query.isPending) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} size="large" />
      </View>
    );
  } else if (query.isError) {
    body = (
      <View style={[styles.center, { padding: theme.spacing.lg }]}>
        <Text
          style={{
            color: theme.colors.text,
            fontSize: 15,
            fontFamily: theme.fonts.sans,
            textAlign: 'center',
            marginBottom: theme.spacing.sm,
          }}
        >
          Transactions could not be loaded.
        </Text>
        <Text
          style={{
            color: theme.colors.dim,
            fontSize: 12.5,
            fontFamily: theme.fonts.sans,
            textAlign: 'center',
            marginBottom: theme.spacing.md,
          }}
        >
          {query.error.message}
        </Text>
        <Button
          label="Retry"
          onPress={() => void query.refetch()}
          style={styles.retryButton}
        />
      </View>
    );
  } else {
    body = (
      <FlashList
        data={listItems}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.kind}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshing={query.isRefetching && !query.isFetchingNextPage}
        onRefresh={() => void query.refetch()}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <View style={[styles.center, styles.empty, { padding: theme.spacing.xl }]}>
            <Search size={30} strokeWidth={2} color={theme.colors.faint} />
            <Text
              style={{
                color: theme.colors.dim,
                fontSize: 15,
                fontFamily: theme.fonts.sans,
                textAlign: 'center',
              }}
            >
              {t('No transactions match.')}
            </Text>
          </View>
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <View style={{ paddingVertical: theme.spacing.lg }}>
              <ActivityIndicator color={theme.colors.accent} />
            </View>
          ) : null
        }
        contentContainerStyle={{
          paddingBottom: LIST_BOTTOM_CLEARANCE,
          paddingHorizontal: Math.max(0, theme.density.pad - 6),
        }}
      />
    );
  }

  return (
    <Screen padded={false}>
      {/* Screen entrance via the shared primitive (P9-1: no ad-hoc Animated
          code in features); the tab-switch crossfade happens one level up in
          the navigator. */}
      <FadeRise style={[styles.content, wide ? styles.wideContent : null]}>
        <View
          style={[
            styles.titleRow,
            {
              paddingHorizontal: theme.density.pad,
              paddingTop: theme.spacing.md,
            },
          ]}
        >
          <Text
            accessibilityRole="header"
            accessibilityLabel={t('Transactions')}
            style={{
              color: theme.colors.text,
              fontSize: theme.components.screenTitle.fontSize,
              letterSpacing: theme.components.screenTitle.letterSpacing,
              fontFamily: theme.fonts.display,
              fontWeight: theme.fonts.displayWeight,
            }}
          >
            {t('Activity')}
          </Text>
          <IconButton
            icon={ListFilter}
            variant="pill"
            onPress={() => setFilterSheetOpen(true)}
            accessibilityLabel="Filter transactions"
          />
        </View>
        <FilterBar
          searchText={searchText}
          onSearchTextChange={setSearchText}
          scope={scope}
          onScopeChange={setScope}
          preset={preset}
          accountId={accountId}
          onAccountIdChange={setAccountId}
          accounts={accountsQuery.data ?? []}
          pendingOnly={pendingOnly}
          onPendingOnlyChange={setPendingOnly}
          onOpenFilters={() => setFilterSheetOpen(true)}
          categoryId={categoryId}
          categoryName={
            categoryId ? (categoryNames.get(categoryId) ?? categoryId) : null
          }
          onOpenCategoryPicker={() => setCategorySheetOpen(true)}
          onClearCategory={() => setCategoryId(null)}
        />
        <View style={styles.listContainer}>{body}</View>
      </FadeRise>

      <FilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        preset={preset}
        onPresetChange={setPreset}
        accountId={accountId}
        onAccountIdChange={setAccountId}
        accounts={accountsQuery.data ?? []}
      />
      <CategoryFilterSheet
        visible={categorySheetOpen}
        onClose={() => setCategorySheetOpen(false)}
        categories={activeCategories}
        categoryId={categoryId}
        onCategoryIdChange={setCategoryId}
      />
      <TransactionDetailModal
        txn={selectedTxn ?? null}
        accountName={selectedAccountName}
        onClose={() => setSelectedTxnId(null)}
        onSaved={handleSaved}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, width: '100%' },
  wideContent: { maxWidth: 640, alignSelf: 'center' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  listContainer: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { gap: 10 },
  retryButton: { minWidth: 140 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    flexShrink: 1,
  },
  headerTotals: { flexDirection: 'row', gap: 8 },
});
