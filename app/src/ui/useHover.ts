/**
 * Kit-wide hover system (P8-1, ops/PHASE8-DECISIONS.md): every interactive
 * surface gets ONE consistent web hover treatment -- background shifts one
 * step toward `surfaceAlt`, 120ms ease, pointer cursor -- implemented here
 * once and consumed by the kit primitives (ListRow, Card-with-onPress,
 * IconButton, Segmented) and the feature row components. Native is untouched:
 * the hook is inert off web (hover events only exist on pointer devices) and
 * the returned props/styles collapse to no-ops.
 *
 * Reduced motion keeps the highlight but drops the transition (the background
 * still changes, instantly), per the decision text.
 */
import { useCallback, useMemo, useState } from 'react';
import { Platform, type ViewStyle } from 'react-native';

import { mixColor } from './mixColor';
import { distances, durations } from './motion/tokens';
import type { Theme } from './theme';

/** Hover background shift duration (PHASE8-DECISIONS P8-1). */
export const HOVER_DURATION_MS = 120;

/** Web hover card lift travel + duration (PHASE9-DECISIONS P9-2 item 5),
 *  sourced from the motion tokens so the values stay single-sourced. */
export const HOVER_LIFT_DISTANCE = distances.hoverLift;
export const HOVER_LIFT_DURATION_MS = durations.hover;

export interface HoverProps {
  onHoverIn?: () => void;
  onHoverOut?: () => void;
}

export interface UseHoverResult {
  /** True only on web while the pointer is over the surface. */
  hovered: boolean;
  /** Spread onto a Pressable/View; empty off web or when disabled. */
  hoverProps: HoverProps;
}

/**
 * Tracks pointer hover on web. Off web (or when `enabled` is false --
 * disabled controls must not highlight) the result is inert: `hovered` stays
 * false and no handlers are attached, so native render output is unchanged.
 */
export function useHover(enabled = true): UseHoverResult {
  const [hovered, setHovered] = useState(false);
  const active = Platform.OS === 'web' && enabled;

  const onHoverIn = useCallback(() => setHovered(true), []);
  const onHoverOut = useCallback(() => setHovered(false), []);

  const hoverProps = useMemo<HoverProps>(
    () => (active ? { onHoverIn, onHoverOut } : {}),
    [active, onHoverIn, onHoverOut],
  );

  return { hovered: active && hovered, hoverProps };
}

/**
 * THE hover background rule (single source): one step toward `surfaceAlt`.
 * Transparent/unset resting backgrounds land on `surfaceAlt` itself; opaque
 * surfaces blend halfway. `mixColor` is defensive on malformed input
 * ('transparent' is not hex), so this never throws on live theme data.
 */
export function hoverBackground(theme: Theme, restingColor?: string): string {
  if (restingColor === undefined || restingColor === 'transparent') {
    return theme.colors.surfaceAlt;
  }
  if (restingColor === theme.colors.surfaceAlt) {
    // Already resting on surfaceAlt (segmented track, circle icon button):
    // step toward the raised surface instead so the highlight stays visible.
    return mixColor(theme.colors.surface, 0.5, restingColor);
  }
  return mixColor(theme.colors.surfaceAlt, 0.5, restingColor);
}

/**
 * Persistent transition + cursor styles for a hoverable surface. Applied
 * unconditionally (not only while hovered) so the background animates both
 * in AND out; reduced motion drops the transition entirely (instant change).
 * Returns null off web -- native styles carry no web-only properties.
 */
export function hoverTransitionStyle(reduced: boolean): ViewStyle | null {
  if (Platform.OS !== 'web') return null;
  const style: Record<string, unknown> = { cursor: 'pointer' };
  if (!reduced) {
    style['transitionProperty'] = 'background-color';
    style['transitionDuration'] = `${HOVER_DURATION_MS}ms`;
    style['transitionTimingFunction'] = 'ease';
  }
  return style as ViewStyle;
}

/**
 * Card-grade hover transitions (PHASE9-DECISIONS P9-2 item 5): the P8
 * background shift PLUS transform (the -2dp lift) and box-shadow (the deepen)
 * at the 160ms hover duration. Applied unconditionally on web like
 * hoverTransitionStyle so the lift animates both in AND out; reduced motion
 * keeps only the cursor (the highlight still switches, instantly, and the
 * lift itself is suppressed by hoverLiftStyle).
 */
export function hoverLiftTransitionStyle(reduced: boolean): ViewStyle | null {
  if (Platform.OS !== 'web') return null;
  const style: Record<string, unknown> = { cursor: 'pointer' };
  if (!reduced) {
    style['transitionProperty'] = 'background-color, transform, box-shadow';
    style['transitionDuration'] =
      `${HOVER_DURATION_MS}ms, ${HOVER_LIFT_DURATION_MS}ms, ${HOVER_LIFT_DURATION_MS}ms`;
    style['transitionTimingFunction'] = 'ease';
  }
  return style as ViewStyle;
}

/**
 * The lift itself: translateY(-2dp) while hovered, web only. Reduced motion
 * eliminates movement (P9-1) -- the P8 background highlight remains the
 * hover state feedback -- and native renders are untouched.
 */
export function hoverLiftStyle(
  hovered: boolean,
  reduced: boolean,
): ViewStyle | null {
  if (Platform.OS !== 'web' || reduced || !hovered) return null;
  return { transform: [{ translateY: -HOVER_LIFT_DISTANCE }] };
}
