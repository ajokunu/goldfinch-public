/**
 * PressableScale -- press feedback primitive (PHASE9-DECISIONS P9-1): a
 * Pressable whose content scales to PRESS_SCALE on a snappy damped spring
 * while pressed, driven entirely by a UI-thread worklet.
 *
 * Kill-switch contract (P9-1: reduction "never disables state feedback"):
 * reduced motion swaps the scale for an opacity dim (movement removed,
 * feedback kept); multiplier 0 snaps between states with no spring.
 */
import { useCallback } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { fadeDuration } from './motionMath';
import {
  PRESS_OPACITY_REDUCED,
  PRESS_SCALE,
  REDUCED_FADE_MS,
  springs,
} from './tokens';
import { useMotionSettings } from './useMotionSettings';

export interface PressableScaleProps
  extends Omit<PressableProps, 'style'> {
  /** Pressed-state scale (default PRESS_SCALE). */
  scaleTo?: number;
  /**
   * Static styles only (no Pressable style-function form: the style is owned
   * by the animated wrapper so the worklet can drive it).
   */
  style?: StyleProp<ViewStyle>;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({
  scaleTo = PRESS_SCALE,
  style,
  onPressIn,
  onPressOut,
  ...pressableProps
}: PressableScaleProps) {
  const settings = useMotionSettings();
  const { reduceMotion, multiplier } = settings;
  // 0 = rest, 1 = pressed; the worklet maps it to scale (or opacity when
  // motion is reduced).
  const pressed = useSharedValue(0);

  const animateTo = useCallback(
    (value: 0 | 1) => {
      if (reduceMotion) {
        pressed.value = withTiming(value, {
          duration: fadeDuration(REDUCED_FADE_MS, settings),
        });
      } else if (multiplier <= 0) {
        pressed.value = value;
      } else {
        pressed.value = withSpring(value, springs.press);
      }
    },
    [multiplier, pressed, reduceMotion, settings],
  );

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      animateTo(1);
      onPressIn?.(event);
    },
    [animateTo, onPressIn],
  );

  const handlePressOut = useCallback(
    (event: GestureResponderEvent) => {
      animateTo(0);
      onPressOut?.(event);
    },
    [animateTo, onPressOut],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const progress = pressed.value;
    if (reduceMotion) {
      return {
        opacity: 1 + (PRESS_OPACITY_REDUCED - 1) * progress,
        transform: [{ scale: 1 }],
      };
    }
    return {
      opacity: 1,
      transform: [{ scale: 1 + (scaleTo - 1) * progress }],
    };
  }, [reduceMotion, scaleTo]);

  return (
    <AnimatedPressable
      {...pressableProps}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle]}
    />
  );
}
