/**
 * Envelope card, one per BudgetDto (design spec screens.md 3.3): head row
 * with the category identity glyph in the category accent (CategoryGlyph,
 * ops/design-spec/icons.md), name, over-limit Flame and a faint Pencil;
 * category-colored progress bar; foot row with the muted mono
 * "{spent} / {limit}" and the remaining/overage readout.
 *
 * Tap opens the budget editor sheet (prototype behavior). The pre-redesign
 * recategorize drill-down stays reachable: the spent/limit foot line is its
 * own press target and opens the category's month transactions.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Flame, Pencil, RefreshCw } from 'lucide-react-native';
import type { BudgetDto, CurrencyCode } from '@goldfinch/shared/types';

import { useT } from '../../../src/i18n';
import { CategoryGlyph } from '../../../src/ui/icons';
import { formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { formatDecimalAmount } from '../../../src/ui/Money';
import { useMaskMoney } from '../../../src/state/uiStore';
import { PressableScale, Pulse } from '../../../src/ui/motion';
import { shadowStyle } from '../../../src/ui/shadows';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  HOVER_LIFT_DISTANCE,
  hoverBackground,
  hoverLiftTransitionStyle,
  useHover,
} from '../../../src/ui/useHover';
import { useReducedMotion } from '../../../src/ui/useReducedMotion';
import { BudgetProgressBar } from './BudgetProgressBar';

export interface BudgetCategoryRowProps {
  name: string;
  budget: BudgetDto;
  currency: CurrencyCode;
  /** Category presentation color (lib/colors.ts colorForCategory). */
  color: string;
  /**
   * Translated cadence caption for this budget's own period (P11-4): the row's
   * limit + spent are for ONE period, so the label tells the user which
   * ("Weekly" / "Monthly" / "Yearly"). Omitted leaves the row period-agnostic.
   */
  periodLabel?: string;
  /** Card tap: opens the month's transactions for this category. */
  onPress: () => void;
  /** Pencil tap: opens the budget editor sheet. */
  onEdit: () => void;
}

export function BudgetCategoryRow({
  name,
  budget,
  currency,
  color,
  periodLabel,
  onPress,
  onEdit,
}: BudgetCategoryRowProps) {
  const theme = useTheme();
  const t = useT();
  // Reduced-motion flag is only read for the kit's hover lift styles; press
  // motion is owned by the PressableScale primitive (PHASE9-DECISIONS P9-1:
  // no ad-hoc Animated code in features).
  const reduced = useReducedMotion();
  const { hovered, hoverProps } = useHover();
  // The foot lines and the row's accessibilityLabel concatenate money into
  // sentences ("{spent} / {limit}", "{remaining} left", "Over {overage}")
  // outside the Money primitive, so privacy mode masks each money piece here.
  const { mask } = useMaskMoney();

  const overBudget = budget.remainingMinor < 0;
  const overageMinor = budget.spentMinor - budget.limitMinor;

  const spentOfLimit = `${mask(formatDecimalAmount(budget.spent, currency))} / ${mask(formatDecimalAmount(budget.limit, currency))}`;
  // t('Left') is "Left"/"남음"; the en foot line wants the lowercase word
  // ("$45.00 left") and lowercasing is a no-op for the Korean value.
  const remainingLine = `${mask(formatDecimalAmount(budget.remaining, currency))} ${t('Left').toLowerCase()}`;
  const overLine = `${t('Over')} ${mask(formatMinorAmount(overageMinor, currency))}`;

  return (
    // Cards scale to 0.985 on press-in (screens.md 0.6); the primitive owns
    // the spring and the reduced-motion opacity-dim fallback. The press scale
    // lives on this wrapper node while the web hover lift translates the
    // inner card view, so the two transforms compose instead of clobbering
    // each other.
    <PressableScale
      onPress={onPress}
      scaleTo={0.985}
      {...hoverProps}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${spentOfLimit}`}
      accessibilityHint={t('Transactions')}
    >
      <View
        style={[
          // P9-2 item 5 web hover lift: shadow deepens sm -> lg while
          // hovered (skipped under reduced motion and on flat-card themes).
          theme.card.shadow === 'sm'
            ? shadowStyle(
                hovered && !reduced ? theme.shadows.lg : theme.shadows.sm,
              )
            : null,
          hoverLiftTransitionStyle(reduced),
          {
            backgroundColor: hovered
              ? hoverBackground(theme, theme.colors.surface)
              : theme.colors.surface,
            borderColor: theme.colors.border,
            borderWidth: theme.card.borderWidth,
            borderRadius: theme.radius.card,
            padding: 14,
            marginBottom: 10,
            // `hovered` is web-only by useHover's gating.
            transform:
              hovered && !reduced
                ? [{ translateY: -HOVER_LIFT_DISTANCE }]
                : undefined,
          },
        ]}
      >
        <View style={styles.headRow}>
          <View style={styles.glyphWrap}>
            <CategoryGlyph
              categoryId={budget.categoryId}
              categoryName={name}
              color={color}
              size={16}
            />
          </View>
          <Text
            numberOfLines={1}
            style={[
              styles.name,
              { color: theme.colors.textPrimary, fontFamily: theme.fonts.sansSet.semibold },
            ]}
          >
            {name}
          </Text>
          {periodLabel ? (
            <Text
              numberOfLines={1}
              accessibilityLabel={periodLabel}
              style={[
                styles.periodTag,
                {
                  color: theme.colors.textSecondary,
                  backgroundColor: theme.colors.surfaceAlt,
                  borderRadius: theme.radius.chip,
                  fontFamily: theme.fonts.sansSet.bold,
                },
              ]}
            >
              {periodLabel}
            </Text>
          ) : null}
          {overBudget ? (
            <Flame
              size={14}
              color={theme.colors.neg}
              style={styles.headIcon}
              accessibilityLabel={t('Over')}
            />
          ) : null}
          {budget.rollover ? (
            <RefreshCw
              size={12}
              color={theme.colors.textSecondary}
              style={styles.headIcon}
              accessibilityLabel={t('Roll over leftovers')}
            />
          ) : null}
          <View style={styles.headSpacer} />
          <Pressable
            onPress={onEdit}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`${t('Edit budget')}: ${name}`}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Pencil size={15} color={theme.colors.textFaint} />
          </Pressable>
        </View>

        <View style={styles.barWrap}>
          <BudgetProgressBar
            spentMinor={budget.spentMinor}
            limitMinor={budget.limitMinor}
            color={color}
          />
        </View>

        <View style={styles.footRow}>
          <Text
            style={[
              styles.spentLine,
              { color: theme.colors.textSecondary, fontFamily: theme.fonts.mono },
            ]}
          >
            {spentOfLimit}
          </Text>
          <Text
            style={[
              styles.remainLine,
              {
                color: overBudget ? theme.colors.neg : theme.colors.textSecondary,
                fontFamily: theme.fonts.sansSet.bold,
              },
            ]}
          >
            {overBudget ? overLine : remainingLine}
          </Text>
        </View>
        {/* 100%-crossing flash (PHASE9-DECISIONS P9-2 item 7): one restrained
            pulse in the category color when this envelope tips over budget
            while on screen (a categorize/refetch lands). The Pulse contract
            never fires for rows that mount already over budget, and the
            surviving feedback (Flame + neg recolor) carries the state. */}
        <Pulse
          color={color}
          trigger={overBudget ? 'over' : null}
          borderRadius={theme.radius.card}
          testID={`budget-over-pulse-${budget.categoryId}`}
        />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center' },
  glyphWrap: { marginRight: 8, flexShrink: 0 },
  name: { fontSize: 15, flexShrink: 1 },
  periodTag: {
    marginLeft: 8,
    flexShrink: 0,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  headIcon: { marginLeft: 6 },
  headSpacer: { flex: 1 },
  barWrap: { marginVertical: 10 },
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spentLine: { fontSize: 12 },
  remainLine: { fontSize: 12.5 },
});
