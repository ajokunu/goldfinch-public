/**
 * LoadingPulse -- the loading-skeleton breathe (PHASE9-DECISIONS P9-1):
 * children loop opacity rest -> 1 -> rest on a symmetric eased timing,
 * entirely as a UI-thread worklet (60fps discipline; one animated node per
 * skeleton group, not per block).
 *
 * Kill-switch contract: reduced motion / multiplier 0 hold a static rest
 * opacity with no loop -- the skeleton blocks themselves remain the loading
 * feedback (P9-1: reduction never disables state feedback, it removes the
 * decoration). The repeat is cancelled on unmount and whenever the effective
 * duration changes.
 */
import { useEffect, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { moveDuration } from './motionMath';
import { durations, SKELETON_REST_OPACITY } from './tokens';
import { useMotionSettings } from './useMotionSettings';

export interface LoadingPulseProps {
  children?: ReactNode;
  /** One half-cycle (rest -> peak), ms (pre-multiplier). */
  durationMs?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const breatheEasing = Easing.inOut(Easing.ease);

export function LoadingPulse({
  children,
  durationMs = durations.skeletonPulse,
  style,
  testID,
}: LoadingPulseProps) {
  const settings = useMotionSettings();
  const halfMs = moveDuration(durationMs, settings);
  const opacity = useSharedValue(SKELETON_REST_OPACITY);

  useEffect(() => {
    if (halfMs === 0) {
      // Reduced motion / kill switch: static blocks still read as loading.
      opacity.value = SKELETON_REST_OPACITY;
      return undefined;
    }
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: halfMs, easing: breatheEasing }),
        withTiming(SKELETON_REST_OPACITY, {
          duration: halfMs,
          easing: breatheEasing,
        }),
      ),
      -1,
    );
    return () => {
      cancelAnimation(opacity);
      opacity.value = SKELETON_REST_OPACITY;
    };
  }, [halfMs, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View testID={testID} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
