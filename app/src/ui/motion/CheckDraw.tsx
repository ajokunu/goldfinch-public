/**
 * CheckDraw -- the success checkmark draw-on (PHASE9-DECISIONS P9-2 item 7):
 * after a categorize/save lands, the confirmation check strokes itself on
 * over durations.checkDraw (400ms) via the strokeDashoffset sweep.
 *
 * Unlike the burst/pulse this IS state feedback (P9-1: feedback survives
 * reduced motion), so it never disappears: reduced motion collapses the
 * sweep to a fast draw and multiplier 0 renders the finished mark
 * immediately. SVG + Reanimated animated props; no Skia needed for two
 * line segments.
 */
import { useEffect, useMemo } from 'react';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { checkmarkGeometry } from './delightMath';
import { flowEasing } from './flowEasing';
import { fadeDuration } from './motionMath';
import { durations } from './tokens';
import { useMotionSettings } from './useMotionSettings';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface CheckDrawProps {
  /** Square box edge in dp. */
  size?: number;
  /** Stroke color (callers pass the on-accent token). */
  color: string;
  strokeWidth?: number;
  /** Draw-on duration, ms (pre-multiplier). */
  durationMs?: number;
  testID?: string;
}

export function CheckDraw({
  size = 16,
  color,
  strokeWidth = 2.3,
  durationMs = durations.checkDraw,
  testID,
}: CheckDrawProps) {
  const settings = useMotionSettings();
  const geometry = useMemo(() => checkmarkGeometry(size), [size]);
  const drawMs = fadeDuration(durationMs, settings);

  // Mount-only draw-on (the mark draws once per appearance); 0 = finished.
  const progress = useSharedValue(drawMs === 0 ? 1 : 0);
  useEffect(() => {
    if (drawMs === 0) {
      progress.value = 1;
      return;
    }
    progress.value = withTiming(1, { duration: drawMs, easing: flowEasing });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: geometry.length * (1 - progress.value),
  }));

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      testID={testID}
    >
      <AnimatedPath
        d={geometry.d}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={`${geometry.length} ${geometry.length}`}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}
