/**
 * Pure math for the P9-2 item 7 "earned moments": particle-burst kinematics
 * (goal completion), the restrained budget 100%-crossing pulse envelope, and
 * the success-checkmark draw-on geometry.
 *
 * No react-native / reanimated imports -- node:test target. The per-frame
 * functions carry the 'worklet' directive (a plain directive string, inert
 * under node) so the Reanimated plugin can run them on the UI thread inside
 * useDerivedValue (P9-1 60fps discipline: no JS-thread frame math).
 */

/** One burst particle's immutable launch parameters. */
export interface BurstParticle {
  /** Launch direction in radians (0 = right, PI/2 = down in screen space). */
  angle: number;
  /** Launch speed as a fraction of the burst radius, in (0, 1]. */
  velocity: number;
  /** Dot radius as a fraction of the canvas' smaller side. */
  size: number;
  /** Index into the caller's palette (already wrapped to paletteSize). */
  colorIndex: number;
}

/** Downward pull applied over the normalized burst timeline. */
export const BURST_GRAVITY = 0.55;

/** Default particle count for a goal-completion burst. */
export const BURST_PARTICLE_COUNT = 18;

/**
 * Deterministic 32-bit PRNG (mulberry32). Seeded bursts make the particle
 * field reproducible in tests; visually the seed varies per trigger.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable numeric seed for a burst trigger key (number passes through). */
export function seedFromKey(key: number | string): number {
  if (typeof key === 'number' && Number.isFinite(key)) {
    return Math.abs(Math.trunc(key)) >>> 0;
  }
  const text = String(key);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

/**
 * Build the launch parameters for one burst. Angles cover the full circle
 * with jitter so the burst reads organic but never clumps; color indexes
 * cycle the palette so every category color appears.
 */
export function burstParticles(
  count: number,
  paletteSize: number,
  seed: number,
): BurstParticle[] {
  const safeCount =
    Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const safePalette =
    Number.isFinite(paletteSize) && paletteSize > 0
      ? Math.floor(paletteSize)
      : 1;
  const random = mulberry32(seed);
  const particles: BurstParticle[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    const slice = (Math.PI * 2) / safeCount;
    particles.push({
      angle: slice * i + (random() - 0.5) * slice,
      velocity: 0.45 + random() * 0.55,
      size: 0.02 + random() * 0.025,
      colorIndex: i % safePalette,
    });
  }
  return particles;
}

/** Burst easing: strongly decelerating, matching the roll curve family. */
export function burstEase(t: number): number {
  'worklet';
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const inverted = 1 - clamped;
  return 1 - inverted * inverted * inverted;
}

/** Horizontal offset at normalized time t, as a fraction of burst radius. */
export function burstOffsetX(particle: BurstParticle, t: number): number {
  'worklet';
  return Math.cos(particle.angle) * particle.velocity * burstEase(t);
}

/**
 * Vertical offset at normalized time t (screen-space: positive is down).
 * Radial travel plus gravity so particles arc and settle, never just expand.
 */
export function burstOffsetY(particle: BurstParticle, t: number): number {
  'worklet';
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return (
    Math.sin(particle.angle) * particle.velocity * burstEase(t) +
    BURST_GRAVITY * clamped * clamped
  );
}

/** Particle opacity: full until 55% of the timeline, then fades to 0. */
export function burstAlpha(t: number): number {
  'worklet';
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  if (clamped <= 0.55) return 1;
  // (1 - t) form is exact at the endpoint (t = 1 -> 0/0.45 -> 0); the
  // subtract-then-divide form leaves binary floating-point dust there.
  const faded = (1 - clamped) / 0.45;
  return faded < 0 ? 0 : faded > 1 ? 1 : faded;
}

/** Particle scale: pops in over the first 12%, then shrinks toward 35%. */
export function burstScale(t: number): number {
  'worklet';
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  if (clamped < 0.12) return clamped / 0.12;
  return 1 - 0.65 * ((clamped - 0.12) / 0.88);
}

/**
 * Restrained pulse envelope (P9-2 item 7: budget 100% crossing). Peak
 * opacity stays deliberately low -- the pulse reinforces the over-budget
 * recolor, it never carries the state by itself.
 */
export const PULSE_PEAK_OPACITY = 0.24;

/** Rise leg of the pulse: 30% of the total duration. */
export function pulseInMs(totalMs: number): number {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0;
  return Math.round(totalMs * 0.3);
}

/** Decay leg of the pulse: the remaining 70%. */
export function pulseOutMs(totalMs: number): number {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return 0;
  return Math.round(totalMs) - pulseInMs(totalMs);
}

/** Stroke geometry for the success checkmark draw-on (P9-2 item 7). */
export interface CheckGeometry {
  /** SVG path data: two strokes through the three checkmark points. */
  d: string;
  /** Exact polyline length -- the dash array/offset for the draw-on. */
  length: number;
}

/**
 * Checkmark polyline inside a size x size box: short leg down-right, long
 * leg up-right. Length is exact (two hypotenuses), so strokeDashoffset can
 * sweep length -> 0 to draw the mark on.
 */
export function checkmarkGeometry(size: number): CheckGeometry {
  const safe = Number.isFinite(size) && size > 0 ? size : 0;
  // Round to 2 decimals: keeps the path data short and free of binary
  // floating-point dust (0.55 * 100 = 55.00000000000001).
  const at = (fraction: number) => Math.round(fraction * safe * 100) / 100;
  const x1 = at(0.2);
  const y1 = at(0.55);
  const x2 = at(0.42);
  const y2 = at(0.75);
  const x3 = at(0.8);
  const y3 = at(0.3);
  const length =
    Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
  return {
    d: `M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3}`,
    length,
  };
}
