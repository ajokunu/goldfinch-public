/**
 * Dashboard feature entry point (master plan section 13; restyled per
 * ops/design-spec/screens.md section 1).
 *
 * Independent TanStack Query reads -- GET /summary, GET /accounts, recent
 * GET /transactions, plus the cross-feature GET /networth/history and
 * GET /reports/flow consumed inside the hero and spending cards -- each with
 * its own loading/empty/error state so one slow or failed call degrades only
 * its card. Net worth, asset/liability classification, and grouping are all
 * server-computed; the client renders decimal strings / integer minor units
 * and never does money arithmetic (R16). The only write path is the
 * screen-hosted transactions detail sheet opened from recent-activity rows
 * (the existing categorize/note mutations, unchanged).
 *
 * Layout (1.1): header row, net-worth hero, "{Month} spending" donut,
 * accounts (Bank/Type toggle), upcoming bills, recent activity -- greeting
 * FadeRises first, cards cascade at 45ms (PHASE9-DECISIONS P9-2 item 1),
 * density-padded scroll.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Inbox, Landmark, Sparkles } from 'lucide-react-native';

import { queryKeys } from '../../src/api/queryKeys';
import { categorizedAs, useLang, useT } from '../../src/i18n';
import { Segmented } from '../../src/ui/Segmented';
import {
  GoldfinchRefreshControl,
  GoldfinchRefreshMark,
} from '../../src/ui/GoldfinchRefresh';
import { FadeRise, stagger, staggerChildDelayMs } from '../../src/ui/motion';
import { Screen } from '../../src/ui/Screen';
import { useTheme } from '../../src/ui/ThemeProvider';
import { UpcomingBillsCard } from '../recurring/components/UpcomingBillsCard';
import { Toast, type ToastData } from '../transactions/components/Toast';
import {
  TransactionDetailModal,
  type DetailSaveResult,
} from '../transactions/components/TransactionDetailModal';
import { AccountGroups } from './components/AccountGroups';
import { DashboardHeader } from './components/DashboardHeader';
import { NetWorthCard } from './components/NetWorthCard';
import { RecentTransactions } from './components/RecentTransactions';
import { CardSkeleton } from './components/Skeleton';
import { SpendingCard } from './components/SpendingCard';
import { EmptyState, ErrorState } from './components/States';
import {
  DEFAULT_PERIOD_SCOPE,
  useAccounts,
  useRecentTransactions,
  useSummary,
  type PeriodScope,
} from './hooks';

export default function DashboardScreen() {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  const queryClient = useQueryClient();

  // Spending/recent scope (P11-5): This Week / This Month, default This Month
  // (current behavior). Re-scopes the recent slice + the spending figure via
  // the shared periodWindow; no new screens.
  const [scope, setScope] = useState<PeriodScope>(DEFAULT_PERIOD_SCOPE);
  const scopeOptions: ReadonlyArray<{ key: PeriodScope; label: string }> = [
    { key: 'weekly', label: t('This week') },
    { key: 'monthly', label: t('This month') },
  ];

  const summaryQuery = useSummary();
  const accountsQuery = useAccounts();
  const recentQuery = useRecentTransactions(scope);

  // Screen-hosted transaction detail sheet + confirmation toast (screens.md
  // 1.7 / 2.5): the selected item is re-resolved from the live query cache on
  // every render so optimistic categorize updates (and 409 rollbacks) are
  // visible inside the open sheet.
  const [selectedTxnId, setSelectedTxnId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
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
        // logged with context inside the detail sheet).
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

  // Pull-to-refresh invalidates every read this screen renders through the
  // shared key factory (now including the cross-feature history/flow reads
  // behind the hero and spending cards) and resolves when the active
  // refetches settle.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.summary() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all() }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.netWorthHistory.all(),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reports.all() }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  // Sync-advance invalidation (section 13 task 12): summary.asOf is
  // max(balance-date) across accounts, so when a focus refetch of /summary
  // reports a newer asOf than last seen, the daily sync has landed new data --
  // invalidate the dependent reads so every card catches up.
  const lastSeenAsOf = useRef<number | null>(null);
  const asOf = summaryQuery.data?.asOf;
  useEffect(() => {
    if (asOf === undefined) return;
    if (lastSeenAsOf.current !== null && asOf > lastSeenAsOf.current) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.transactions.all(),
      });
      // Recurring detection runs inside the same sync Lambda (P7-1).
      void queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all() });
      // Snapshots and flow aggregates land with the same sync.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.netWorthHistory.all(),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all() });
    }
    lastSeenAsOf.current = asOf;
  }, [asOf, queryClient]);

  // Account-name lookup for transaction rows whose DTO lacks accountName.
  const accountNameFor = useCallback(
    (accountId: string): string | undefined =>
      accountsQuery.data?.items.find((item) => item.accountId === accountId)
        ?.name,
    [accountsQuery.data],
  );

  // The accounts read is authoritative for "no accounts connected yet";
  // summary groups would be empty in that case too.
  const hasNoAccounts =
    accountsQuery.isSuccess && accountsQuery.data.items.length === 0;

  const summaryEmpty =
    hasNoAccounts ||
    (summaryQuery.isSuccess && summaryQuery.data.byType.length === 0);

  const netWorthSection = summaryQuery.isPending ? (
    <CardSkeleton headline rows={2} />
  ) : summaryQuery.isError ? (
    <ErrorState
      title="Could not load your summary"
      onRetry={() => void summaryQuery.refetch()}
    />
  ) : summaryEmpty ? (
    <EmptyState
      icon={Landmark}
      title="Connect your first account"
      message="Link your bank through SimpleFIN in Settings, then your balances will appear here after the next sync."
    />
  ) : (
    <NetWorthCard summary={summaryQuery.data} />
  );

  // The accounts card shares the summary read: its skeleton mirrors the hero
  // while pending, and the error/empty cases render once (above) rather than
  // duplicating the same failure twice on screen.
  const accountsSection = summaryQuery.isPending ? (
    <CardSkeleton rows={4} />
  ) : summaryQuery.isSuccess && !summaryEmpty ? (
    <AccountGroups summary={summaryQuery.data} />
  ) : null;

  const recentSection = recentQuery.isPending ? (
    <CardSkeleton rows={4} />
  ) : recentQuery.isError ? (
    <ErrorState
      title="Could not load recent activity"
      onRetry={() => void recentQuery.refetch()}
    />
  ) : recentQuery.data.items.length === 0 ? (
    <EmptyState
      icon={Inbox}
      title="No transactions yet"
      message="Recent activity from your linked accounts will show up here."
    />
  ) : (
    <RecentTransactions
      transactions={recentQuery.data.items}
      accountNameFor={accountNameFor}
      onPressTransaction={setSelectedTxnId}
    />
  );

  const selectedTxn =
    selectedTxnId === null
      ? null
      : (recentQuery.data?.items.find((txn) => txn.txnId === selectedTxnId) ??
        null);

  // Stable keys so a section that disappears (accounts on the shared summary
  // error/empty path) never re-keys its neighbors and replays their entrance.
  // Spending region (P11-5): the period toggle scopes both the spending figure
  // and the recent-activity slice. A single Segmented control drives `scope`;
  // the card switches between the monthly flow donut and the weekly figure.
  const spendingSection = (
    <View style={styles.spendingRegion}>
      <Segmented
        options={scopeOptions}
        value={scope}
        onChange={setScope}
        small
      />
      <SpendingCard scope={scope} />
    </View>
  );

  const sections = [
    { key: 'networth', node: netWorthSection },
    { key: 'spending', node: spendingSection },
    { key: 'accounts', node: accountsSection },
    { key: 'bills', node: <UpcomingBillsCard /> },
    { key: 'recent', node: recentSection },
  ].filter(
    (section): section is { key: string; node: ReactElement } =>
      section.node !== null,
  );

  return (
    <Screen padded={false}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingHorizontal: theme.density.pad,
          paddingVertical: theme.spacing.md,
          gap: 14,
        }}
        refreshControl={
          <GoldfinchRefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
          />
        }
      >
        {/* App-open cascade (PHASE9-DECISIONS P9-2 item 1): the greeting
            FadeRises first, then the cards follow at the 45ms cascade
            interval. Each section stays a DIRECT ScrollView child (its own
            FadeRise rather than one Stagger wrapper) so the container's
            gap spacing keeps applying between cards; the entrance is
            mount-only, so a section that disappears later never replays
            its neighbors. */}
        <FadeRise testID="dash-greeting-entrance">
          <DashboardHeader />
        </FadeRise>
        {sections.map((section, index) => (
          <FadeRise
            key={section.key}
            delay={staggerChildDelayMs(index + 1, stagger.cascadeMs)}
          >
            {section.node}
          </FadeRise>
        ))}
      </ScrollView>
      <GoldfinchRefreshMark active={refreshing} />
      <TransactionDetailModal
        txn={selectedTxn}
        accountName={
          selectedTxn === null
            ? ''
            : (selectedTxn.accountName ??
              accountNameFor(selectedTxn.accountId) ??
              '')
        }
        onClose={() => setSelectedTxnId(null)}
        onSaved={handleSaved}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  spendingRegion: { gap: 12 },
});
