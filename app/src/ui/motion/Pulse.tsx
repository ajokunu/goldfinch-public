/**
 * Pulse -- the restrained 100%-crossing flash (PHASE9-DECISIONS P9-2 item
 * 7): an absolute-fill overlay that breathes the category color once (rise
 * 30% / decay 70%, low peak opacity) when `trigger` changes. The overlay is
 * reinforcement, not state: the over-budget recolor and Flame icon survive
 * without it, so reduced motion / multiplier 0 simply skip the flash.
 *
 * Render it as the LAST child of a relatively-positioned container (every
 * plain RN View). pointerEvents="none" -- it can never eat a tap.
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { PULSE_PEAK_OPACITY, pulseInMs, pulseOutMs } from './delightMath';
import { flowEasing } from './flowEasing';
import { moveDuration } from './motionMath';
import { durations } from './tokens';
import { useMotionSettings } from './useMotionSettings';

export interface PulseProps {
  /** Flash color (the crossing category's presentation color). */
  color: string;
  /**
   * Fire key: each NEW non-null value plays one pulse. null never fires;
   * the value present on mount never fires (no pulse for rows that are
   * already over budget when the screen opens).
   */
  trigger: number | string | null;
  /** Total pulse duration, ms (pre-multiplier). */
  durationMs?: number;
  /** Match the host card's radius so the flash hugs its silhouette. */
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Pulse({
  color,
  trigger,
  durationMs = durations.pulse,
  borderRadius,
  style,
  testID,
}: PulseProps) {
  const settings = useMotionSettings();
  const opacity = useSharedValue(0);
  const lastTrigger = useRef(trigger);

  useEffect(() => {
    if (trigger === lastTrigger.current) return;
    lastTrigger.current = trigger;
    if (trigger === null) return;
    const inMs = moveDuration(pulseInMs(durationMs), settings);
    const outMs = moveDuration(pulseOutMs(durationMs), settings);
    if (inMs === 0 && outMs === 0) return; // reduced motion / kill switch
    opacity.value = 0;
    opacity.value = withSequence(
      withTiming(PULSE_PEAK_OPACITY, { duration: inMs, easing: flowEasing }),
      withTiming(0, { duration: outMs, easing: flowEasing }),
    );
  }, [trigger, durationMs, opacity, settings]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      pointerEvents="none"
      testID={testID}
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: color, borderRadius },
        style,
        animatedStyle,
      ]}
    />
  );
}
