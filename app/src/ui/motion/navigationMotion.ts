/**
 * Navigator-level motion (PHASE9-DECISIONS P9-2 item 2): the tab/page switch
 * crossfade + 12px vertical drift, and the More-stack push slide.
 *
 * React Navigation drives these transitions itself (bottom-tabs with the RN
 * Animated native driver on native platforms; react-native-screens native
 * push animations for the stack), so the motion module's job is to BUILD the
 * navigator options from the motion tokens and the kill-switch contract --
 * route layouts spread the result and never hand-roll animation config.
 *
 * Timing translation for the tab switch (180ms out / 240ms in): bottom-tabs
 * animates one progress value per scene (0 = active, +/-1 = inactive) under
 * a single transition spec, so the spec runs the full 240ms "in" duration
 * and the outgoing scene's opacity is interpolated to reach zero at the
 * 180/240 = 0.75 progress point. Both scenes drift |progress| * 12dp, which
 * mirrors the Crossfade primitive's vertical drift.
 *
 * Kill-switch contract (P9-3):
 * - reduced motion (OS or Settings override) -> fast fades (REDUCED_FADE_MS),
 *   zero drift, stack pushes collapse to a fade; state feedback survives.
 * - multiplier 0 -> `animation: 'none'` (values jump to final state).
 *
 * Web note: the bottom-tabs interpolator runs with the JS driver on web (no
 * native driver exists there) and covers the desktop sidebar's content
 * switches, because the sidebar navigates the SAME Tabs navigator. Pushes
 * inside the More stack are not animated by react-native-screens on web; the
 * More layout adds a web-only FadeRise screenLayout for that leg.
 */
import { Easing as AnimatedEasing } from 'react-native';
import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { useMemo } from 'react';

import { fadeDuration, type MotionSettings } from './motionMath';
import { distances, durations, EASE_FLOW, REDUCED_FADE_MS } from './tokens';
import { useMotionSettings } from './useMotionSettings';

/** The flow curve as an RN Animated easing (the navigators run RN Animated). */
const flowEasingAnimated = AnimatedEasing.bezier(
  EASE_FLOW[0],
  EASE_FLOW[1],
  EASE_FLOW[2],
  EASE_FLOW[3],
);

/**
 * Progress fraction at which the OUTGOING scene finishes fading: the 180ms
 * "out" leg of a 240ms switch (P9-2 item 2).
 */
const OUT_COMPLETE_FRACTION = durations.fast / durations.base;

export type TabTransitionOptions = Pick<
  BottomTabNavigationOptions,
  'animation' | 'transitionSpec' | 'sceneStyleInterpolator'
>;

/**
 * Pure builder for the tab-switch crossfade + drift options (injectable
 * settings keep this unit-testable without the hook).
 */
export function buildTabTransition(
  settings: MotionSettings,
): TabTransitionOptions {
  const switchMs = fadeDuration(durations.base, settings);
  if (switchMs <= 0) {
    // Kill switch thrown (multiplier 0, not reduced motion): scenes jump.
    return { animation: 'none' };
  }
  const drift = settings.reduceMotion
    ? 0
    : distances.drift * settings.multiplier;

  return {
    animation: 'fade',
    transitionSpec: {
      animation: 'timing',
      config: { duration: switchMs, easing: flowEasingAnimated },
    },
    sceneStyleInterpolator: ({ current }) => ({
      sceneStyle: {
        // Active scene (progress 0) is opaque; a scene leaving toward +/-1
        // hits zero opacity at the 0.75 progress point (the 180ms out leg).
        opacity: current.progress.interpolate({
          inputRange: [
            -1,
            -OUT_COMPLETE_FRACTION,
            0,
            OUT_COMPLETE_FRACTION,
            1,
          ],
          outputRange: [0, 0, 1, 0, 0],
        }),
        transform: [
          {
            translateY: current.progress.interpolate({
              inputRange: [-1, 0, 1],
              outputRange: [drift, 0, drift],
            }),
          },
        ],
      },
    }),
  };
}

/** Tab-switch options for the Tabs navigator; spread into screenOptions. */
export function useTabTransition(): TabTransitionOptions {
  const settings = useMotionSettings();
  return useMemo(() => buildTabTransition(settings), [settings]);
}

export type StackTransitionOptions = Pick<
  NativeStackNavigationOptions,
  'animation' | 'animationDuration'
>;

/**
 * Pure builder for the More-stack push (P9-2 item 2: "pushes slide with
 * parallax"). `slide_from_right` maps to the platform-native push: UIKit's
 * push on iOS (which under-slides the outgoing screen -- the parallax) and
 * the slide animator on Android. Reduced motion collapses to a fast fade;
 * multiplier 0 disables the transition outright.
 */
export function buildStackTransition(
  settings: MotionSettings,
): StackTransitionOptions {
  if (settings.reduceMotion) {
    return { animation: 'fade', animationDuration: REDUCED_FADE_MS };
  }
  if (settings.multiplier <= 0) {
    return { animation: 'none' };
  }
  return { animation: 'slide_from_right' };
}

/** Stack push options for native stacks; spread into screenOptions. */
export function useStackTransition(): StackTransitionOptions {
  const settings = useMotionSettings();
  return useMemo(() => buildStackTransition(settings), [settings]);
}
