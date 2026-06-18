/**
 * Crossfade -- content switch primitive (PHASE9-DECISIONS P9-2 item 2): when
 * `stateKey` changes, the outgoing content fades out (180ms) as an absolute
 * overlay while the incoming content fades in (240ms) with a 12px vertical
 * drift. Same-key re-renders update content in place with no animation.
 *
 * Kill-switch contract: reduced motion or multiplier 0 swaps instantly --
 * the outgoing layer is never even mounted, so tests and screen readers see
 * exactly one copy of the content at all times.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { logger } from '../../lib/logger';
import { flowEasing } from './flowEasing';
import { fadeDuration, moveDuration, type MotionSettings } from './motionMath';
import { distances, durations } from './tokens';
import { useMotionSettings } from './useMotionSettings';

const log = logger.child({ component: 'Crossfade' });

export interface CrossfadeProps {
  /** Identity of the content; a change triggers the crossfade. */
  stateKey: string | number;
  children?: ReactNode;
  /** Incoming vertical drift in dp. */
  drift?: number;
  /** Outgoing fade duration, ms (pre-multiplier). */
  outMs?: number;
  /** Incoming fade duration, ms (pre-multiplier). */
  inMs?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface Layer {
  key: string | number;
  node: ReactNode;
}

interface SceneState {
  current: Layer;
  previous: Layer | null;
}

export function Crossfade({
  stateKey,
  children,
  drift = distances.drift,
  outMs = durations.fast,
  inMs = durations.base,
  style,
  testID,
}: CrossfadeProps) {
  const settings = useMotionSettings();
  const instant = settings.reduceMotion || settings.multiplier <= 0;

  const [scene, setScene] = useState<SceneState>({
    current: { key: stateKey, node: children },
    previous: null,
  });
  // True once any switch happened: the very first mount never animates
  // (entrances are FadeRise's job, not Crossfade's).
  const hasSwitchedRef = useRef(false);

  if (scene.current.key !== stateKey) {
    // Derived state during render (sanctioned React pattern): capture the
    // outgoing layer and swap the incoming one atomically with the commit.
    hasSwitchedRef.current = true;
    setScene({
      current: { key: stateKey, node: children },
      previous: instant ? null : scene.current,
    });
  } else if (scene.current.node !== children) {
    // Same key, fresh content: keep it current without any animation.
    setScene({
      current: { key: stateKey, node: children },
      previous: scene.previous,
    });
  }

  const clearPrevious = useCallback((previousKey: string | number) => {
    setScene((state) =>
      state.previous !== null && state.previous.key === previousKey
        ? { current: state.current, previous: null }
        : state,
    );
  }, []);

  return (
    <View style={style} testID={testID}>
      <IncomingLayer
        key={`in-${String(scene.current.key)}`}
        animate={hasSwitchedRef.current && !instant}
        drift={drift}
        inMs={inMs}
        settings={settings}
      >
        {scene.current.node}
      </IncomingLayer>
      {scene.previous !== null ? (
        <OutgoingLayer
          key={`out-${String(scene.previous.key)}`}
          layerKey={scene.previous.key}
          outMs={outMs}
          settings={settings}
          onDone={clearPrevious}
        >
          {scene.previous.node}
        </OutgoingLayer>
      ) : null}
    </View>
  );
}

/** Incoming content: fades in with vertical drift; static after first frame. */
function IncomingLayer({
  animate,
  drift,
  inMs,
  settings,
  children,
}: {
  animate: boolean;
  drift: number;
  inMs: number;
  settings: MotionSettings;
  children?: ReactNode;
}) {
  const fadeMs = fadeDuration(inMs, settings);
  const travel = settings.reduceMotion ? 0 : drift * settings.multiplier;
  const run = animate && fadeMs > 0;

  const opacity = useSharedValue(run ? 0 : 1);
  const translateY = useSharedValue(run ? travel : 0);

  useEffect(() => {
    if (!run) {
      opacity.value = 1;
      translateY.value = 0;
      return;
    }
    opacity.value = withTiming(1, { duration: fadeMs, easing: flowEasing });
    translateY.value = withTiming(0, {
      duration: moveDuration(inMs, settings),
      easing: flowEasing,
    });
    // Mount-only: the layer is remounted (keyed) on every switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

/**
 * Outgoing content: a non-interactive absolute overlay fading to zero, then
 * removed from the tree via the timing callback. The callback fires with
 * finished=false when interrupted; the layer is cleared either way so a
 * cancelled crossfade can never leave a ghost overlay behind.
 */
function OutgoingLayer({
  layerKey,
  outMs,
  settings,
  onDone,
  children,
}: {
  layerKey: string | number;
  outMs: number;
  settings: MotionSettings;
  onDone: (key: string | number) => void;
  children?: ReactNode;
}) {
  const opacity = useSharedValue(1);
  const fadeMs = fadeDuration(outMs, settings);

  useEffect(() => {
    const finish = (finished: boolean) => {
      if (!finished) {
        log.debug('outgoing crossfade interrupted; clearing layer', {
          layerKey,
        });
      }
      onDone(layerKey);
    };
    opacity.value = withTiming(
      0,
      { duration: fadeMs, easing: flowEasing },
      (finished) => {
        'worklet';
        runOnJS(finish)(finished === true);
      },
    );
    // Mount-only: the layer is remounted (keyed) on every switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.overlay, animatedStyle]}
    >
      {children}
    </Animated.View>
  );
}

const styles = {
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  } as const satisfies ViewStyle,
};
