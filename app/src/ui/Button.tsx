/**
 * Shared button (components.md 4.6), consolidating the four per-feature
 * Buttons.tsx copies (budget, goals, import, rules keep their paths as thin
 * wrappers mapping 'secondary' -> 'outline' and 'danger' ->
 * `variant="outline" destructive`).
 *
 * Variants: primary (accent fill), ghost (surfaceAlt fill), outline
 * (1.5px border). `destructive` is an additive presentation modifier that
 * recolors the variant with `colors.danger` so wrappers stay thin.
 */
import { useCallback, useRef, useState, type ComponentType } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { LucideProps } from 'lucide-react-native';

import { useTheme } from './ThemeProvider';
import { motionDuration, useReducedMotion } from './useReducedMotion';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  /** Default 'primary'. */
  variant?: 'primary' | 'ghost' | 'outline';
  /** Recolor the variant with colors.danger (destructive actions). */
  destructive?: boolean;
  /** Leading icon, 16px, strokeWidth 2.2. */
  icon?: ComponentType<LucideProps>;
  disabled?: boolean;
  /** ActivityIndicator replaces the label while a mutation is in flight. */
  loading?: boolean;
  /** Callers set flex in sheet footers. */
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  destructive = false,
  icon: IconComponent,
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const [hovered, setHovered] = useState(false);
  const blocked = disabled || loading;

  const backgroundColor =
    variant === 'primary'
      ? destructive
        ? theme.colors.danger
        : theme.colors.accent
      : variant === 'ghost'
        ? theme.colors.surfaceAlt
        : 'transparent';
  const contentColor =
    variant === 'primary'
      ? theme.colors.onAccent
      : destructive
        ? theme.colors.danger
        : theme.colors.textPrimary;
  const borderColor = destructive ? theme.colors.danger : theme.colors.border;

  const animateScale = useCallback(
    (toValue: number) => {
      Animated.timing(scale, {
        toValue,
        duration: motionDuration(theme.motion.press.durationMs, reduced),
        easing: Easing.bezier(...theme.motion.press.bezier),
        useNativeDriver: true,
      }).start();
    },
    [scale, theme, reduced],
  );

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => animateScale(0.97)}
      onPressOut={() => animateScale(1)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy: loading }}
      style={style}
    >
      <Animated.View
        style={[
          styles.body,
          {
            backgroundColor,
            borderRadius: theme.radius.control,
            borderWidth: variant === 'outline' ? 1.5 : 0,
            borderColor: variant === 'outline' ? borderColor : 'transparent',
            opacity: blocked ? 0.5 : 1,
            transform: [{ scale }],
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={contentColor} />
        ) : (
          <>
            {IconComponent ? (
              <IconComponent size={16} strokeWidth={2.2} color={contentColor} />
            ) : null}
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: contentColor, fontFamily: theme.fonts.sans },
              ]}
            >
              {label}
            </Text>
          </>
        )}
        {/* Web hover brightness lift (overlay, per components.md 4.6). */}
        {hovered && !blocked ? (
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              {
                borderRadius: theme.radius.control,
                backgroundColor: theme.colors.textPrimary,
                opacity: 0.06,
              },
            ]}
          />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  label: { fontSize: 15, fontWeight: '700' },
});
