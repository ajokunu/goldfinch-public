/**
 * Haptics (PHASE9-DECISIONS P9-2 item 10, fintech restraint): a light tick
 * on categorize/confirm, a medium impact on a goal milestone, NOTHING on
 * navigation. Native-only -- web silently no-ops.
 *
 * Like every Phase 9 effect, haptics sit behind the motion settings: the
 * reduced-motion flag (OS or Settings override) and the multiplier kill
 * switch both zero the effective multiplier, which mutes the engine too --
 * one flag turns the whole sensory layer off. Failures log and are
 * swallowed: a missing vibration motor must never break a save.
 */
import { useMemo } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

import { logger } from '../../lib/logger';
import { useMotionSettings } from './useMotionSettings';

const log = logger.child({ component: 'motion.haptics' });

export interface MotionHaptics {
  /** Light tick: categorize / confirm moments (P9-2 item 10). */
  confirmTick: () => void;
  /** Medium impact: goal milestone moments (P9-2 item 10). */
  milestone: () => void;
}

function fire(style: Haptics.ImpactFeedbackStyle): void {
  Haptics.impactAsync(style).catch((error: unknown) => {
    log.warn('haptic impact failed', { style, error });
  });
}

/**
 * The only sanctioned way to trigger haptics from feature code (mirrors the
 * "primitives only" motion contract): both callbacks respect the platform
 * and the resolved motion settings, so call sites stay branch-free.
 */
export function useHaptics(): MotionHaptics {
  const settings = useMotionSettings();
  const enabled = Platform.OS !== 'web' && settings.multiplier > 0;
  return useMemo(
    () => ({
      confirmTick: () => {
        if (enabled) fire(Haptics.ImpactFeedbackStyle.Light);
      },
      milestone: () => {
        if (enabled) fire(Haptics.ImpactFeedbackStyle.Medium);
      },
    }),
    [enabled],
  );
}
