/**
 * Shared one-shot entrance animation for the chart primitives (charts.md 9).
 *
 * Returns a 0 -> 1 Animated.Value driven LINEARLY over CHART_ENTRANCE_MS;
 * each primitive derives its specific treatment (dash draw, fades, bar
 * growth, ring sweep) by interpolating a sub-range of the master value with
 * its own easing -- that is how the prototype's per-element delays and cubic
 * beziers translate without one Animated clock per element.
 *
 * Governing rule (preserved from the prototype): THE RESTING STATE IS THE
 * FULLY VISIBLE CHART. Animations run from hidden to visible; with reduced
 * motion the value is pinned to 1 immediately, and on any failure of the
 * reduce-motion query we log and animate anyway (a safe default), so data is
 * never hidden behind a paused animation.
 *
 * - `animationKey` replays the entrance when it changes (prototype animKey:
 *   range toggles on the net-worth card / reports window).
 * - `ready` defers the first run until the caller's width measurement
 *   succeeds (charts render nothing at width 0; starting the clock before
 *   the first layout pass would eat the entrance).
 *
 * `useNativeDriver: false`: SVG props are not native-driver animatable;
 * these are short one-shot entrances on screens with at most three charts,
 * measured acceptable on the JS thread (charts.md 9.1).
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

import { logger } from '../../lib/logger';

/**
 * Master timeline length: the longest prototype entrance (line draw 100ms
 * delay + 1000ms, ring 150ms delay + 1100ms, both ending at 1250ms). Shorter
 * treatments (bars/donut/flow at 600ms) interpolate the early sub-range and
 * clamp at their final value for the remainder.
 */
export const CHART_ENTRANCE_MS = 1250;

export function useChartEntrance(
  animationKey?: string | number,
  ready = true,
): Animated.Value {
  const progressRef = useRef<Animated.Value | null>(null);
  if (progressRef.current === null) {
    progressRef.current = new Animated.Value(0);
  }
  const progress = progressRef.current;

  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled && enabled) setReduceMotion(true);
      })
      .catch((error: unknown) => {
        logger.warn('reduce-motion query failed; animating by default', {
          error,
        });
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => setReduceMotion(enabled),
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    if (reduceMotion) {
      progress.stopAnimation();
      progress.setValue(1);
      return undefined;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: CHART_ENTRANCE_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, ready, reduceMotion, animationKey]);

  return progress;
}
