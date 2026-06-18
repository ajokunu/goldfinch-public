/**
 * Goal progress bar. Unlike the budget bar (where crossing the limit is
 * bad), reaching 100% here is success: the fill turns positive at and beyond
 * the target, accent below it. The percent label uses the SERVER-computed
 * percentComplete (shared percentUsed floor semantics) -- the float here is
 * layout-only width.
 */
import { StyleSheet, Text, View } from 'react-native';
import type { MinorUnits } from '@goldfinch/shared/types';

import { useTheme } from '../../../src/ui/ThemeProvider';
import { progressFraction } from '../lib/inputs';

export interface GoalProgressBarProps {
  progressMinor: MinorUnits;
  targetMinor: MinorUnits;
  /** Server-computed floor percent (GoalDto.percentComplete); may exceed 100. */
  percentComplete: number;
  height?: number;
}

export function GoalProgressBar({
  progressMinor,
  targetMinor,
  percentComplete,
  height = 8,
}: GoalProgressBarProps) {
  const theme = useTheme();
  const fraction = progressFraction(progressMinor, targetMinor);
  const fillColor =
    percentComplete >= 100 ? theme.colors.positive : theme.colors.accent;

  return (
    <View style={styles.row}>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.min(percentComplete, 100) }}
        style={[
          styles.track,
          {
            height,
            borderRadius: height / 2,
            backgroundColor: theme.colors.surfaceAlt,
          },
        ]}
      >
        <View
          style={{
            width: `${fraction * 100}%`,
            height,
            borderRadius: height / 2,
            backgroundColor: fillColor,
          }}
        />
      </View>
      <Text
        style={{
          color: percentComplete >= 100 ? theme.colors.positive : theme.colors.textSecondary,
          fontSize: theme.text.caption,
          fontWeight: '700',
          marginLeft: theme.spacing.sm,
          fontVariant: ['tabular-nums'],
        }}
      >
        {percentComplete}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  track: { overflow: 'hidden', flex: 1 },
});
