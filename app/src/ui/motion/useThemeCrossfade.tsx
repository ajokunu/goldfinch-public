/**
 * useThemeCrossfade -- the full-palette theme transition (PHASE9-DECISIONS
 * P9-2 item 8): switching direction or mode animates every color over 350ms
 * instead of hard-repainting, while useTheme() consumers keep receiving the
 * same frozen GFTheme objects they always have.
 *
 * Why not an "animated palette" that feeds interpolated colors through
 * context? Each interpolation step would re-render every useTheme() consumer
 * (the entire app, including mounted-behind tab screens and FlashLists) on
 * the JS thread -- 20+ full-tree renders in 350ms can never hold the P9 60fps
 * bar. Both legs below animate OUTSIDE React instead; the only extra React
 * work is the same single re-render a theme switch costs today.
 *
 * NATIVE (iOS/Android): snapshot crossfade overlay. The current pixels are
 * captured (Skia makeImageFromView via ./themeSnapshot), mounted as a static
 * full-bleed image above the app, the real tree repaints in the new theme
 * underneath (hidden), and the overlay fades to zero with one Reanimated
 * opacity worklet -- a single GPU-composited fade. Per-pixel alpha blending
 * of old over new IS linear color interpolation between the two palettes,
 * everywhere at once, at a guaranteed 60fps.
 *
 * WEB: a temporary document-level stylesheet transitions every color-bearing
 * CSS property (themeCrossfadeMath.themeTransitionCss) while the theme flips
 * once underneath it. The browser interpolates colors in its style system --
 * zero React re-renders beyond the swap itself, no snapshot needed.
 *
 * Kill-switch contract: OS reduced motion, the Settings override, and the
 * global multiplier all flow through useMotionSettings/moveDuration; any of
 * them zeroing the duration makes the switch instant (P9-2.8: reduced motion
 * = instant, no fade), with no capture and no overlay ever mounted.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { logger } from '../../lib/logger';
import { flowEasing } from './flowEasing';
import { moveDuration } from './motionMath';
import { themeTransitionCss } from './themeCrossfadeMath';
import { captureViewSnapshot } from './themeSnapshot';
import { durations, EASE_FLOW } from './tokens';
import { useMotionSettings } from './useMotionSettings';

const log = logger.child({ component: 'useThemeCrossfade' });

export const THEME_CROSSFADE_OVERLAY_TEST_ID = 'theme-crossfade-overlay';

/**
 * If the snapshot data URI has not decoded within this window something is
 * wrong (corrupt encode, memory pressure); swap instantly rather than leave
 * the app frozen under an opaque overlay.
 */
const SNAPSHOT_READY_TIMEOUT_MS = 600;

export interface ThemeCrossfade<T> {
  /** The theme to provide to consumers (lags `target` only mid-transition). */
  theme: T;
  /**
   * Must be attached (with collapsable={false}) to the View wrapping the
   * themed subtree; the native leg snapshots this view. Unused on web.
   */
  containerRef: RefObject<View | null>;
  /**
   * Render INSIDE the container view, after the children, so the fading
   * snapshot covers the subtree it was captured from (and a capture taken
   * mid-fade sees exactly what the user sees). Null on web / when idle.
   */
  overlay: ReactNode;
}

/**
 * `target` must be referentially stable per theme (resolveTheme returns
 * cached frozen instances), since identity change is the transition trigger.
 */
export function useThemeCrossfade<T extends object>(
  target: T,
): ThemeCrossfade<T> {
  // Platform.OS is fixed for the life of the process, so hook order is
  // stable across renders even though only one leg ever runs.
  return Platform.OS === 'web'
    ? // eslint-disable-next-line react-hooks/rules-of-hooks
      useWebThemeCrossfade(target)
    : // eslint-disable-next-line react-hooks/rules-of-hooks
      useNativeThemeCrossfade(target);
}

// ---------------------------------------------------------------------------
// Native leg: snapshot crossfade overlay
// ---------------------------------------------------------------------------

interface Snapshot {
  id: number;
  uri: string;
}

function useNativeThemeCrossfade<T extends object>(
  target: T,
): ThemeCrossfade<T> {
  const settings = useMotionSettings();
  const durationMs = moveDuration(durations.themeCrossfade, settings);
  const containerRef = useRef<View | null>(null);
  const [displayed, setDisplayed] = useState(target);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  /** Monotonic transition id; stale captures/loads compare against it. */
  const seqRef = useRef(0);
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = target;
  });

  // Instant path (reduced motion / kill switch): flip during render -- the
  // sanctioned derived-state pattern -- so consumers never see a stale theme
  // for even one commit, exactly like the pre-crossfade provider.
  if (durationMs <= 0 && displayed !== target) {
    seqRef.current += 1;
    setDisplayed(target);
    setSnapshot(null);
  }

  useEffect(() => {
    if (durationMs <= 0 || displayed === target) return undefined;
    const id = ++seqRef.current;
    let cancelled = false;
    captureViewSnapshot(containerRef)
      .then((uri) => {
        if (cancelled || id !== seqRef.current) return;
        if (uri === null) {
          // Capture leg already logged why; swap without a crossfade.
          setSnapshot(null);
          setDisplayed(targetRef.current);
          return;
        }
        // Old pixels mount as an opaque overlay over the identical live
        // tree (seamless); the theme flips beneath it once the image is
        // decoded (overlay onLoad), then the fade reveals the new palette.
        setSnapshot({ id, uri });
      })
      .catch((error: unknown) => {
        // captureViewSnapshot resolves null on its own failures; this guards
        // the contract anyway -- a rejection must never strand the old theme.
        log.error('theme snapshot promise rejected; swapping instantly', {
          error,
        });
        if (cancelled || id !== seqRef.current) return;
        setSnapshot(null);
        setDisplayed(targetRef.current);
      });
    return () => {
      cancelled = true;
    };
  }, [displayed, durationMs, target]);

  const handleReady = useCallback((id: number) => {
    // A newer switch owns the flip; this overlay is about to be replaced.
    if (id !== seqRef.current) return;
    setDisplayed(targetRef.current);
  }, []);

  const handleDone = useCallback((id: number, finished: boolean) => {
    if (!finished) {
      log.debug('theme crossfade overlay interrupted; clearing', { id });
    }
    setSnapshot((current) =>
      current !== null && current.id === id ? null : current,
    );
  }, []);

  const overlay =
    snapshot === null ? null : (
      <ThemeSnapshotOverlay
        key={snapshot.id}
        id={snapshot.id}
        uri={snapshot.uri}
        durationMs={durationMs}
        onReady={handleReady}
        onDone={handleDone}
      />
    );

  return { theme: displayed, containerRef, overlay };
}

/**
 * One fading snapshot: mounts fully opaque over identical live pixels, and
 * only once the image has actually decoded (onLoad) reports ready -- the
 * caller flips the real theme underneath at that exact moment, so the hard
 * repaint is never visible -- then fades out on the UI thread and removes
 * itself. Load errors and decode stalls degrade to a logged instant swap.
 */
function ThemeSnapshotOverlay({
  id,
  uri,
  durationMs,
  onReady,
  onDone,
}: {
  id: number;
  uri: string;
  durationMs: number;
  onReady: (id: number) => void;
  onDone: (id: number, finished: boolean) => void;
}) {
  const opacity = useSharedValue(1);
  const startedRef = useRef(false);

  const begin = useCallback(
    (reason: 'load' | 'error' | 'timeout') => {
      if (startedRef.current) return;
      startedRef.current = true;
      if (reason !== 'load') {
        log.warn('theme snapshot overlay unusable; swapping without fade', {
          id,
          reason,
        });
        onReady(id);
        onDone(id, false);
        return;
      }
      onReady(id);
      opacity.value = withTiming(
        0,
        { duration: durationMs, easing: flowEasing },
        (finished) => {
          'worklet';
          runOnJS(onDone)(id, finished === true);
        },
      );
    },
    [durationMs, id, onDone, onReady, opacity],
  );

  useEffect(() => {
    const timer = setTimeout(() => begin('timeout'), SNAPSHOT_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [begin]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  // Opacity animates on the wrapper View (ImageProps has no pointerEvents;
  // the wrapper also keeps taps flowing through during the fade).
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, animatedStyle]}
    >
      <Image
        source={{ uri }}
        // Android's default Image cross-dissolve would double-animate.
        fadeDuration={0}
        resizeMode="stretch"
        onLoad={() => begin('load')}
        onError={() => begin('error')}
        accessible={false}
        style={StyleSheet.absoluteFill}
        testID={THEME_CROSSFADE_OVERLAY_TEST_ID}
      />
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Web leg: document-level palette transition
// ---------------------------------------------------------------------------

function useWebThemeCrossfade<T extends object>(
  target: T,
): ThemeCrossfade<T> {
  const settings = useMotionSettings();
  const durationMs = moveDuration(durations.themeCrossfade, settings);
  const containerRef = useRef<View | null>(null);
  const [displayed, setDisplayed] = useState(target);

  // Instant path mirrors the native leg: flip during render.
  if (durationMs <= 0 && displayed !== target) {
    setDisplayed(target);
  }

  useEffect(() => {
    if (durationMs <= 0 || displayed === target) return;
    // Arm the transition stylesheet FIRST (this effect), then commit the new
    // colors (the setState below): the rule is in the document before any
    // color changes, so the browser interpolates instead of repainting hard.
    armWebPaletteTransition(durationMs);
    setDisplayed(target);
  }, [displayed, durationMs, target]);

  return { theme: displayed, containerRef, overlay: null };
}

/** Margin after the transition window before the stylesheet is removed. */
const WEB_TRANSITION_CLEANUP_SLACK_MS = 80;

let webTransitionStyleEl: HTMLStyleElement | null = null;
let webTransitionCleanupTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Module-level singleton (the document is a singleton): injects/refreshes the
 * palette-transition stylesheet and schedules its removal. Re-arming during
 * an active window just extends it -- in-flight CSS transitions retarget from
 * their current interpolated colors, so rapid switches stay continuous.
 */
function armWebPaletteTransition(durationMs: number): void {
  if (typeof document === 'undefined') return;
  try {
    const css = themeTransitionCss(durationMs, EASE_FLOW);
    if (css === '') return;
    if (webTransitionStyleEl === null) {
      webTransitionStyleEl = document.createElement('style');
      webTransitionStyleEl.setAttribute('data-goldfinch', 'theme-crossfade');
      document.head.appendChild(webTransitionStyleEl);
    }
    webTransitionStyleEl.textContent = css;
    if (webTransitionCleanupTimer !== null) {
      clearTimeout(webTransitionCleanupTimer);
    }
    webTransitionCleanupTimer = setTimeout(() => {
      webTransitionStyleEl?.remove();
      webTransitionStyleEl = null;
      webTransitionCleanupTimer = null;
    }, durationMs + WEB_TRANSITION_CLEANUP_SLACK_MS);
  } catch (error) {
    // Injection failure means a hard repaint -- the pre-crossfade behavior;
    // never let a cosmetic transition break the theme switch itself.
    log.error('web palette transition injection failed; hard repaint', {
      error,
    });
  }
}
