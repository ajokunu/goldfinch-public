/**
 * Month stepper restyled per design spec screens.md 3.2: centered display-font
 * month label between two 32px circular chevron buttons. `maxMonth` (usually
 * the current month) disables stepping into the future. The label localizes
 * with the active i18n language.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { IsoMonth } from '@goldfinch/shared/types';

import { localeTag, useLang } from '../../../src/i18n';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { addIsoMonths, compareIsoMonth, isoMonthLabel } from '../../../src/lib/dates';

export interface MonthPickerProps {
  month: IsoMonth;
  onChange: (month: IsoMonth) => void;
  /** Latest selectable month (inclusive); omit for no upper bound. */
  maxMonth?: IsoMonth;
  /** Earliest selectable month (inclusive); omit for no lower bound. */
  minMonth?: IsoMonth;
}

export function MonthPicker({ month, onChange, maxMonth, minMonth }: MonthPickerProps) {
  const theme = useTheme();
  const lang = useLang();
  const prevDisabled =
    minMonth !== undefined && compareIsoMonth(month, minMonth) <= 0;
  const nextDisabled =
    maxMonth !== undefined && compareIsoMonth(month, maxMonth) >= 0;

  const chevronButton = (disabled: boolean, pressed: boolean) => ({
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
    opacity: disabled ? 0.3 : 1,
  });

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onChange(addIsoMonths(month, -1))}
        disabled={prevDisabled}
        accessibilityRole="button"
        accessibilityLabel="Previous month"
        hitSlop={theme.spacing.sm}
        style={({ pressed }) => chevronButton(prevDisabled, pressed)}
      >
        <ChevronLeft size={19} color={theme.colors.textPrimary} strokeWidth={2.2} />
      </Pressable>
      <Text
        style={[
          styles.label,
          {
            color: theme.colors.textPrimary,
            fontFamily: theme.fonts.display,
            fontWeight: theme.fonts.displayWeight,
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
        hitSlop={theme.spacing.sm}
        style={({ pressed }) => chevronButton(nextDisabled, pressed)}
      >
        <ChevronRight size={19} color={theme.colors.textPrimary} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 17, textAlign: 'center', minWidth: 150 },
});
