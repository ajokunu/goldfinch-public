/**
 * Motion tokens (PHASE9-DECISIONS P9-1/P9-3): the single source of duration,
 * easing, spring, stagger, and distance values for every motion primitive.
 *
 * This module is deliberately PURE DATA -- no react-native or reanimated
 * imports -- so it compiles into the node:test harness alongside the pure
 * motion math (src/ui/tsconfig.test.json) and so a token change is always a
 * one-file diff. Feature code never reads these directly; it consumes the
 * primitives in this folder, which apply the reduced-motion and multiplier
 * rules from motionMath.ts.
 */

/**
 * Durations in milliseconds, named for intent (P9-1: eased timing lives in
 * the 220-420ms band; the named exceptions come straight from the P9-2 flow
 * inventory).
 */
export const durations = {
  /** Quick state changes; also the page-switch fade-out (P9-2 item 2). */
  fast: 180,
  /** Default fade/in transitions; the page-switch fade-in (P9-2 item 2). */
  base: 240,
  /** Entrance fades (FadeRise) sit at the comfortable middle of the band. */
  gentle: 320,
  /** Upper bound of the band; large surface transitions. */
  slow: 420,
  /** Net-worth / money headline CountUp roll (P9-2 item 1). */
  countUp: 650,
  /** Full-palette theme crossfade (P9-2 item 8). */
  themeCrossfade: 350,
  /** Sheet slide -- matches the existing 460ms bezier slide (P9-2 item 9). */
  sheet: 460,
  /** Web hover lift (P9-2 item 5). */
  hover: 160,
  /** Success checkmark draw-on (P9-2 item 7). */
  checkDraw: 400,
  /** Goal-completion particle burst lifetime (P9-2 item 7). */
  burst: 900,
  /** Budget 100%-crossing pulse, rise + decay (P9-2 item 7). */
  pulse: 700,
  /** One full dip-and-lift of the pull-to-refresh mark (P9-2 item 7). */
  refreshBob: 1100,
  /** Loading-skeleton breathe, one half-cycle (rest -> peak). */
  skeletonPulse: 700,
} as const;

/**
 * The "flow" easing family (P9-1): cubic-bezier(.16, 1, .3, 1) -- a strongly
 * decelerated curve for fades/color. Control points only; primitives build
 * the Reanimated Easing.bezier from these.
 */
export const EASE_FLOW: readonly [number, number, number, number] = [
  0.16, 1, 0.3, 1,
];

/**
 * Spring configs for movement (P9-1: damped, no wild overshoot). Tuned for
 * Reanimated withSpring.
 */
export const springs = {
  /** Entrances and positional travel: settles without visible overshoot. */
  movement: { damping: 26, stiffness: 220, mass: 1 },
  /** Press feedback: snappy, slightly underdamped but visually clean. */
  press: { damping: 22, stiffness: 360, mass: 1 },
  /**
   * Emphasized state changes (budget bars springing to width with ~6%
   * overshoot, P9-2 item 4 -- consumed by later feature work).
   */
  emphasized: { damping: 14, stiffness: 170, mass: 1 },
} as const;

/** Stagger intervals in milliseconds (P9-2 items 1 and 9). */
export const stagger = {
  /** Dashboard card cascade. */
  cascadeMs: 45,
  /** Sheet content following the panel. */
  sheetMs: 60,
} as const;

/** Travel distances in dp. */
export const distances = {
  /** FadeRise vertical travel. */
  rise: 12,
  /** Page/tab switch vertical drift (P9-2 item 2). */
  drift: 12,
  /** Web hover card lift (P9-2 item 5). */
  hoverLift: 2,
  /** Pull-to-refresh mark dip/lift amplitude (P9-2 item 7). */
  refreshBob: 4,
} as const;

/**
 * GLOBAL MULTIPLIER / KILL SWITCH (P9-3): every duration and stagger delay is
 * scaled by this before being handed to the animation driver. 1 = designed
 * motion; 0 = all motion off (values jump to final state). Reduced motion
 * (OS setting or the Settings "Reduce animations" toggle) independently
 * forces the multiplier to 0 at runtime via resolveMotionSettings -- this
 * constant exists so any motion regression is one flag away from off without
 * touching the store.
 */
export const MOTION_MULTIPLIER = 1;

/**
 * Reduced motion collapses transitions to fast fades (P9-1: state feedback
 * is never disabled, movement is). This is the fade length used in that mode.
 */
export const REDUCED_FADE_MS = 80;

/** PressableScale press-in target scale. */
export const PRESS_SCALE = 0.97;

/** Reduced-motion press feedback opacity (state feedback without movement). */
export const PRESS_OPACITY_REDUCED = 0.85;

/**
 * Loading-skeleton opacity band: LoadingPulse breathes rest -> 1 -> rest.
 * Reduced motion / multiplier 0 hold this rest value statically (the skeleton
 * itself is the loading feedback; the breathe is decoration).
 */
export const SKELETON_REST_OPACITY = 0.45;
