/**
 * Goals screen (P7-2, restyled per design-spec screens.md section 5):
 * savings goals with progress rings and projected-completion dates,
 * create/edit (linked-account or manual funding), contribution recording,
 * and delete-with-confirm.
 *
 * Layout: Plus icon-pill toolbar (the More-stack native header carries the
 * "Goals" title, shell.md 3.2, so the screen draws no second title), the
 * total-saved hero card (the goal-count caption lives there now), then one
 * goal card per GoalDto -- FadeRise cascade from the shared motion module
 * (PHASE9-DECISIONS P9-2 item 1; reduced-motion and kill-switch aware).
 *
 * Data: GET /goals via useGoalsQuery (server-computed progress and percent);
 * accounts are loaded independently only to label linked goals and feed the
 * picker -- an accounts failure degrades labels, never blocks the list.
 * Writes go through the shared mutation hooks in src/api/mutations.ts, whose
 * invalidation sets refresh this screen.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Plus, Target } from 'lucide-react-native';
import type { GoalDto } from '@goldfinch/shared/types';

import { IconButton } from '../../src/ui/IconButton';
import { Screen } from '../../src/ui/Screen';
import { ErrorState, LoadingState } from '../../src/ui/States';
import { useTheme } from '../../src/ui/ThemeProvider';
import { withAlpha } from '../../src/ui/mixColor';
import { FadeRise, stagger, staggerChildDelayMs } from '../../src/ui/motion';
import { useT } from '../../src/i18n';
import { toIsoDate } from '../../src/lib/dates';
import { useAccountsQuery, useGoalsQuery } from './hooks/useGoalsQueries';
import { Button } from './components/Buttons';
import { ContributionModal } from './components/ContributionModal';
import { DeleteGoalModal } from './components/DeleteGoalModal';
import { GoalCard } from './components/GoalCard';
import { GoalEditorModal, type GoalEditorTarget } from './components/GoalEditorModal';
import { TotalSavedCard } from './components/TotalSavedCard';

/** Designed empty state (screens.md 5.4): icon tile + copy + primary CTA. */
function GoalsEmptyState({ onCreate }: { onCreate: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={[styles.empty, { paddingVertical: 36 }]}>
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
        <Target size={22} color={theme.colors.accent} strokeWidth={2.1} />
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
        No goals yet
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
        Create a savings goal to track progress toward a target -- linked to an
        account balance or funded by manual contributions.
      </Text>
      <View style={{ marginTop: 16 }}>
        <Button label={t('New goal')} onPress={onCreate} />
      </View>
    </View>
  );
}

export default function GoalsScreen() {
  const t = useT();
  const goalsQuery = useGoalsQuery();
  const accountsQuery = useAccountsQuery();

  const [editorTarget, setEditorTarget] = useState<GoalEditorTarget | null>(null);
  const [contributionGoal, setContributionGoal] = useState<GoalDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GoalDto | null>(null);

  // Pinned per mount: projections shift only at local midnight, and the next
  // mount/focus refetch picks the new day up.
  const today = useMemo(() => toIsoDate(new Date()), []);

  const accountNamesById = useMemo(() => {
    const names = new Map<string, string>();
    for (const account of accountsQuery.data?.items ?? []) {
      names.set(account.accountId, account.name);
    }
    return names;
  }, [accountsQuery.data]);

  const goals = goalsQuery.data?.items ?? [];

  return (
    <Screen scroll>
      <View style={styles.toolbar}>
        <IconButton
          icon={Plus}
          variant="pill"
          onPress={() => setEditorTarget({})}
          accessibilityLabel={t('New goal')}
        />
      </View>

      {goalsQuery.isPending ? (
        <LoadingState />
      ) : goalsQuery.isError ? (
        <ErrorState
          message="Could not load goals."
          onRetry={() => void goalsQuery.refetch()}
        />
      ) : goals.length === 0 ? (
        <GoalsEmptyState onCreate={() => setEditorTarget({})} />
      ) : (
        <View style={styles.stack}>
          {/* Hero-then-cards cascade (PHASE9-DECISIONS P9-2 item 1) via the
              motion module's FadeRise -- no ad-hoc Animated code (P9-1). */}
          <FadeRise>
            <TotalSavedCard goals={goals} />
          </FadeRise>
          {goals.map((goal, position) => (
            <FadeRise
              key={goal.goalId}
              delay={staggerChildDelayMs(position + 1, stagger.cascadeMs)}
            >
              <GoalCard
                goal={goal}
                accountName={
                  goal.linkedAccountId
                    ? accountNamesById.get(goal.linkedAccountId)
                    : undefined
                }
                today={today}
                onEdit={(g) => setEditorTarget({ goal: g })}
                onContribute={setContributionGoal}
                onDelete={setDeleteTarget}
              />
            </FadeRise>
          ))}
        </View>
      )}

      <GoalEditorModal target={editorTarget} onClose={() => setEditorTarget(null)} />
      <ContributionModal
        goal={contributionGoal}
        onClose={() => setContributionGoal(null)}
      />
      <DeleteGoalModal goal={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 14,
  },
  stack: { gap: 14 },
  empty: { alignItems: 'center', justifyContent: 'center' },
});
