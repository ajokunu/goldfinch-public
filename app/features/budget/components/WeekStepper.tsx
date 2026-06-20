/**
 * Budget week stepper (budget-range feature, Feature B). Mirrors MonthPicker's
 * prev/next chevron affordance, but steps whole weeks through the SHARED
 * `stepWeek` helper so the Monday..Sunday boundary is single-sourced and never
 * re-derived. Every week is reachable -- there is no min/max gate beyond data
 * availability (Section 9.1: "every week should exist"). The centered label
 * shows the active Mon..Sun span ("Jun 8 - Jun 14").
 *
 * Chevrons are lucide-react-native (utilitarian chrome, house rules); the week
 * label sentence is the [PARAM] `weekRangeLabel` message (Korean word order).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { stepWeek } from '@goldfinch/shared/periodWindow';

import { localeTag, useLang, weekRangeLabel } from '../../../src/i18n';
import { useTheme } from '../../../src/ui/ThemeProvider';

export interface WeekStepperProps {
  /** Whole-week offset from the current week (0 = this week). */
  weekDelta: number;
  /** Emits the new delta when a chevron is pressed. */
  onChange: (weekDelta: number) => void;
  /** Injectable "now" for the week anchor (tests); defaults to the instant. */
  now?: Date;
}

export function WeekStepper({ weekDelta, onChange, now }: WeekStepperProps) {
  const theme = useTheme();
  const lang = useLang();
  const anchor = now ?? new Date();
  const window = stepWeek(anchor, weekDelta);
  const label = weekRangeLabel(lang, window.from, window.to, localeTag(lang));

  const chevronButton = (pressed: boolean) => ({
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: pressed ? theme.colors.surfaceAlt : 'transparent',
  });

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onChange(weekDelta - 1)}
        accessibilityRole="button"
        accessibilityLabel="Previous week"
        hitSlop={theme.spacing.sm}
        style={({ pressed }) => chevronButton(pressed)}
      >
        <ChevronLeft size={19} color={theme.colors.textPrimary} strokeWidth={2.2} />
      </Pressable>
      <Text
        accessibilityRole="header"
        style={[
          styles.label,
          {
            color: theme.colors.textPrimary,
            fontFamily: theme.fonts.display,
            fontWeight: theme.fonts.displayWeight,
          },
        ]}
      >
        {label}
      </Text>
      <Pressable
        onPress={() => onChange(weekDelta + 1)}
        accessibilityRole="button"
        accessibilityLabel="Next week"
        hitSlop={theme.spacing.sm}
        style={({ pressed }) => chevronButton(pressed)}
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
