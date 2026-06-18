/**
 * The runtime side of the motion kill-switch contract (PHASE9-DECISIONS
 * P9-3): OS reduced motion (existing kit hook) + the persisted Settings
 * "Reduce animations" override, resolved through the pure motionMath rules.
 *
 * Every primitive in this folder calls this hook; feature code that consumes
 * the primitives therefore respects both switches for free. Feature code
 * needing a bespoke decision (rare; prefer primitives) may call it directly.
 */
import { useMemo } from 'react';

import { useUiStore } from '../../state/uiStore';
import { useReducedMotion } from '../useReducedMotion';
import { resolveMotionSettings, type MotionSettings } from './motionMath';

export function useMotionSettings(): MotionSettings {
  const osReduced = useReducedMotion();
  const override = useUiStore((state) => state.reduceAnimations);
  return useMemo(
    () => resolveMotionSettings(osReduced, override),
    [osReduced, override],
  );
}
