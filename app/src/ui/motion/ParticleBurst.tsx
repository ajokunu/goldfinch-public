/**
 * ParticleBurst -- the goal-completion delight moment (PHASE9-DECISIONS
 * P9-2 item 7): a one-shot Skia particle burst in the category palette,
 * overlaid on the celebrating card. Decorative only; it never carries state
 * (the completed ring/label is the surviving feedback), so reduced motion
 * and the multiplier kill switch suppress it entirely.
 *
 * 60fps discipline: one Reanimated progress value drives every particle via
 * useDerivedValue worklets over the pure delightMath kinematics; the JS
 * thread only mounts and unmounts the canvas. Native-only: Skia on web
 * requires the CanvasKit runtime this app does not load, so web renders
 * nothing (web gets no pull gesture for the other Skia moment either).
 */
import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Canvas, Circle } from '@shopify/react-native-skia';
import {
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import {
  burstAlpha,
  burstOffsetX,
  burstOffsetY,
  burstParticles,
  burstScale,
  BURST_PARTICLE_COUNT,
  seedFromKey,
  type BurstParticle,
} from './delightMath';
import { moveDuration } from './motionMath';
import { durations } from './tokens';
import { useMotionSettings } from './useMotionSettings';

export interface ParticleBurstProps {
  /** Palette the burst draws from (category colors, P9-2 item 7). */
  colors: readonly string[];
  /**
   * Fire key: each NEW non-null value fires one burst (mirrors the Pulse
   * contract). null never fires; the initial value never fires.
   */
  trigger: number | string | null;
  particleCount?: number;
  /** Burst lifetime, ms (pre-multiplier). */
  durationMs?: number;
  /** Extra style for the absolute-fill overlay. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface ActiveBurst {
  key: number | string;
  particles: BurstParticle[];
}

interface CanvasSize {
  width: number;
  height: number;
}

function Dot({
  particle,
  progress,
  size,
  color,
}: {
  particle: BurstParticle;
  progress: SharedValue<number>;
  size: CanvasSize;
  color: string;
}) {
  const radius = Math.min(size.width, size.height);
  const cx = useDerivedValue(
    () => size.width / 2 + burstOffsetX(particle, progress.value) * radius * 0.5,
  );
  const cy = useDerivedValue(
    () =>
      size.height * 0.45 + burstOffsetY(particle, progress.value) * radius * 0.5,
  );
  const r = useDerivedValue(
    () => burstScale(progress.value) * particle.size * radius,
  );
  const opacity = useDerivedValue(() => burstAlpha(progress.value));
  return <Circle cx={cx} cy={cy} r={r} opacity={opacity} color={color} />;
}

export function ParticleBurst({
  colors,
  trigger,
  particleCount = BURST_PARTICLE_COUNT,
  durationMs = durations.burst,
  style,
  testID,
}: ParticleBurstProps) {
  const settings = useMotionSettings();
  const progress = useSharedValue(0);
  const [burst, setBurst] = useState<ActiveBurst | null>(null);
  const [size, setSize] = useState<CanvasSize | null>(null);
  const lastTrigger = useRef(trigger);

  const paletteSize = colors.length;
  useEffect(() => {
    if (trigger === lastTrigger.current) return;
    lastTrigger.current = trigger;
    if (trigger === null) return;
    // Decorative delight: suppressed on web (no CanvasKit), under reduced
    // motion, and when the multiplier kill switch is thrown.
    if (Platform.OS === 'web') return;
    const lifetimeMs = moveDuration(durationMs, settings);
    if (lifetimeMs === 0 || paletteSize === 0) return;

    const key = trigger;
    setBurst({
      key,
      particles: burstParticles(particleCount, paletteSize, seedFromKey(key)),
    });
    // Clear only our own burst: a retrigger replaces the state first, and
    // the cancelled animation must not unmount its successor.
    const clear = () =>
      setBurst((current) => (current?.key === key ? null : current));
    progress.value = 0;
    progress.value = withTiming(1, { duration: lifetimeMs }, () => {
      'worklet';
      runOnJS(clear)();
    });
  }, [trigger, durationMs, paletteSize, particleCount, progress, settings]);

  if (burst === null) return null;

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setSize({ width, height });
  };

  return (
    <View
      pointerEvents="none"
      onLayout={onLayout}
      style={[StyleSheet.absoluteFill, style]}
      testID={testID}
    >
      {size !== null ? (
        <Canvas style={StyleSheet.absoluteFill}>
          {burst.particles.map((particle, index) => (
            <Dot
              // Static per-burst field: index identity is stable for its life.
              // eslint-disable-next-line react/no-array-index-key
              key={`${String(burst.key)}-${index}`}
              particle={particle}
              progress={progress}
              size={size}
              color={colors[particle.colorIndex % paletteSize] as string}
            />
          ))}
        </Canvas>
      ) : null}
    </View>
  );
}
