/**
 * Segmented control (components.md 4.4), promoting the near-identical
 * per-feature SegmentedTabs copies (budget, goals, recurring, reports, rules
 * keep their paths as thin re-exports of the SegmentedTabs alias below).
 *
 * Active treatment comes from the theme (`segmentedActive`): raised surface
 * with the small shadow by default, accent fill for directions that say so.
 * The active background crossfades (motion.select); layout position is never
 * animated.
 */
import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { shadowStyle } from './shadows';
import { useTheme } from './ThemeProvider';
import { hoverBackground, hoverTransitionStyle, useHover } from './useHover';
import { motionDuration, useReducedMotion } from './useReducedMotion';

export interface SegmentedOption<K extends string> {
  key: K;
  label: string;
}

export interface SegmentedProps<K extends string> {
  options: ReadonlyArray<SegmentedOption<K>>;
  value: K;
  onChange: (key: K) => void;
  small?: boolean;
}

export function Segmented<K extends string>({
  options,
  value,
  onChange,
  small = false,
}: SegmentedProps<K>) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.track,
        {
          backgroundColor: theme.colors.surfaceAlt,
          borderRadius: theme.radius.control + 3,
        },
      ]}
    >
      {options.map((option) => (
        <SegmentedItem
          key={option.key}
          label={option.label}
          selected={option.key === value}
          small={small}
          onPress={() => onChange(option.key)}
        />
      ))}
    </View>
  );
}

function SegmentedItem({
  label,
  selected,
  small,
  onPress,
}: {
  label: string;
  selected: boolean;
  small: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(selected ? 1 : 0)).current;
  // Hover highlights unselected tabs only; the active tab already carries
  // its raised/accent fill (P8-1).
  const { hovered, hoverProps } = useHover(!selected);

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: selected ? 1 : 0,
      duration: motionDuration(theme.motion.select.durationMs, reduced),
      easing: Easing.bezier(...theme.motion.select.bezier),
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [selected, progress, theme, reduced]);

  const accentFill = theme.segmentedActive === 'accent';
  const activeBg = accentFill ? theme.colors.accent : theme.colors.surface;
  const activeText = accentFill
    ? theme.colors.onAccent
    : theme.colors.textPrimary;

  return (
    <Pressable
      onPress={onPress}
      {...hoverProps}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      style={[
        styles.item,
        hoverTransitionStyle(reduced),
        {
          borderRadius: theme.radius.control,
          paddingVertical: small ? 6 : 9,
          backgroundColor: hovered
            ? hoverBackground(theme, theme.colors.surfaceAlt)
            : 'transparent',
        },
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            borderRadius: theme.radius.control,
            backgroundColor: activeBg,
            opacity: progress,
          },
          accentFill ? null : shadowStyle(theme.shadows.sm),
        ]}
      />
      <Text
        numberOfLines={1}
        style={{
          color: selected ? activeText : theme.colors.textSecondary,
          fontSize: small ? 12 : 13,
          fontWeight: '600',
          fontFamily: theme.fonts.sans,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Promotion alias for the per-feature SegmentedTabs components: identical
 * option/value/onChange contract, so the feature files become one-line
 * re-exports without API churn.
 */
export const SegmentedTabs: typeof Segmented = Segmented;

export type SegmentedTabsProps<K extends string> = Omit<
  SegmentedProps<K>,
  'small'
>;

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: 3, padding: 4 },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
});
