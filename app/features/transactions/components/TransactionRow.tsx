/**
 * One transaction in the list (screens.md 2.3 / components.md 5.5):
 * 38px tok + two-line body + amount column.
 *
 * - Icon well: transfer -> neutral well with the transfers glyph;
 *   categorized -> the category's identity glyph in its stable accent
 *   (charts categoryColor hash); uncategorized -> the dashed-circle glyph in
 *   the palette's `other` slot (CategoryIcon, ops/design-spec/icons.md).
 * - Line 1: payee 14.5/600 truncate; amount via Money (exact decimal string,
 *   no floats) -- income gets an explicit '+' in `pos`, expenses stay text
 *   color, pending amounts render `faint`.
 * - Line 2: "{account} · {category}" muted; transfers "Transfer",
 *   uncategorized "Uncategorized" (i18n). Rule/AI-categorized rows
 *   (categorizedBy 'rule'|'ai', not user-confirmed) swap line 2 for the
 *   attribution sparkle: Sparkles + "Auto · {category}" in accent2 -- the
 *   honest live mapping of the prototype's "Suggested" language. The full
 *   account context stays in the accessibility label either way.
 * - Pending rows show the restyled PendingBadge trailing line 2.
 *
 * Press: scale 0.985 + surfaceAlt fill (motion.press; reduced-motion aware).
 * Memoized: FlashList recycles views aggressively and the parent re-renders
 * on every filter keystroke.
 */
import { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import type { TransactionDto } from '@goldfinch/shared/types';

import { useT } from '../../../src/i18n';
import { useMaskMoney } from '../../../src/state/uiStore';
import { CategoryIcon } from '../../../src/ui/icons';
import { formatDecimalAmount, Money } from '../../../src/ui/Money';
import { PressableScale } from '../../../src/ui/motion';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  hoverBackground,
  hoverTransitionStyle,
  useHover,
} from '../../../src/ui/useHover';
import { useReducedMotion } from '../../../src/ui/useReducedMotion';
import { isPositiveDecimal } from '../lib/display';
import { PendingBadge } from './PendingBadge';

export interface TransactionRowProps {
  txn: TransactionDto;
  /** Resolved account display name ('' until the accounts query lands). */
  accountName: string;
  /** Resolved category display name; null when uncategorized. */
  categoryName: string | null;
  onPress: (txnId: string) => void;
}

function TransactionRowInner({
  txn,
  accountName,
  categoryName,
  onPress,
}: TransactionRowProps) {
  const theme = useTheme();
  const t = useT();
  // The row's screen-reader label concatenates the amount into one string
  // (built here, not by the Money primitive), so privacy mode masks the
  // amount before it lands in the accessibilityLabel.
  const { mask } = useMaskMoney();
  // Reduced-motion flag is only read for the kit's hover transition style;
  // press motion is owned by the PressableScale primitive (PHASE9-DECISIONS
  // P9-1: no ad-hoc Animated code in features).
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  // Kit hover system (P8-1): web-only, inert on native.
  const { hovered, hoverProps } = useHover();

  const payee = txn.payee || txn.description || 'Unknown payee';
  const categoryLabel = txn.isTransfer
    ? t('Transfer')
    : (categoryName ?? t('Uncategorized'));
  const subtitle = accountName
    ? `${accountName} · ${categoryLabel}`
    : categoryLabel;

  const positive = isPositiveDecimal(txn.amount);
  const amountColor = txn.pending
    ? theme.colors.faint
    : positive
      ? theme.colors.pos
      : theme.colors.text;

  // Honest live mapping of the prototype's sparkle: rule/AI-attributed
  // categories that the user has not confirmed (screens.md 2.3).
  const autoTagged =
    !txn.userCategorized &&
    !txn.isTransfer &&
    txn.categoryId !== null &&
    (txn.categorizedBy === 'rule' || txn.categorizedBy === 'ai');

  const accessibilityLabel = `Transaction ${payee}, ${mask(
    formatDecimalAmount(txn.amount, txn.currency),
  )}, ${subtitle}${txn.pending ? `, ${t('Pending')}` : ''}`;

  return (
    // Rows scale to 0.985 on press-in (screens.md 0.6 item: rows 0.985,
    // buttons 0.97); the surfaceAlt fill survives reduced motion as state
    // feedback alongside the primitive's opacity dim.
    <PressableScale
      onPress={() => onPress(txn.txnId)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      scaleTo={0.985}
      {...hoverProps}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.row,
        hoverTransitionStyle(reduced),
        {
          borderRadius: theme.radius.control,
          backgroundColor: pressed
            ? theme.colors.surfaceAlt
            : hovered
              ? hoverBackground(theme)
              : 'transparent',
        },
      ]}
    >
      {txn.isTransfer ? (
        <CategoryIcon categoryId="transfers" neutral />
      ) : (
        <CategoryIcon
          categoryId={txn.categoryId}
          categoryName={categoryName}
        />
      )}
      <View style={styles.body}>
        <View style={styles.line}>
          <Text
            style={[
              styles.payee,
              { color: theme.colors.text, fontFamily: theme.fonts.sans },
            ]}
            numberOfLines={1}
          >
            {payee}
          </Text>
          <Money
            amount={txn.amount}
            currency={txn.currency}
            signDisplay={positive ? 'always' : 'auto'}
            style={{
              color: amountColor,
              fontSize: 15,
              fontWeight: '600',
              fontFamily: theme.fonts.mono,
              letterSpacing: -0.15,
            }}
          />
        </View>
        <View style={styles.line}>
          {autoTagged ? (
            <View style={styles.subLine}>
              <Sparkles size={12} strokeWidth={2.2} color={theme.colors.accent2} />
              <Text
                style={[
                  styles.autoText,
                  { color: theme.colors.accent2, fontFamily: theme.fonts.sans },
                ]}
                numberOfLines={1}
              >
                {`Auto · ${categoryLabel}`}
              </Text>
            </View>
          ) : (
            <Text
              style={[
                styles.subText,
                { color: theme.colors.dim, fontFamily: theme.fonts.sans },
              ]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          )}
          {txn.pending ? <PendingBadge /> : null}
        </View>
      </View>
    </PressableScale>
  );
}

export const TransactionRow = memo(TransactionRowInner);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 6,
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  payee: { flex: 1, fontSize: 14.5, fontWeight: '600' },
  subLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  autoText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  subText: { fontSize: 12, flexShrink: 1 },
});
