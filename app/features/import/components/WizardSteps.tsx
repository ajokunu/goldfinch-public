/**
 * Compact step indicator for the import wizard: numbered dots + labels,
 * accent for the active step, positive for completed ones.
 */
import { StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { useTheme } from '../../../src/ui/ThemeProvider';

export interface WizardStepsProps {
  labels: readonly string[];
  /** Index of the active step (0-based). */
  activeIndex: number;
}

export function WizardSteps({ labels, activeIndex }: WizardStepsProps) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { marginBottom: theme.spacing.md }]}>
      {labels.map((label, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        const dotColor = done
          ? theme.colors.positive
          : active
            ? theme.colors.accent
            : theme.colors.surfaceAlt;
        const numberColor = done || active ? theme.colors.onAccent : theme.colors.textSecondary;
        return (
          <View key={label} style={styles.step}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: dotColor,
                  borderColor: done || active ? dotColor : theme.colors.border,
                },
              ]}
            >
              {done ? (
                <Check size={12} color={theme.colors.onAccent} />
              ) : (
                <Text style={[styles.dotText, { color: numberColor }]}>{index + 1}</Text>
              )}
            </View>
            <Text
              numberOfLines={1}
              style={{
                color: active ? theme.colors.textPrimary : theme.colors.textSecondary,
                fontSize: theme.text.caption,
                fontWeight: active ? '700' : '400',
                marginTop: theme.spacing.xs,
              }}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  step: { alignItems: 'center', flex: 1 },
  dot: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  dotText: { fontSize: 12, fontWeight: '700' },
});
