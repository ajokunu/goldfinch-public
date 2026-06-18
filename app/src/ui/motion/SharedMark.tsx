/**
 * SharedMark -- shared-element continuity (PHASE9-DECISIONS P9-2 item 3).
 *
 * Marks the destination anchor of a cross-screen identity (account row ->
 * account detail header, spending category row -> transactions category
 * chip). Two implementation paths exist by decision:
 *
 * 1. NATIVE (flagged, behind NATIVE_SHARED_ELEMENTS_ENABLED): Reanimated's
 *    shared element transitions. ATTEMPTED 2026-06-11 and NOT SHIPPABLE:
 *    Reanimated 4.x (4.1.7 installed; New-Architecture-only) removed the
 *    experimental `sharedTransitionTag` / `SharedTransition` API that 3.x
 *    carried -- the symbols do not exist in the package, so the native path
 *    cannot compile, let alone run, on either platform. The runtime probe
 *    below keeps reporting availability honestly so a future Reanimated that
 *    restores the API flips the log from "unavailable" to "not wired".
 * 2. MIMIC (the decisions-doc fallback, SHIPPED): coordinated FadeRise that
 *    mimics continuity -- the marked anchor appears in place immediately
 *    (fast fade, zero travel) while the rest of the destination screen
 *    cascades in behind it, so the eye reads the anchor as the element that
 *    traveled.
 *
 * Kill-switch contract: inherited from FadeRise (reduced motion -> fast
 * fade, multiplier 0 -> instant).
 */
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { logger } from '../../lib/logger';
import { FadeRise } from './FadeRise';
import { durations } from './tokens';

const log = logger.child({ component: 'SharedMark' });

/**
 * Our own kill switch for the native shared-element path (P9-2 item 3:
 * "flagged feature; ship behind our own kill-switch"). MUST stay false while
 * the installed Reanimated has no shared-element API; flipping it only
 * produces a logged warning and the mimic path -- never a crash.
 */
export const NATIVE_SHARED_ELEMENTS_ENABLED: boolean = false;

/**
 * Honest runtime probe for the Reanimated shared-element API. Reanimated 4
 * removed it; if a future upgrade restores `SharedTransition`, this starts
 * returning true and the warning below changes meaning (wired vs available).
 */
export function nativeSharedElementsAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const reanimated = require('react-native-reanimated') as Record<
      string,
      unknown
    >;
    return reanimated['SharedTransition'] !== undefined;
  } catch (error) {
    log.warn('reanimated probe failed; assuming no shared-element support', {
      error,
    });
    return false;
  }
}

let warnedNativeUnavailable = false;

export interface SharedMarkProps {
  /**
   * Stable identity of the traveling element (e.g. `account-<id>`). Unused
   * by the mimic path, but part of the contract so call sites are already
   * tagged if the native path ever ships.
   */
  tag: string;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SharedMark({ tag, children, style, testID }: SharedMarkProps) {
  if (NATIVE_SHARED_ELEMENTS_ENABLED && !warnedNativeUnavailable) {
    warnedNativeUnavailable = true;
    log.warn(
      nativeSharedElementsAvailable()
        ? 'native shared elements flagged on and the API is present, but the native path is not wired; using the FadeRise mimic'
        : 'native shared elements flagged on but the installed Reanimated has no shared-element API; using the FadeRise mimic',
      { tag },
    );
  }
  // Mimic path (shipped): in-place fast fade -- the anchor lands first while
  // sibling content cascades in with staggered FadeRises behind it.
  return (
    <FadeRise
      durationMs={durations.fast}
      distance={0}
      style={style}
      testID={testID ?? `shared-mark-${tag}`}
    >
      {children}
    </FadeRise>
  );
}
