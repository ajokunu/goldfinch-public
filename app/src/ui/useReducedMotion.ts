/**
 * Kit-wide reduced-motion hook (components.md section 3): native subscribes
 * to AccessibilityInfo's reduce-motion flag; web reads
 * `prefers-reduced-motion`. When true, every motion token collapses to ~1ms
 * (values jump to final state; sheets still mount/unmount correctly).
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

import { logger } from '../lib/logger';

const log = logger.child({ component: 'useReducedMotion' });

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      try {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
          return undefined;
        }
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReduced(query.matches);
        const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
      } catch (error) {
        log.warn('prefers-reduced-motion query failed', { error });
        return undefined;
      }
    }

    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduced(value);
      })
      .catch((error: unknown) => {
        log.warn('reduce-motion query failed', { error });
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduced,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/** Effective duration for a motion token under the current preference. */
export function motionDuration(durationMs: number, reduced: boolean): number {
  return reduced ? 1 : durationMs;
}
