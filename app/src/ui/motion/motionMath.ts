/**
 * Pure motion math (PHASE9-DECISIONS P9-3): resolves the effective motion
 * settings from the OS reduced-motion flag + the persisted Settings override,
 * and scales durations / stagger delays by the global multiplier.
 *
 * Every primitive in this folder routes its timing through these functions,
 * which is what makes the kill-switch contract enforceable: reduced motion
 * (either source) zeroes movement and collapses fades to REDUCED_FADE_MS;
 * MOTION_MULTIPLIER = 0 zeroes everything.
 *
 * No react-native / reanimated imports -- node:test + StrykerJS target.
 */
import { MOTION_MULTIPLIER, REDUCED_FADE_MS } from './tokens';

export interface MotionSettings {
  /** Effective reduced-motion flag (OS setting overridden by the store). */
  reduceMotion: boolean;
  /**
   * Effective duration/delay multiplier: 0 when motion is reduced or the
   * global kill switch is thrown, otherwise the (clamped) global multiplier.
   */
  multiplier: number;
}

/**
 * The Settings "Reduce animations" toggle mirrors the OS until the user
 * overrides it: null = follow the OS flag, boolean = explicit override.
 */
export function resolveReduceMotion(
  osReduced: boolean,
  storeOverride: boolean | null,
): boolean {
  return storeOverride ?? osReduced;
}

/** Clamp a multiplier to a sane [0, 4] band; junk (NaN/negative) reads as 0. */
export function clampMultiplier(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, 4);
}

/**
 * Clamp a progress fraction to [0, 1]; junk (NaN/Infinity/negative) reads as
 * 0. SpringFill routes its target through this so an over-limit budget
 * (spent > limit) parks the fill at the full bar, never past it.
 */
export function clampFraction(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, 1);
}

/** Clamp a millisecond quantity: junk and negatives read as 0. */
function clampMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms;
}

/**
 * Resolve the effective settings every primitive consumes (exposed to React
 * via useMotionSettings). `baseMultiplier` defaults to the global token so
 * the kill switch is honored everywhere; it is injectable for tests.
 */
export function resolveMotionSettings(
  osReduced: boolean,
  storeOverride: boolean | null,
  baseMultiplier: number = MOTION_MULTIPLIER,
): MotionSettings {
  const reduceMotion = resolveReduceMotion(osReduced, storeOverride);
  return {
    reduceMotion,
    multiplier: reduceMotion ? 0 : clampMultiplier(baseMultiplier),
  };
}

/**
 * Effective duration for an opacity/color fade. Reduced motion collapses to
 * a fast fade (never longer than REDUCED_FADE_MS, never disabled -- P9-1
 * "state feedback survives"); otherwise the multiplier scales the token.
 */
export function fadeDuration(ms: number, settings: MotionSettings): number {
  const base = clampMs(ms);
  if (settings.reduceMotion) return Math.min(base, REDUCED_FADE_MS);
  return Math.round(base * clampMultiplier(settings.multiplier));
}

/**
 * Effective duration for movement (transforms, digit rolls, layout travel).
 * Reduced motion eliminates movement entirely: values jump to final state.
 */
export function moveDuration(ms: number, settings: MotionSettings): number {
  if (settings.reduceMotion) return 0;
  return Math.round(clampMs(ms) * clampMultiplier(settings.multiplier));
}

/**
 * Raw stagger delay for the child at `index` (before settings are applied --
 * FadeRise scales the delay it receives through moveDuration, so Stagger
 * hands it pre-multiplier values). Junk indexes/intervals clamp to 0.
 */
export function staggerChildDelayMs(
  index: number,
  intervalMs: number,
  initialDelayMs = 0,
): number {
  const safeIndex =
    Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  return Math.round(clampMs(initialDelayMs) + safeIndex * clampMs(intervalMs));
}
