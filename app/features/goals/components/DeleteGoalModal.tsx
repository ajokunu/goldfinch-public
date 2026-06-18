/**
 * Delete-with-confirm for goals (P7-2). A modal (not Alert.alert) so the
 * flow is identical on iOS, Android, and web. Spells out what is lost:
 * manual goals take their contribution history with them; linked goals never
 * touch the underlying account.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import type { GoalDto } from '@goldfinch/shared/types';

import { ModalSheet } from '../../../src/ui/ModalSheet';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { useT } from '../../../src/i18n';
import { useDeleteGoal } from '../../../src/api/mutations';
import { errorMessage } from '../lib/errors';
import { Button } from './Buttons';

export interface DeleteGoalModalProps {
  /** The goal queued for deletion; null = closed. */
  goal: GoalDto | null;
  onClose: () => void;
}

export function DeleteGoalModal({ goal, onClose }: DeleteGoalModalProps) {
  const theme = useTheme();
  const t = useT();
  const deleteGoal = useDeleteGoal();
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (goal) setSubmitError(null);
  }, [goal]);

  if (!goal) return null;

  const consequence =
    goal.fundingMode === 'manual'
      ? 'Its contribution history is deleted with it.'
      : 'The linked account is not affected.';

  const handleDelete = () => {
    setSubmitError(null);
    deleteGoal.mutate(goal.goalId, {
      onSuccess: onClose,
      onError: (error) => setSubmitError(errorMessage(error)),
    });
  };

  return (
    <ModalSheet
      visible
      title="Delete goal"
      onClose={onClose}
      footer={
        <>
          <Button
            label={t('Cancel')}
            variant="secondary"
            onPress={onClose}
            disabled={deleteGoal.isPending}
            style={styles.footerButton}
          />
          <Button
            label={`Delete "${goal.name}"`}
            variant="danger"
            onPress={handleDelete}
            loading={deleteGoal.isPending}
            disabled={deleteGoal.isPending}
            style={styles.footerButton}
          />
        </>
      }
    >
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: theme.text.body,
          marginBottom: theme.spacing.sm,
        }}
      >
        This permanently deletes "{goal.name}".
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.caption,
          marginBottom: theme.spacing.md,
        }}
      >
        {consequence}
      </Text>

      {submitError ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: theme.colors.danger,
            fontSize: theme.text.caption,
            marginBottom: theme.spacing.md,
          }}
        >
          {submitError}
        </Text>
      ) : null}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  footerButton: { flex: 1 },
});
