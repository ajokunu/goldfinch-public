/**
 * Reanimated easing instances built from the pure token control points.
 * Separated from tokens.ts so the token module stays free of react-native
 * imports (node:test harness requirement).
 */
import { Easing } from 'react-native-reanimated';

import { EASE_FLOW } from './tokens';

/** cubic-bezier(.16, 1, .3, 1) -- the P9-1 "flow" curve for fades/color. */
export const flowEasing = Easing.bezier(
  EASE_FLOW[0],
  EASE_FLOW[1],
  EASE_FLOW[2],
  EASE_FLOW[3],
);

/**
 * The CountUp roll curve. Parity with countUpMath.easeOutCubic is asserted
 * by the pure unit tests against literal values of 1 - (1 - t)^3.
 */
export const rollEasing = Easing.out(Easing.cubic);
