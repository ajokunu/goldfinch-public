/**
 * SpringFill -- the spring-to-width progress fill (PHASE9-DECISIONS P9-2
 * item 4): budget progress bars grow to their fraction on the `emphasized`
 * spring token (the slightly underdamped "~6% overshoot" feel) on mount and
 * again whenever the fraction changes.
 *
 * 60fps discipline: the fill is a full-width layer translated on the UI
 * thread (transform only -- no width/layout animation), clipped by the
 * track's overflow:hidden, so a screen of budget rows animates without
 * touching the JS thread. Overshoot past fraction 1 is clipped by the same
 * overflow, which is exactly the designed "snaps past full, settles back"
 * read on a maxed bar.
 *
 * Kill-switch contract: reduced motion (OS or Settings override) or
 * multiplier 0 parks the fill at its final fraction immediately -- the bar
 * still communicates state, it just never moves (P9-1).
 */
import { useEffect, useState } from 'react';
import {
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { clampFraction } from './motionMath';
import { springs } from './tokens';
import { useMotionSettings } from './useMotionSettings';

export interface SpringFillProps {
  /** Target fill fraction; clamped to [0, 1] (over-limit parks at full). */
  fraction: number;
  /** Fill color (the consumer owns the over-limit color switch). */
  color: string;
  /** Bar height in dp; also drives the pill radius. */
  height: number;
  /** Track (background) color behind the fill. */
  trackColor: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SpringFill({
  fraction,
  color,
  height,
  trackColor,
  style,
  testID,
}: SpringFillProps) {
  const settings = useMotionSettings();
  const target = clampFraction(fraction);
  const [trackWidth, setTrackWidth] = useState(0);

  // Movement is killed under reduced motion / multiplier 0: the fill mounts
  // at its final fraction instead of springing up from empty.
  const animate = !settings.reduceMotion && settings.multiplier > 0;
  const progress = useSharedValue(animate ? 0 : target);

  useEffect(() => {
    if (animate) {
      progress.value = withSpring(target, springs.emphasized);
    } else {
      progress.value = target;
    }
  }, [animate, progress, target]);

  const fillStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateX: (progress.value - 1) * trackWidth }],
    }),
    [trackWidth],
  );

  const radius = height / 2;
  return (
    <View
      testID={testID}
      onLayout={(event: LayoutChangeEvent) =>
        setTrackWidth(Math.round(event.nativeEvent.layout.width))
      }
      style={[
        {
          height,
          borderRadius: radius,
          backgroundColor: trackColor,
          overflow: 'hidden',
          width: '100%',
        },
        style,
      ]}
    >
      {/* Rendered only after the first layout pass: translating against an
          unmeasured width would flash the fill at full before springing. */}
      {trackWidth > 0 ? (
        <Animated.View
          testID={testID !== undefined ? `${testID}-fill` : undefined}
          style={[
            {
              width: '100%',
              height,
              borderRadius: radius,
              backgroundColor: color,
            },
            fillStyle,
          ]}
        />
      ) : null}
    </View>
  );
}
