/**
 * Budget editor sheet (design spec screens.md 3.6): category head block,
 * "Monthly limit" eyebrow over a hero mono amount input, preset chips
 * (integer minor math, deduped), the rollover panel, and a pinned
 * Cancel / Save budget footer.
 *
 * Money discipline unchanged: the limit is a decimal string end to end
 * (parseAmountInput; never a float). Editing carries the item version for the
 * API's optimistic lock; VERSION_CONFLICT / ALREADY_EXISTS surface through
 * lib/errors.ts exactly as before. The prototype's slider is NOT integrated
 * (no slider dependency is installed and installs are forbidden); the preset
 * chips and direct entry cover the same adjustments.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { BudgetDto, BudgetPeriod, CurrencyCode } from '@goldfinch/shared/types';
import { minorUnitDigits } from '@goldfinch/shared/money';

import {
  periodLimitLabel,
  periodPickerLabel,
  spentThisMonth,
  useLang,
  useT,
} from '../../../src/i18n';
import { formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { formatDecimalAmount } from '../../../src/ui/Money';
import { useMaskMoney } from '../../../src/state/uiStore';
import { CategoryIcon } from '../../../src/ui/icons';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { minorToDecimalString, parseAmountInput, presetLimitsMinor } from '../lib/amounts';
import { colorForCategory } from '../lib/colors';
import { errorMessage } from '../lib/errors';
import {
  useCreateBudget,
  useDeleteBudget,
  usePatchBudget,
} from '../hooks/useBudgetMutations';
import {
  BUDGET_PERIOD_KEYS,
  BUDGET_PERIOD_ORDER,
  DEFAULT_BUDGET_PERIOD,
} from '../lib/periods';
import { Button } from './Buttons';
import { SegmentedTabs } from './SegmentedTabs';
import { ModalSheet } from '../../../src/ui/ModalSheet';

export interface BudgetEditorTarget {
  categoryId: string;
  categoryName: string;
  /** Present when editing an existing budget; absent when creating. */
  budget?: BudgetDto;
  /** Display currency (presentation only; from the cashflow read). */
  currency?: CurrencyCode;
  /**
   * Cadence to preselect when CREATING (P11-4): the envelope view seeds this
   * from the active Week/Month/Year tab so "New budget" on the Week tab opens
   * a weekly draft. Ignored when editing (the stored period wins). Default
   * Month if absent.
   */
  initialPeriod?: BudgetPeriod;
}

export interface BudgetEditorModalProps {
  target: BudgetEditorTarget | null;
  onClose: () => void;
}

export function BudgetEditorModal({ target, onClose }: BudgetEditorModalProps) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  // The "spent this month" caption and the preset limit chips both expose
  // real figures (presets derive from the current limit / actual spend), so
  // privacy mode masks them. The limit input itself stays editable.
  const { mask } = useMaskMoney();
  const createBudget = useCreateBudget();
  const patchBudget = usePatchBudget();
  const deleteBudget = useDeleteBudget();

  const [limitText, setLimitText] = useState('');
  const [rollover, setRollover] = useState(false);
  const [period, setPeriod] = useState<BudgetPeriod>(DEFAULT_BUDGET_PERIOD);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Re-seed local form state each time the modal opens for a target. Editing
  // takes the budget's stored cadence; creating takes the tab's seed (P11-4)
  // and otherwise defaults to Month.
  useEffect(() => {
    if (!target) return;
    setLimitText(target.budget ? target.budget.limit : '');
    setRollover(target.budget?.rollover ?? false);
    setPeriod(
      target.budget?.period ?? target.initialPeriod ?? DEFAULT_BUDGET_PERIOD,
    );
    setFieldError(null);
    setSubmitError(null);
    setConfirmingDelete(false);
  }, [target]);

  const currency: CurrencyCode = target?.currency ?? 'USD';
  const digits = minorUnitDigits(currency);

  const presets = useMemo(() => {
    if (!target) return [];
    return presetLimitsMinor({
      ...(target.budget !== undefined
        ? {
            currentLimitMinor: target.budget.limitMinor,
            spentMinor: target.budget.spentMinor,
          }
        : {}),
      digits,
    });
  }, [target, digits]);

  if (!target) return null;
  const isEdit = target.budget !== undefined;
  const busy =
    createBudget.isPending || patchBudget.isPending || deleteBudget.isPending;

  // Period picker options (P11-4), from the single period source so the editor,
  // the filter tabs, and the row caption all name a cadence identically.
  const periodOptions = BUDGET_PERIOD_ORDER.map((value) => ({
    key: value,
    label: t(BUDGET_PERIOD_KEYS[value]),
  }));

  const handleSave = () => {
    const limit = parseAmountInput(limitText);
    if (limit === null || limit === '0.00') {
      setFieldError('Enter a positive amount, like 250 or 250.50.');
      return;
    }
    setFieldError(null);
    setSubmitError(null);

    if (isEdit && target.budget) {
      // Always send the (seeded-from-stored) period so an edit preserves the
      // budget's cadence, and a deliberate change re-windows the spend (P11-4).
      patchBudget.mutate(
        {
          categoryId: target.categoryId,
          body: { limit, rollover, period, version: target.budget.version },
        },
        {
          onSuccess: onClose,
          onError: (error) => setSubmitError(errorMessage(error)),
        },
      );
    } else {
      createBudget.mutate(
        { categoryId: target.categoryId, limit, rollover, period },
        {
          onSuccess: onClose,
          onError: (error) => setSubmitError(errorMessage(error)),
        },
      );
    }
  };

  const handleDelete = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setSubmitError(null);
    deleteBudget.mutate(target.categoryId, {
      onSuccess: onClose,
      onError: (error) => setSubmitError(errorMessage(error)),
    });
  };

  const categoryTint = colorForCategory(target.categoryId, theme);
  const parsedLimit = parseAmountInput(limitText);
  const limitTextSelected = (preset: number) =>
    parsedLimit !== null && parsedLimit === parseAmountInput(minorToDecimalString(preset, digits));

  return (
    <ModalSheet
      visible
      title={isEdit ? t('Edit budget') : t('Budget')}
      onClose={onClose}
      footer={
        <>
          <Button
            label={t('Cancel')}
            variant="secondary"
            onPress={onClose}
            disabled={busy}
            style={styles.footerButton}
          />
          <Button
            label={t('Save budget')}
            onPress={handleSave}
            loading={createBudget.isPending || patchBudget.isPending}
            disabled={busy}
            style={styles.footerButton}
          />
        </>
      }
    >
      {/* Head block: category identity well + name + spent-this-month line. */}
      <View style={[styles.headRow, { marginBottom: theme.spacing.md }]}>
        <CategoryIcon
          categoryId={target.categoryId}
          categoryName={target.categoryName}
          color={categoryTint}
          size={40}
        />
        <View style={styles.headText}>
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.textPrimary,
              fontSize: 16,
              fontFamily: theme.fonts.sansSet.bold,
            }}
          >
            {target.categoryName}
          </Text>
          {isEdit && target.budget ? (
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: 12.5,
                fontFamily: theme.fonts.sans,
                marginTop: 2,
              }}
            >
              {spentThisMonth(
                lang,
                mask(formatDecimalAmount(target.budget.spent, currency)),
              )}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Limit eyebrow + hero mono amount input (the prototype's slider is
          replaced by direct entry + preset chips). The eyebrow is cadence-
          qualified (P11-4): "Weekly / Monthly / Yearly limit". */}
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: 11,
          fontFamily: theme.fonts.sansSet.bold,
          textTransform: 'uppercase',
          letterSpacing: 1.1,
          marginBottom: 6,
        }}
      >
        {periodLimitLabel(lang, period)}
      </Text>
      <TextInput
        value={limitText}
        onChangeText={setLimitText}
        placeholder="0.00"
        placeholderTextColor={theme.colors.textFaint}
        keyboardType="decimal-pad"
        autoFocus
        accessibilityLabel={periodLimitLabel(lang, period)}
        style={[
          styles.heroInput,
          {
            color: theme.colors.textPrimary,
            fontFamily: theme.fonts.monoSet.bold,
            backgroundColor: theme.colors.surfaceAlt,
            borderColor: fieldError ? theme.colors.danger : 'transparent',
            borderRadius: theme.radius.control,
          },
        ]}
      />
      {fieldError ? (
        <Text
          style={{
            color: theme.colors.danger,
            fontSize: 12,
            fontFamily: theme.fonts.sans,
            marginTop: 6,
          }}
        >
          {fieldError}
        </Text>
      ) : null}

      {presets.length > 0 ? (
        <View style={[styles.chips, { marginTop: theme.spacing.sm }]}>
          {presets.map((preset) => {
            const selected = limitTextSelected(preset);
            return (
              <Pressable
                key={preset}
                onPress={() => setLimitText(minorToDecimalString(preset, digits))}
                accessibilityRole="button"
                // Presets are derived from the current limit / actual spend
                // (presetLimitsMinor), so they can expose real figures; mask
                // the label under privacy mode. The tap still sets the raw
                // preset value, so masking does not break selection.
                accessibilityLabel={mask(formatMinorAmount(preset, currency))}
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  backgroundColor: selected
                    ? theme.colors.accent
                    : theme.colors.surfaceAlt,
                  borderRadius: theme.radius.chip,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text
                  style={{
                    color: selected
                      ? theme.colors.onAccent
                      : theme.colors.textPrimary,
                    fontSize: 12.5,
                    fontFamily: theme.fonts.monoSet.medium,
                  }}
                >
                  {mask(formatMinorAmount(preset, currency))}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Period picker (P11-4): the cadence this limit applies to. Default
          Month; reuses the shared SegmentedTabs (no bespoke control). */}
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: 11,
          fontFamily: theme.fonts.sansSet.bold,
          textTransform: 'uppercase',
          letterSpacing: 1.1,
          marginTop: theme.spacing.md,
          marginBottom: 6,
        }}
      >
        {periodPickerLabel(lang)}
      </Text>
      <SegmentedTabs options={periodOptions} value={period} onChange={setPeriod} />

      {/* Rollover panel. */}
      <View
        style={[
          styles.rolloverRow,
          {
            backgroundColor: theme.colors.surfaceAlt,
            borderRadius: theme.radius.control,
            marginTop: theme.spacing.md,
            marginBottom: theme.spacing.md,
          },
        ]}
      >
        <View style={styles.rolloverText}>
          <Text
            style={{
              color: theme.colors.textPrimary,
              fontSize: 14,
              fontFamily: theme.fonts.sansSet.semibold,
            }}
          >
            {t('Roll over leftovers')}
          </Text>
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: 12,
              fontFamily: theme.fonts.sans,
              marginTop: 2,
            }}
          >
            {t('Unspent funds carry to next month')}
          </Text>
        </View>
        <Switch
          value={rollover}
          onValueChange={setRollover}
          trackColor={{ true: theme.colors.accent }}
          accessibilityLabel={t('Roll over leftovers')}
        />
      </View>

      {submitError ? (
        <Text
          style={{
            color: theme.colors.danger,
            fontSize: 12.5,
            fontFamily: theme.fonts.sans,
            marginBottom: theme.spacing.md,
          }}
        >
          {submitError}
        </Text>
      ) : null}

      {isEdit ? (
        <View style={{ marginBottom: theme.spacing.sm }}>
          <Button
            label={confirmingDelete ? 'Confirm: remove budget' : 'Remove budget'}
            variant="danger"
            onPress={handleDelete}
            loading={deleteBudget.isPending}
            disabled={busy && !deleteBudget.isPending}
          />
        </View>
      ) : null}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  footerButton: { flex: 1 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headText: { flex: 1, minWidth: 0 },
  heroInput: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 32,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rolloverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  rolloverText: { flex: 1, minWidth: 0 },
});
