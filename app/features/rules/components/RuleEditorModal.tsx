/**
 * Create / edit a categorization rule (P7-5): matchType segmented control,
 * payee pattern, optional inclusive amount bounds (absolute value, decimal
 * strings -- never floats), category assignment, priority, enabled switch,
 * with a live preview against recent transactions and the apply-now /
 * delete actions for existing rules.
 *
 * Editing carries the item version for the API's optimistic lock; a
 * VERSION_CONFLICT triggers a refetch (wired in the shared mutation hooks)
 * and an inline explanation. Delete uses the two-tap confirm pattern
 * (Alert.alert is unreliable on web).
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import type { RuleDto } from '@goldfinch/shared/types';

import { ModalSheet } from '../../../src/ui/ModalSheet';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  useApplyRule,
  useCreateRule,
  useDeleteRule,
  usePatchRule,
} from '../../../src/api/mutations';
import { errorMessage } from '../lib/errors';
import {
  MATCH_TYPE_LABELS,
  emptyRuleForm,
  ruleFormFromDto,
  toCreateRequest,
  toPatchRequest,
  validateRuleForm,
  type RuleFormErrors,
  type RuleFormState,
} from '../lib/form';
import { useCategoryNames } from '../hooks/useCategories';
import { Button } from './Buttons';
import { CategoryPickerModal } from './CategoryPickerModal';
import { FormField } from './FormField';
import { RulePreview } from './RulePreview';
import { SegmentedTabs } from './SegmentedTabs';

const MATCH_TYPE_OPTIONS = (
  ['exact', 'prefix', 'contains'] as const
).map((key) => ({ key, label: MATCH_TYPE_LABELS[key] }));

export interface RuleEditorTarget {
  /** Present when editing an existing rule; absent when creating. */
  rule?: RuleDto;
}

export interface RuleEditorModalProps {
  target: RuleEditorTarget | null;
  onClose: () => void;
}

export function RuleEditorModal({ target, onClose }: RuleEditorModalProps) {
  const theme = useTheme();
  const categoryNames = useCategoryNames();
  const createRule = useCreateRule();
  const patchRule = usePatchRule();
  const deleteRule = useDeleteRule();
  const applyRule = useApplyRule();

  const [form, setForm] = useState<RuleFormState>(emptyRuleForm);
  const [errors, setErrors] = useState<RuleFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  // Re-seed local form state each time the modal opens for a target.
  useEffect(() => {
    if (!target) return;
    setForm(target.rule ? ruleFormFromDto(target.rule) : emptyRuleForm());
    setErrors({});
    setSubmitError(null);
    setApplyResult(null);
    setConfirmingDelete(false);
    setCategoryPickerOpen(false);
  }, [target]);

  const rule = target?.rule;
  const isEdit = rule !== undefined;
  const busy =
    createRule.isPending ||
    patchRule.isPending ||
    deleteRule.isPending ||
    applyRule.isPending;

  const categoryLabel = useMemo(() => {
    if (!form.categoryId) return null;
    return categoryNames.get(form.categoryId) ?? form.categoryId;
  }, [form.categoryId, categoryNames]);

  if (!target) return null;

  const update = (patch: Partial<RuleFormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  const handleSave = () => {
    const validation = validateRuleForm(form);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    setErrors({});
    setSubmitError(null);

    if (isEdit && rule) {
      patchRule.mutate(
        { ruleId: rule.ruleId, body: toPatchRequest(validation.value, rule.version) },
        {
          onSuccess: onClose,
          onError: (error) => setSubmitError(errorMessage(error)),
        },
      );
    } else {
      createRule.mutate(toCreateRequest(validation.value), {
        onSuccess: onClose,
        onError: (error) => setSubmitError(errorMessage(error)),
      });
    }
  };

  const handleApply = () => {
    if (!rule) return;
    setSubmitError(null);
    setApplyResult(null);
    applyRule.mutate(
      { ruleId: rule.ruleId },
      {
        onSuccess: (result) =>
          setApplyResult(
            `Matched ${result.matchedCount} transaction${
              result.matchedCount === 1 ? '' : 's'
            } in the last year; recategorized ${result.updatedCount}.`,
          ),
        onError: (error) => setSubmitError(errorMessage(error)),
      },
    );
  };

  const handleDelete = () => {
    if (!rule) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setSubmitError(null);
    deleteRule.mutate(rule.ruleId, {
      onSuccess: onClose,
      onError: (error) => setSubmitError(errorMessage(error)),
    });
  };

  return (
    <ModalSheet
      visible
      title={isEdit ? 'Edit rule' : 'New rule'}
      onClose={onClose}
    >
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.caption,
          fontWeight: '600',
          marginBottom: theme.spacing.xs,
        }}
      >
        Payee match
      </Text>
      <SegmentedTabs
        options={MATCH_TYPE_OPTIONS}
        value={form.matchType}
        onChange={(matchType) => update({ matchType })}
      />
      <View style={{ marginTop: theme.spacing.md }}>
        <FormField
          label="Pattern"
          value={form.pattern}
          onChangeText={(pattern) => update({ pattern })}
          placeholder="e.g. starbucks"
          autoCapitalize="none"
          autoCorrect={false}
          error={errors.pattern}
        />
      </View>

      <View style={[styles.boundsRow, { gap: theme.spacing.sm }]}>
        <View style={styles.boundsField}>
          <FormField
            label="Min amount (optional)"
            value={form.amountMinText}
            onChangeText={(amountMinText) => update({ amountMinText })}
            placeholder="0.00"
            keyboardType="decimal-pad"
            error={errors.amountMin}
          />
        </View>
        <View style={styles.boundsField}>
          <FormField
            label="Max amount (optional)"
            value={form.amountMaxText}
            onChangeText={(amountMaxText) => update({ amountMaxText })}
            placeholder="0.00"
            keyboardType="decimal-pad"
            error={errors.amountMax}
          />
        </View>
      </View>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.caption,
          marginTop: -theme.spacing.sm,
          marginBottom: theme.spacing.md,
        }}
      >
        Inclusive bounds on the transaction amount, ignoring sign: a 10 to 20
        rule matches a 15.00 charge and a 15.00 refund alike.
      </Text>

      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.caption,
          fontWeight: '600',
          marginBottom: theme.spacing.xs,
        }}
      >
        Assign category
      </Text>
      <Button
        label={categoryLabel ?? 'Choose category'}
        variant="secondary"
        onPress={() => setCategoryPickerOpen(true)}
        disabled={busy}
      />
      {errors.category ? (
        <Text
          style={{
            color: theme.colors.danger,
            fontSize: theme.text.caption,
            marginTop: theme.spacing.xs,
          }}
        >
          {errors.category}
        </Text>
      ) : null}

      <View style={{ marginTop: theme.spacing.md }}>
        <FormField
          label="Priority"
          value={form.priorityText}
          onChangeText={(priorityText) => update({ priorityText })}
          placeholder="100"
          keyboardType="number-pad"
          error={errors.priority}
        />
      </View>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.caption,
          marginTop: -theme.spacing.sm,
          marginBottom: theme.spacing.md,
        }}
      >
        Lower numbers run first within the same match type; exact always beats
        starts-with, which beats contains.
      </Text>

      <View style={[styles.switchRow, { marginBottom: theme.spacing.md }]}>
        <View style={styles.switchLabelWrap}>
          <Text
            style={{
              color: theme.colors.textPrimary,
              fontSize: theme.text.body,
              fontWeight: '600',
            }}
          >
            Enabled
          </Text>
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: theme.text.caption,
              marginTop: theme.spacing.xs,
            }}
          >
            Disabled rules never match; they keep their place in the order.
          </Text>
        </View>
        <Switch
          value={form.enabled}
          onValueChange={(enabled) => update({ enabled })}
          trackColor={{ true: theme.colors.accent }}
          accessibilityLabel="Rule enabled"
        />
      </View>

      <RulePreview form={form} editingRuleId={rule?.ruleId ?? null} />

      {submitError ? (
        <Text
          style={{
            color: theme.colors.danger,
            fontSize: theme.text.caption,
            marginBottom: theme.spacing.md,
          }}
        >
          {submitError}
        </Text>
      ) : null}

      <Button
        label={isEdit ? 'Save changes' : 'Create rule'}
        onPress={handleSave}
        loading={createRule.isPending || patchRule.isPending}
        disabled={busy && !(createRule.isPending || patchRule.isPending)}
      />

      {isEdit && rule ? (
        <View style={{ marginTop: theme.spacing.sm }}>
          <Button
            label="Apply now to past transactions"
            variant="secondary"
            onPress={handleApply}
            loading={applyRule.isPending}
            disabled={(busy && !applyRule.isPending) || !rule.enabled}
          />
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: theme.text.caption,
              marginTop: theme.spacing.xs,
            }}
          >
            {rule.enabled
              ? 'Runs the saved rule over the last year of uncategorized transactions on the server. Save your edits first if you changed anything above.'
              : 'The saved rule is disabled; enable it and save before applying.'}
          </Text>
          {applyResult ? (
            <Text
              style={{
                color: theme.colors.positive,
                fontSize: theme.text.caption,
                fontWeight: '600',
                marginTop: theme.spacing.xs,
              }}
            >
              {applyResult}
            </Text>
          ) : null}

          <View style={{ marginTop: theme.spacing.md }}>
            <Button
              label={confirmingDelete ? 'Confirm: delete rule' : 'Delete rule'}
              variant="danger"
              onPress={handleDelete}
              loading={deleteRule.isPending}
              disabled={busy && !deleteRule.isPending}
            />
          </View>
        </View>
      ) : null}

      <CategoryPickerModal
        visible={categoryPickerOpen}
        currentCategoryId={form.categoryId}
        onSelect={(category) => {
          update({ categoryId: category.categoryId });
          setCategoryPickerOpen(false);
        }}
        onClose={() => setCategoryPickerOpen(false)}
      />
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  boundsRow: { flexDirection: 'row' },
  boundsField: { flex: 1 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabelWrap: { flex: 1, paddingRight: 12 },
});
