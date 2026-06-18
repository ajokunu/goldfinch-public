/**
 * Month stepper for the income-flow report: previous / label / next, with
 * `maxMonth` (the current month) disabling future months. Restyled per
 * design-spec/screens.md 4.4 to the centered chevron nav: icon-pill chevrons
 * on surfaceAlt, month label in the direction's semibold sans cut,
 * locale-aware label ("June 2026" / "2026년 6월"). API unchanged.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { IsoMonth } from '@goldfinch/shared/types';

import { localeTag, useLang } from '../../../src/i18n';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  addIsoMonths,
  compareIsoMonth,
  isoMonthLabel,
} from '../../../src/lib/dates';

export interface MonthPickerProps {
  month: IsoMonth;
  onChange: (month: IsoMonth) => void;
  /** Latest selectable month (inclusive); omit for no upper bound. */
  maxMonth?: IsoMonth;
  /** Earliest selectable month (inclusive); omit for no lower bound. */
  minMonth?: IsoMonth;
}

export function MonthPicker({
  month,
  onChange,
  maxMonth,
  minMonth,
}: MonthPickerProps) {
  const theme = useTheme();
  const lang = useLang();
  const prevDisabled =
    minMonth !== undefined && compareIsoMonth(month, minMonth) <= 0;
  const nextDisabled =
    maxMonth !== undefined && compareIsoMonth(month, maxMonth) >= 0;

  const arrowStyle = (disabled: boolean, pressed: boolean) => [
    styles.arrow,
    {
      backgroundColor: theme.colors.surfaceAlt,
      borderRadius: theme.radius.control,
      opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
    },
  ];

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onChange(addIsoMonths(month, -1))}
        disabled={prevDisabled}
        accessibilityRole="button"
        accessibilityLabel="Previous month"
        accessibilityState={{ disabled: prevDisabled }}
        hitSlop={theme.spacing.sm}
        style={({ pressed }) => arrowStyle(prevDisabled, pressed)}
      >
        <ChevronLeft size={18} color={theme.colors.textPrimary} />
      </Pressable>
      <Text
        style={[
          styles.label,
          {
            color: theme.colors.textPrimary,
            fontFamily: theme.fonts.sansSet.semibold,
          },
        ]}
      >
        {isoMonthLabel(month, localeTag(lang))}
      </Text>
      <Pressable
        onPress={() => onChange(addIsoMonths(month, 1))}
        disabled={nextDisabled}
        accessibilityRole="button"
        accessibilityLabel="Next month"
        accessibilityState={{ disabled: nextDisabled }}
        hitSlop={theme.spacing.sm}
        style={({ pressed }) => arrowStyle(nextDisabled, pressed)}
      >
        <ChevronRight size={18} color={theme.colors.textPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  arrow: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14.5, textAlign: 'center', minWidth: 150 },
});
