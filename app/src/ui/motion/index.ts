/**
 * The GoldFinch motion module (PHASE9-DECISIONS P9-1/P9-3).
 *
 * Feature code consumes MOTION EXCLUSIVELY through this barrel -- no ad-hoc
 * Animated / Reanimated code in features. Every primitive here respects the
 * OS reduced-motion flag, the Settings "Reduce animations" override, and the
 * global MOTION_MULTIPLIER kill switch via useMotionSettings().
 */
export {
  distances,
  durations,
  EASE_FLOW,
  MOTION_MULTIPLIER,
  PRESS_OPACITY_REDUCED,
  PRESS_SCALE,
  REDUCED_FADE_MS,
  SKELETON_REST_OPACITY,
  springs,
  stagger,
} from './tokens';
export {
  clampFraction,
  clampMultiplier,
  fadeDuration,
  moveDuration,
  resolveMotionSettings,
  resolveReduceMotion,
  staggerChildDelayMs,
  type MotionSettings,
} from './motionMath';
export {
  themeTransitionCss,
  THEME_TRANSITION_PROPERTIES,
} from './themeCrossfadeMath';
export { flowEasing, rollEasing } from './flowEasing';
export { useMotionSettings } from './useMotionSettings';
export {
  useThemeCrossfade,
  THEME_CROSSFADE_OVERLAY_TEST_ID,
  type ThemeCrossfade,
} from './useThemeCrossfade';
export { FadeRise, type FadeRiseProps } from './FadeRise';
export { Stagger, type StaggerProps } from './Stagger';
export { CountUp, type CountUpProps } from './CountUp';
export { PressableScale, type PressableScaleProps } from './PressableScale';
export { Crossfade, type CrossfadeProps } from './Crossfade';
export { SpringFill, type SpringFillProps } from './SpringFill';
export {
  buildStackTransition,
  buildTabTransition,
  useStackTransition,
  useTabTransition,
  type StackTransitionOptions,
  type TabTransitionOptions,
} from './navigationMotion';
export {
  NATIVE_SHARED_ELEMENTS_ENABLED,
  nativeSharedElementsAvailable,
  SharedMark,
  type SharedMarkProps,
} from './SharedMark';
export { ParticleBurst, type ParticleBurstProps } from './ParticleBurst';
export { Pulse, type PulseProps } from './Pulse';
export { LoadingPulse, type LoadingPulseProps } from './LoadingPulse';
export { CheckDraw, type CheckDrawProps } from './CheckDraw';
export { RefreshMark, type RefreshMarkProps } from './RefreshMark';
export { useHaptics, type MotionHaptics } from './haptics';
export {
  burstAlpha,
  burstEase,
  burstOffsetX,
  burstOffsetY,
  burstParticles,
  burstScale,
  BURST_GRAVITY,
  BURST_PARTICLE_COUNT,
  checkmarkGeometry,
  mulberry32,
  PULSE_PEAK_OPACITY,
  pulseInMs,
  pulseOutMs,
  seedFromKey,
  type BurstParticle,
  type CheckGeometry,
} from './delightMath';
export { goldfinchMarkPath } from './goldfinchMark';
