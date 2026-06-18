/**
 * RefreshMark -- the pull-to-refresh goldfinch (PHASE9-DECISIONS P9-2 item
 * 7): while a refresh is in flight the mark silhouette fades in and dips /
 * lifts on a slow loop, then fades out when the refetch settles. The shape
 * is the pure goldfinchMark path handed to Skia ONCE per size -- no asset
 * decode, no per-frame path math.
 *
 * The mark is the refresh indicator (state feedback), so reduced motion
 * keeps a static mark visible for the duration (fast fade in/out, no bob);
 * only the bob is movement and dies with the kill switches. Native-only:
 * web has no pull gesture and no CanvasKit runtime, so web renders nothing.
 */
import { useEffect, useMemo, useState } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, Path } from '@shopify/react-native-skia';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { flowEasing } from './flowEasing';
import { goldfinchMarkPath } from './goldfinchMark';
import { fadeDuration, moveDuration } from './motionMath';
import { distances, durations } from './tokens';
import { useMotionSettings } from './useMotionSettings';

export interface RefreshMarkProps {
  /** True while the refresh is in flight. */
  active: boolean;
  /** Mark color (callers pass the theme accent). */
  color: string;
  /** Square box edge in dp. */
  size?: number;
  /** Position the overlay (e.g. absolute top-center over the scroll). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function RefreshMark({
  active,
  color,
  size = 30,
  style,
  testID,
}: RefreshMarkProps) {
  const settings = useMotionSettings();
  const [mounted, setMounted] = useState(active);
  const opacity = useSharedValue(0);
  const bob = useSharedValue(0);
  const path = useMemo(() => goldfinchMarkPath(size), [size]);

  const fadeMs = fadeDuration(durations.fast, settings);
  const bobMs = moveDuration(durations.refreshBob, settings);

  useEffect(() => {
    if (active) {
      setMounted(true);
      opacity.value =
        fadeMs === 0
          ? 1
          : withTiming(1, { duration: fadeMs, easing: flowEasing });
      if (bobMs > 0) {
        // Dip/lift: start lifted, yoyo through the dip forever.
        bob.value = -distances.refreshBob;
        bob.value = withRepeat(
          withTiming(distances.refreshBob, {
            duration: bobMs,
            easing: flowEasing,
          }),
          -1,
          true,
        );
      } else {
        bob.value = 0; // reduced motion: static mark, feedback survives
      }
      return;
    }
    cancelAnimation(bob);
    bob.value = 0;
    if (fadeMs === 0) {
      opacity.value = 0;
      setMounted(false);
      return;
    }
    opacity.value = withTiming(
      0,
      { duration: fadeMs, easing: flowEasing },
      (finished) => {
        'worklet';
        // Unmount only when the fade-out ran to completion; a re-activation
        // cancels it and remounts via the branch above.
        if (finished === true) runOnJS(setMounted)(false);
      },
    );
  }, [active, bob, bobMs, fadeMs, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: bob.value }],
  }));

  // Web: no pull gesture exists and Skia's CanvasKit runtime is not loaded.
  if (Platform.OS === 'web' || !mounted) return null;

  return (
    <Animated.View pointerEvents="none" testID={testID} style={[style, animatedStyle]}>
      <Canvas style={{ width: size, height: size }}>
        <Path path={path} color={color} style="fill" />
      </Canvas>
    </Animated.View>
  );
}
