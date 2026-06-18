/**
 * Floating add button (design-spec shell.md 2.1): 56x56, accent fill, theme
 * fab radius (full circle in halo), accent-tinted drop shadow, opening the
 * add-action sheet through the shell SheetHost. The hosting layout decides
 * visibility (Home / Activity / Budget tabs only, never on desktop) and the
 * bottom offset (tab-bar height + 18) so the button tracks real insets.
 *
 * Press feedback is the spec'd 0.92 scale via motion.press; the prototype's
 * 90-degree rotation is optional polish and intentionally not implemented
 * (one less reduced-motion branch). Scale still collapses to ~1ms under
 * reduced motion.
 */
import { useCallback, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { Plus } from 'lucide-react-native';

import { useT } from '../../i18n';
import { useOpenAddMenu } from '../AddMenuSheet';
import { withAlpha } from '../mixColor';
import { useTheme } from '../ThemeProvider';
import { motionDuration, useReducedMotion } from '../useReducedMotion';

export interface AddFabProps {
  /** Computed by the layout: false on desktop and off Home/Activity/Budget. */
  visible: boolean;
  /** Absolute bottom offset (tab-bar height + 18). */
  bottom: number;
}

const PRESS_SCALE = 0.92;

export function AddFab({ visible, bottom }: AddFabProps) {
  const theme = useTheme();
  const t = useT();
  const reduced = useReducedMotion();
  const openAddMenu = useOpenAddMenu();
  const scale = useRef(new Animated.Value(1)).current;

  const animateScale = useCallback(
    (toValue: number) => {
      Animated.timing(scale, {
        toValue,
        duration: motionDuration(theme.motion.press.durationMs, reduced),
        easing: Easing.bezier(...theme.motion.press.bezier),
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    },
    [scale, theme, reduced],
  );

  if (!visible) return null;

  // Accent-tinted drop shadow (prototype `0 12px 28px -8px accent@60%`);
  // Android elevation tints via shadowColor on API 28+ and degrades to the
  // system shadow below that.
  const shadow: ViewStyle =
    Platform.select<ViewStyle>({
      web: {
        boxShadow: `0 12px 28px -8px ${withAlpha(theme.colors.accent, 0.6)}`,
      },
      ios: {
        shadowColor: theme.colors.accent,
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.6,
        shadowRadius: 14,
      },
      default: { elevation: 8, shadowColor: theme.colors.accent },
    }) ?? {};

  return (
    <Animated.View
      style={[styles.wrap, { bottom, transform: [{ scale }] }]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={openAddMenu}
        onPressIn={() => animateScale(PRESS_SCALE)}
        onPressOut={() => animateScale(1)}
        accessibilityRole="button"
        accessibilityLabel={t('Add')}
        testID="fab-add"
        style={[
          styles.fab,
          shadow,
          {
            backgroundColor: theme.colors.accent,
            borderRadius: theme.radius.fab,
          },
        ]}
      >
        <Plus size={26} strokeWidth={2.4} color={theme.colors.onAccent} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 18 },
  fab: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
