/**
 * Budget date-range chooser (budget-range feature, Decision 1 / Feature A).
 * A ModalSheet radio list of the six presets, mirroring the Activity
 * FilterSheet's radio-row pattern. Presets-only in v1 -- no native calendar.
 * Selection applies immediately and dismisses the sheet so the budget screen
 * re-scopes to the chosen [from,to] range.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { useT } from '../../../src/i18n';
import { Button } from '../../../src/ui/Button';
import { ModalSheet } from '../../../src/ui/ModalSheet';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  BUDGET_DATE_RANGE_PRESETS,
  type DateRangePresetId,
} from '../../../src/lib/dateRangePresets';

export interface RangeChooserSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The active preset, or null when no preset (default current-period) view. */
  preset: DateRangePresetId | null;
  onPresetChange: (preset: DateRangePresetId) => void;
}

function OptionRow({
  label,
  selected,
  first,
  onPress,
}: {
  label: string;
  selected: boolean;
  first: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [
        styles.option,
        {
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.line,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.optionText}>
        <Text
          style={{
            color: theme.colors.text,
            fontSize: 14.5,
            fontWeight: selected ? '600' : '400',
            fontFamily: theme.fonts.sans,
          }}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
      {selected ? <Check size={18} color={theme.colors.accent} /> : null}
    </Pressable>
  );
}

export function RangeChooserSheet({
  visible,
  onClose,
  preset,
  onPresetChange,
}: RangeChooserSheetProps) {
  const t = useT();

  return (
    <ModalSheet
      visible={visible}
      title={t('Date range')}
      onClose={onClose}
      footer={
        <Button
          label={t('Close')}
          variant="ghost"
          onPress={onClose}
          style={styles.footerButton}
        />
      }
    >
      <View accessibilityRole="radiogroup">
        {BUDGET_DATE_RANGE_PRESETS.map((option, index) => (
          <OptionRow
            key={option.id}
            label={t(option.label)}
            selected={option.id === preset}
            first={index === 0}
            onPress={() => onPresetChange(option.id)}
          />
        ))}
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    gap: 8,
  },
  optionText: { flex: 1 },
  footerButton: { flex: 1 },
});
