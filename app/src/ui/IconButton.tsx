/**
 * Icon-only control in the kit's two fixed shapes (components.md 4.7):
 * `circle` (38x38 on surfaceAlt -- sheet close, header affordances) and
 * `pill` (40x40 radius-12 bordered surface). accessibilityLabel is REQUIRED
 * because the control has no visible text.
 */
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideProps } from 'lucide-react-native';

import { useTheme } from './ThemeProvider';
import { hoverBackground, hoverTransitionStyle, useHover } from './useHover';
import { useReducedMotion } from './useReducedMotion';

export interface IconButtonProps {
  icon: ComponentType<LucideProps>;
  onPress: () => void;
  /** Required -- icon-only control. */
  accessibilityLabel: string;
  variant?: 'circle' | 'pill';
  /** Defaults: 20 (circle) / 18 (pill). */
  iconSize?: number;
  disabled?: boolean;
  /** Extra web-hover style merged over the kit default (P8-1). */
  hoverStyle?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon: IconComponent,
  onPress,
  accessibilityLabel,
  variant = 'circle',
  iconSize,
  disabled = false,
  hoverStyle,
}: IconButtonProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { hovered, hoverProps } = useHover(!disabled);
  const circle = variant === 'circle';
  const size = iconSize ?? (circle ? 20 : 18);
  const iconColor = circle
    ? theme.colors.textSecondary
    : theme.colors.textPrimary;

  return (
    <Pressable
      onPress={onPress}
      {...hoverProps}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      hitSlop={theme.spacing.sm}
      style={({ pressed }) => [
        styles.base,
        hoverTransitionStyle(reduced),
        circle
          ? {
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: hovered
                ? hoverBackground(theme, theme.colors.surfaceAlt)
                : theme.colors.surfaceAlt,
            }
          : {
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: pressed
                ? theme.colors.surfaceAlt
                : hovered
                  ? hoverBackground(theme, theme.colors.surface)
                  : theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            },
        { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
        hovered ? hoverStyle : null,
      ]}
    >
      <IconComponent size={size} color={iconColor} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
