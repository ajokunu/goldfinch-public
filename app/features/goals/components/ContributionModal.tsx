/**
 * Contribution sheet (design-spec screens.md 5.4): centered ring previewing
 * the PROJECTED percent (current progress + the entered amount, integer minor
 * math), a "{current} → {new} / {target}" mono caption, the "Contribution"
 * eyebrow, a 42px hero readout of the entered amount in the goal's color,
 * preset chips (50/100/250/500 + "Finish · {remaining}" when a positive
 * remainder exists), and a pinned "Confirm contribution" footer.
 *
 * Live capabilities preserved beyond the prototype: the add/withdraw
 * direction toggle (withdrawals are negative contributions per the API
 * contract) and the optional note. Amounts parse via lib/inputs
 * parseAmountInput at the goal currency's minor-unit digits -- DecimalString
 * end to end, never a float. Only offered for fundingMode 'manual' (the API
 * 404s otherwise).
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  CreateGoalContributionRequest,
  GoalDto,
  MinorUnits,
} from '@goldfinch/shared/types';
import { minorUnitDigits, parseDecimalString, toDecimalString } from '@goldfinch/shared/money';

import { formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { useMaskMoney } from '../../../src/state/uiStore';
import { useHaptics } from '../../../src/ui/motion';
import { ModalSheet } from '../../../src/ui/ModalSheet';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { ProgressRing, categoryColor } from '../../../src/ui/charts';
import { useLang, useT, localeTag } from '../../../src/i18n';
import { logger } from '../../../src/lib/logger';
import { useCreateGoalContribution } from '../../../src/api/mutations';
import { errorMessage } from '../lib/errors';
import {
  isZeroDecimal,
  parseAmountInput,
  progressFraction,
  signedContributionAmount,
} from '../lib/inputs';
import { Button } from './Buttons';
import { FormField } from './FormField';
import { SegmentedTabs } from './SegmentedTabs';

export interface ContributionModalProps {
  /** The manual goal being funded; null = closed. */
  goal: GoalDto | null;
  onClose: () => void;
}

type Direction = 'add' | 'withdraw';

/** Major-unit quick amounts from the prototype's contribution sheet. */
const PRESETS = [50, 100, 250, 500] as const;

/** Floor percent from integer minor units; BigInt keeps the product exact. */
function flooredPercentOf(progressMinor: MinorUnits, targetMinor: MinorUnits): number {
  if (targetMinor <= 0) return progressMinor > 0 ? 100 : 0;
  const clamped = BigInt(Math.max(0, progressMinor));
  return Number((clamped * 100n) / BigInt(targetMinor));
}

function PresetChip({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: theme.colors.surfaceAlt,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.chip,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: 12.5,
          fontWeight: '600',
          fontFamily: theme.fonts.sansSet.semibold,
          fontVariant: ['tabular-nums'],
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ContributionModal({ goal, onClose }: ContributionModalProps) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  const locale = localeTag(lang);
  // Privacy mode masks the figures that expose the goal's STORED state -- the
  // "{current} -> {new} / {target}" caption and the "Finish · {remaining}"
  // preset (remaining = target - progress). The live amount the user is
  // actively typing stays readable; masking it would make the input unusable.
  const { mask } = useMaskMoney();
  const createContribution = useCreateGoalContribution();
  const haptics = useHaptics();

  const [direction, setDirection] = useState<Direction>('add');
  const [amountText, setAmountText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Re-seed local form state each time the modal opens for a goal.
  useEffect(() => {
    if (!goal) return;
    setDirection('add');
    setAmountText('');
    setNoteText('');
    setFieldError(null);
    setSubmitError(null);
  }, [goal]);

  if (!goal) return null;
  const digits = minorUnitDigits(goal.currency);
  const goalColor = categoryColor(goal.goalId, theme.colors.categories);

  const directionOptions: ReadonlyArray<{ key: Direction; label: string }> = [
    { key: 'add', label: t('Add funds') },
    { key: 'withdraw', label: 'Withdraw' },
  ];

  // Live preview: parse the typed amount (canonical DecimalString or null),
  // convert to integer minor units, and project the new progress.
  const parsedPreview = parseAmountInput(amountText, digits);
  let previewMinor: MinorUnits = 0;
  if (parsedPreview !== null) {
    try {
      previewMinor = parseDecimalString(parsedPreview, digits);
    } catch (error) {
      // Astronomical-but-well-formed input can exceed the safe-integer range
      // in minor units; the preview degrades to 0 while the field keeps the
      // text (submission re-validates). House rule: every catch logs.
      logger.warn('goals: contribution preview conversion failed', {
        goalId: goal.goalId,
        error,
      });
      previewMinor = 0;
    }
  }
  const deltaMinor = direction === 'withdraw' ? -previewMinor : previewMinor;
  const projectedMinor = goal.progressMinor + deltaMinor;
  const projectedPercent = flooredPercentOf(projectedMinor, goal.targetMinor);

  const remainingMinor = goal.targetMinor - goal.progressMinor;
  const fmt = (minor: MinorUnits) =>
    formatMinorAmount(minor, goal.currency, { locale });
  // Masked variant for figures derived from the goal's stored progress/target.
  const fmtMasked = (minor: MinorUnits) => mask(fmt(minor));

  const handleSubmit = () => {
    const amount = parseAmountInput(amountText, digits);
    if (amount === null || isZeroDecimal(amount)) {
      setFieldError(
        digits === 0
          ? 'Enter a positive whole amount, like 5000.'
          : 'Enter a positive amount, like 250 or 250.50.',
      );
      return;
    }
    setFieldError(null);
    setSubmitError(null);

    const body: CreateGoalContributionRequest = {
      amount: signedContributionAmount(amount, direction),
    };
    const note = noteText.trim();
    if (note !== '') body.note = note;

    createContribution.mutate(
      { goalId: goal.goalId, body },
      {
        onSuccess: () => {
          // Light tick on confirm (P9-2 item 10); a completion that this
          // contribution causes earns its own milestone in the goal card.
          haptics.confirmTick();
          onClose();
        },
        onError: (error) => setSubmitError(errorMessage(error)),
      },
    );
  };

  return (
    <ModalSheet
      visible
      title={goal.name}
      onClose={onClose}
      footer={
        <Button
          label={t('Confirm contribution')}
          onPress={handleSubmit}
          loading={createContribution.isPending}
          disabled={createContribution.isPending}
          style={styles.footerButton}
        />
      }
    >
      <View style={styles.centered}>
        <ProgressRing
          fraction={progressFraction(projectedMinor, goal.targetMinor)}
          size={92}
          strokeWidth={theme.chartVariant === 'block' ? 9 : 7}
          color={goalColor}
          label={`${projectedPercent}%`}
          percentComplete={projectedPercent}
        />
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 12.5,
            fontFamily: theme.fonts.mono,
            fontVariant: ['tabular-nums'],
            marginTop: 10,
          }}
        >
          {`${fmtMasked(goal.progressMinor)} → ${fmtMasked(projectedMinor)} / ${fmtMasked(goal.targetMinor)}`}
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 11,
            fontWeight: '700',
            fontFamily: theme.fonts.sansSet.bold,
            textTransform: 'uppercase',
            letterSpacing: 1.1,
            marginTop: 14,
          }}
        >
          {t('Contribution')}
        </Text>
        <Text
          accessibilityLabel={fmt(previewMinor)}
          style={{
            color: goalColor,
            fontSize: 42,
            fontFamily: theme.fonts.display,
            fontWeight: theme.fonts.displayWeight,
            fontVariant: ['tabular-nums'],
            marginTop: 2,
          }}
        >
          {fmt(deltaMinor)}
        </Text>
      </View>

      <View style={[styles.chipRow, { marginTop: 14, marginBottom: 16 }]}>
        {PRESETS.map((preset) => (
          <PresetChip
            key={preset}
            label={String(preset)}
            accessibilityLabel={`Set amount to ${preset}`}
            onPress={() => setAmountText(String(preset))}
          />
        ))}
        {direction === 'add' && remainingMinor > 0 ? (
          <PresetChip
            label={`${t('Finish')} · ${fmtMasked(remainingMinor)}`}
            accessibilityLabel={`Set amount to the remaining ${fmtMasked(remainingMinor)}`}
            onPress={() => setAmountText(toDecimalString(remainingMinor, digits))}
          />
        ) : null}
      </View>

      <View style={{ marginBottom: 16 }}>
        <SegmentedTabs
          options={directionOptions}
          value={direction}
          onChange={setDirection}
        />
      </View>

      <FormField
        label={`Amount (${goal.currency})`}
        value={amountText}
        onChangeText={setAmountText}
        placeholder={digits === 0 ? '5000' : '250.00'}
        keyboardType="decimal-pad"
        autoFocus
        error={fieldError}
      />

      <FormField
        label="Note (optional)"
        value={noteText}
        onChangeText={setNoteText}
        placeholder="June paycheck"
      />

      {submitError ? (
        <Text
          accessibilityRole="alert"
          style={{
            color: theme.colors.danger,
            fontSize: 12.5,
            fontFamily: theme.fonts.sans,
            marginBottom: 12,
          }}
        >
          {submitError}
        </Text>
      ) : null}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: 'center', paddingTop: 6 },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  footerButton: { flex: 1 },
});
