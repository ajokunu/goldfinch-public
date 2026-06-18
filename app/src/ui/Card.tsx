/**
 * Shared card surface + header row, promoted from the identical per-feature
 * copies (features/dashboard/components/Card.tsx and
 * features/reports/components/Card.tsx keep their paths as thin re-exports).
 *
 * Restyle per tokens.md 7.2 `.card` / `.card-title`: surface background,
 * themed border width, `radius.card`, small shadow (flat where the theme
 * says so), and a direction-aware title treatment (`display` sentence-case
 * vs `caps` eyebrow) -- all read from the theme, never branched on a
 * direction at the call site.
 */
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { shadowStyle } from './shadows';
import { useTheme } from './ThemeProvider';
import {
  hoverBackground,
  hoverLiftStyle,
  hoverLiftTransitionStyle,
  useHover,
} from './useHover';
import { useReducedMotion } from './useReducedMotion';

export interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Pressable card (P8-1): adds the kit web-hover treatment + press dim. */
  onPress?: () => void;
  /** Required label when `onPress` is set (the card becomes a control). */
  accessibilityLabel?: string;
  /** Extra web-hover style merged over the kit default (P8-1). */
  hoverStyle?: StyleProp<ViewStyle>;
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
  hoverStyle,
}: CardProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { hovered, hoverProps } = useHover(onPress !== undefined);

  // P9-2 item 5 web hover lift: -2dp translate + shadow deepen (sm -> lg) on
  // top of the P8 background highlight. Movement and the deepen are skipped
  // under reduced motion; flat-card themes keep their flatness (lift only).
  const lifted = hovered && !reduced;
  const surface = (pressed: boolean): StyleProp<ViewStyle> => [
    {
      backgroundColor: hovered
        ? hoverBackground(theme, theme.colors.surface)
        : theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: theme.card.borderWidth,
      borderRadius: theme.radius.card,
      padding: 16,
      opacity: pressed ? 0.85 : 1,
    },
    theme.card.shadow === 'sm'
      ? shadowStyle(lifted ? theme.shadows.lg : theme.shadows.sm)
      : null,
    onPress ? hoverLiftTransitionStyle(reduced) : null,
    hoverLiftStyle(hovered, reduced),
    hovered ? hoverStyle : null,
    style,
  ];

  if (!onPress) {
    return <View style={surface(false)}>{children}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      {...hoverProps}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => StyleSheet.flatten(surface(pressed))}
    >
      {children}
    </Pressable>
  );
}

export interface CardHeaderProps {
  title: string;
  right?: ReactNode;
}

export function CardHeader({ title, right }: CardHeaderProps) {
  const theme = useTheme();

  const titleStyle: TextStyle =
    theme.card.titleVariant === 'display'
      ? {
          fontFamily: theme.fonts.display,
          fontSize: 16,
          fontWeight: '600',
          color: theme.colors.textPrimary,
        }
      : {
          fontFamily: theme.fonts.sans,
          fontSize: 12,
          fontWeight: '700',
          color: theme.colors.textSecondary,
          textTransform: 'uppercase',
          // 0.08em at 12px.
          letterSpacing: 0.96,
        };

  return (
    <View style={[styles.headerRow, { marginBottom: theme.spacing.sm }]}>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[styles.title, titleStyle]}
      >
        {title}
      </Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1 },
});
