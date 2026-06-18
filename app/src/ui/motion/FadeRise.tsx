/**
 * FadeRise -- the entrance primitive (PHASE9-DECISIONS P9-1/P9-2): children
 * fade in (eased timing, flow curve) while rising `distance` dp on a damped
 * spring. Mount-only; it never re-animates on re-render or scroll.
 *
 * Kill-switch contract: reduced motion collapses to a fast fade with zero
 * travel; multiplier 0 jumps straight to the final state. All animation runs
 * as Reanimated worklets on the UI thread (60fps discipline -- no JS-driven
 * layout animation).
 */
import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { flowEasing } from './flowEasing';
import { fadeDuration, moveDuration } from './motionMath';
import { distances, durations, springs } from './tokens';
import { useMotionSettings } from './useMotionSettings';

export interface FadeRiseProps {
  children?: ReactNode;
  /** Delay before the entrance starts, ms (pre-multiplier; Stagger feeds this). */
  delay?: number;
  /** Fade duration, ms (pre-multiplier). */
  durationMs?: number;
  /** Vertical travel in dp. */
  distance?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FadeRise({
  children,
  delay = 0,
  durationMs = durations.gentle,
  distance = distances.rise,
  style,
  testID,
}: FadeRiseProps) {
  const settings = useMotionSettings();
  const fadeMs = fadeDuration(durationMs, settings);
  const delayMs = moveDuration(delay, settings);
  const rise = settings.reduceMotion ? 0 : distance * settings.multiplier;

  const opacity = useSharedValue(fadeMs === 0 ? 1 : 0);
  const translateY = useSharedValue(rise);

  useEffect(() => {
    if (fadeMs === 0) {
      opacity.value = 1;
    } else {
      opacity.value = withDelay(
        delayMs,
        withTiming(1, { duration: fadeMs, easing: flowEasing }),
      );
    }
    if (rise === 0) {
      translateY.value = 0;
    } else {
      translateY.value = withDelay(delayMs, withSpring(0, springs.movement));
    }
    // Mount-only entrance by design (P9-2 item 6: no re-animate on scroll
    // or re-render); the values captured at mount are the ones that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View testID={testID} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
