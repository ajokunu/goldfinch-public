/**
 * List row (More hub, settings, pickers): label, optional lucide icon in an
 * accent-tinted well, optional secondary line, optional right-side accessory
 * (value text, Switch, chevron). Plain text labels only -- no emoji.
 *
 * Restyle per components.md 6.4 row treatment: 42x42 radius-12 icon well on
 * `mixColor(accent, .15, surface)`, 15/600 title, 12.5 secondary, trailing
 * chevron in `textFaint` when pressable and no accessory is supplied.
 * Existing props are unchanged; `sub` is an additive presentation prop.
 */
import { useCallback, useRef, type ComponentType, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { ChevronRight, type LucideProps } from 'lucide-react-native';

import { mixColor } from './mixColor';
import { useTheme } from './ThemeProvider';
import { hoverBackground, hoverTransitionStyle, useHover } from './useHover';
import { motionDuration, useReducedMotion } from './useReducedMotion';

export interface ListRowProps {
  label: string;
  /** Secondary line under the label (e.g. the More-hub detail copy). */
  sub?: string;
  icon?: ComponentType<LucideProps>;
  right?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Extra web-hover style merged over the kit default (P8-1). */
  hoverStyle?: StyleProp<ViewStyle>;
}

export function ListRow({
  label,
  sub,
  icon: IconComponent,
  right,
  onPress,
  destructive = false,
  disabled = false,
  hoverStyle,
}: ListRowProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const { hovered, hoverProps } = useHover(onPress !== undefined && !disabled);

  const tint = destructive ? theme.colors.danger : theme.colors.accent;
  const labelColor = destructive
    ? theme.colors.danger
    : theme.colors.textPrimary;

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

  const body = (pressed: boolean) => (
    <Animated.View
      style={[
        styles.row,
        onPress ? hoverTransitionStyle(reduced) : null,
        {
          borderRadius: theme.radius.control,
          backgroundColor: pressed
            ? theme.colors.surfaceAlt
            : hovered
              ? hoverBackground(theme)
              : 'transparent',
          opacity: disabled ? 0.5 : 1,
          transform: [{ scale }],
        },
        hovered ? hoverStyle : null,
      ]}
    >
      {IconComponent ? (
        <View
          style={[
            styles.iconWell,
            { backgroundColor: mixColor(tint, 0.15, theme.colors.surface) },
          ]}
        >
          <IconComponent size={20} strokeWidth={2.2} color={tint} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text
          numberOfLines={1}
          style={[styles.label, { color: labelColor, fontFamily: theme.fonts.sans }]}
        >
          {label}
        </Text>
        {sub ? (
          <Text
            numberOfLines={1}
            style={[
              styles.sub,
              { color: theme.colors.textSecondary, fontFamily: theme.fonts.sans },
            ]}
          >
            {sub}
          </Text>
        ) : null}
      </View>
      {right !== undefined ? (
        right
      ) : onPress ? (
        // Disclosure affordance only when the caller did not take over the
        // accessory slot (an explicit null suppresses it -- selection rows).
        <ChevronRight size={17} color={theme.colors.textFaint} />
      ) : null}
    </Animated.View>
  );

  if (!onPress) return body(false);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => animateScale(0.985)}
      onPressOut={() => animateScale(1)}
      {...hoverProps}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      accessibilityHint={sub}
    >
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  iconWell: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 12.5 },
});
