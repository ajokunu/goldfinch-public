/**
 * Rules feature entry point (P7-5: rules engine UI).
 *
 * - List: every rule in true evaluation order (shared compareRulePrecedence:
 *   exact > starts-with > contains, then priority ascending), with a quick
 *   enabled toggle per row.
 * - Editor: matchType / pattern / inclusive amount bounds / category /
 *   priority / enabled, with a LIVE preview computed client-side against
 *   recent transactions through the shared rule matcher.
 * - Apply now: POST /rules/{ruleId}/apply from the editor, surfacing the
 *   server's matched/updated counts.
 * - Delete: two-tap confirm in the editor.
 *
 * All data access rides the shell: src/api/endpoints.ts for fetches,
 * src/api/queryKeys.ts for cache keys, src/api/mutations.ts for writes (their
 * invalidation sets keep transactions/budgets/reports coherent after an
 * apply-now).
 */
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import type { RuleDto } from '@goldfinch/shared/types';

import { Screen } from '../../src/ui/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../src/ui/States';
import { useTheme } from '../../src/ui/ThemeProvider';
import { usePatchRule } from '../../src/api/mutations';
import { errorMessage } from './lib/errors';
import { useRulesQuery } from './hooks/useRulesQuery';
import { useCategoryNames, useCategoryStyleById } from './hooks/useCategories';
import { Button } from './components/Buttons';
import { RuleRow } from './components/RuleRow';
import {
  RuleEditorModal,
  type RuleEditorTarget,
} from './components/RuleEditorModal';

export default function RulesScreen() {
  const theme = useTheme();
  const rulesQuery = useRulesQuery();
  const categoryNames = useCategoryNames();
  const categoryStyles = useCategoryStyleById();
  const patchRule = usePatchRule();

  const [editorTarget, setEditorTarget] = useState<RuleEditorTarget | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const handleToggleEnabled = (rule: RuleDto, enabled: boolean) => {
    setToggleError(null);
    setTogglingId(rule.ruleId);
    patchRule.mutate(
      { ruleId: rule.ruleId, body: { enabled, version: rule.version } },
      {
        // The hook invalidates the rules cache on success AND error, so the
        // list converges to the server's state either way.
        onError: (error) => setToggleError(errorMessage(error)),
        onSettled: () =>
          setTogglingId((current) => (current === rule.ruleId ? null : current)),
      },
    );
  };

  const header = (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.caption,
          marginBottom: theme.spacing.md,
        }}
      >
        Rules categorize incoming transactions automatically during the daily
        sync. They run in the order shown: exact matches first, then
        starts-with, then contains; within a group, lower priority numbers run
        first.
      </Text>
      <Button label="New rule" onPress={() => setEditorTarget({})} />
      {toggleError ? (
        <Text
          style={{
            color: theme.colors.danger,
            fontSize: theme.text.caption,
            marginTop: theme.spacing.sm,
          }}
        >
          {toggleError}
        </Text>
      ) : null}
    </View>
  );

  return (
    <Screen padded={false}>
      {rulesQuery.isPending ? (
        <LoadingState />
      ) : rulesQuery.isError ? (
        <ErrorState
          message="Could not load rules."
          onRetry={() => void rulesQuery.refetch()}
        />
      ) : (
        <FlatList
          data={rulesQuery.data}
          keyExtractor={(rule) => rule.ruleId}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState
              title="No rules yet"
              body="Create a rule to categorize matching transactions automatically, then apply it to past uncategorized ones."
            />
          }
          renderItem={({ item }) => (
            <RuleRow
              rule={item}
              categoryName={
                categoryNames.get(item.categoryId) ?? item.categoryId
              }
              categoryIconKey={categoryStyles.get(item.categoryId)?.iconKey}
              categoryColorKey={categoryStyles.get(item.categoryId)?.color}
              onPress={() => setEditorTarget({ rule: item })}
              onToggleEnabled={(enabled) => handleToggleEnabled(item, enabled)}
              toggling={togglingId === item.ruleId}
            />
          )}
          contentContainerStyle={{
            paddingHorizontal: theme.spacing.md,
            paddingTop: theme.spacing.md,
            paddingBottom: theme.spacing.xl,
          }}
        />
      )}

      <RuleEditorModal
        target={editorTarget}
        onClose={() => setEditorTarget(null)}
      />
    </Screen>
  );
}
