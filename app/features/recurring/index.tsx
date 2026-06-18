/**
 * Recurring feature entry point (P7-1, restyled per design-spec screens.md
 * section 6). The More-stack native header carries the "Recurring" title
 * (shell.md 3.2), so the screen draws no second title.
 *
 * Two sub-views behind a segmented control over one GET /recurring read:
 * - Upcoming: bills-due hero + Bills/Income cards, every non-ignored series
 *   sorted by nextExpectedDate with per-currency "due this month" totals and
 *   cadence pills.
 * - Review: detection banner + confirm/ignore cards with optimistic actions,
 *   plus confirmed/ignored sections for changing your mind later.
 *
 * All data access rides the shell (src/api/endpoints.ts + queryKeys.ts); the
 * review mutation optimistically edits the shared cache entry, so the
 * dashboard's UpcomingBillsCard (exported below) updates in the same frame.
 *
 * The detector (sync Lambda) owns series lifecycle; this screen only flips
 * review status. No money arithmetic beyond per-currency integer minor-unit
 * sums (P7-7). Pull-to-refresh preserved.
 */
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../../src/api/queryKeys';
import {
  GoldfinchRefreshControl,
  GoldfinchRefreshMark,
} from '../../src/ui/GoldfinchRefresh';
import { Screen } from '../../src/ui/Screen';
import { ErrorState, LoadingState } from '../../src/ui/States';
import { useTheme } from '../../src/ui/ThemeProvider';
import { FadeRise } from '../../src/ui/motion';
import { useT } from '../../src/i18n';
import { ReviewList } from './components/ReviewList';
import { SegmentedTabs } from './components/SegmentedTabs';
import { UpcomingBillsView } from './components/UpcomingBillsView';
import { useRecurringSeries } from './hooks/useRecurringSeries';

export { UpcomingBillsCard } from './components/UpcomingBillsCard';

type SubViewKey = 'upcoming' | 'review';

export default function RecurringScreen() {
  const theme = useTheme();
  const t = useT();
  const queryClient = useQueryClient();
  const query = useRecurringSeries();
  const [subView, setSubView] = useState<SubViewKey>('upcoming');

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.recurring.all(),
      });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const detectedCount =
    query.data?.items.filter((item) => item.status === 'detected').length ?? 0;

  // Segmented per screens.md 6.1: "Upcoming | Review (N)", N only when > 0.
  const tabs: ReadonlyArray<{ key: SubViewKey; label: string }> = [
    { key: 'upcoming', label: t('Upcoming') },
    {
      key: 'review',
      label:
        detectedCount > 0 ? `${t('Review')} (${detectedCount})` : t('Review'),
    },
  ];

  const body = query.isPending ? (
    <LoadingState />
  ) : query.isError ? (
    <ErrorState
      message="Could not load recurring series."
      onRetry={() => void query.refetch()}
    />
  ) : subView === 'upcoming' ? (
    <UpcomingBillsView items={query.data.items} />
  ) : (
    <ReviewList items={query.data.items} />
  );

  return (
    <Screen padded={false}>
      <View
        style={{
          paddingHorizontal: theme.pad,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.sm,
        }}
      >
        <SegmentedTabs options={tabs} value={subView} onChange={setSubView} />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingHorizontal: theme.pad,
          paddingBottom: theme.spacing.md,
          paddingTop: theme.spacing.sm,
        }}
        refreshControl={
          <GoldfinchRefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
          />
        }
      >
        {/* Screen-level entrance via the shared motion module (PHASE9-
            DECISIONS P9-1: no ad-hoc Animated code in features). */}
        <FadeRise>{body}</FadeRise>
      </ScrollView>
      <GoldfinchRefreshMark active={refreshing} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
});
