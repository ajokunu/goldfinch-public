/**
 * One pointer abstraction for chart interactions (PHASE9-DECISIONS P9-2
 * items 4/5): web mouse hover and native touch-drag deliver the same local
 * (x, y) stream to the caller, so the crosshair scrubber and the donut
 * segment swell are written ONCE and behave identically on both inputs.
 *
 * - Web: react-native-web forwards onMouseMove/onMouseLeave to the DOM; the
 *   position is derived from clientX/Y against the listener's bounding rect
 *   (offsetX would be relative to whichever CHILD the pointer is over).
 * - Native: the responder system; locationX/Y are already view-local.
 *
 * Pointer tracking is STATE FEEDBACK, not movement, so it stays live under
 * reduced motion (P9-1: reduction never disables state feedback).
 */
import {
  Platform,
  type GestureResponderEvent,
  type ViewProps,
} from 'react-native';

import { logger } from '../../lib/logger';

const log = logger.child({ component: 'chartPointer' });

/** Minimal DOM mouse-event surface used on web (no lib.dom dependency). */
interface WebMouseEventLike {
  nativeEvent: { clientX: number; clientY: number };
  currentTarget: {
    getBoundingClientRect?: () => { left: number; top: number };
  };
}

/**
 * Build the props to spread on the interactive overlay View. `onPoint`
 * receives view-local coordinates on every move; `onClear` fires when the
 * pointer leaves (web) or the touch ends (native).
 */
export function chartPointerProps(
  onPoint: (x: number, y: number) => void,
  onClear: () => void,
): ViewProps {
  if (Platform.OS === 'web') {
    const fromMouse = (event: WebMouseEventLike): void => {
      try {
        const rect = event.currentTarget.getBoundingClientRect?.();
        if (rect === undefined) return;
        onPoint(
          event.nativeEvent.clientX - rect.left,
          event.nativeEvent.clientY - rect.top,
        );
      } catch (error) {
        // A detached node mid-unmount must never crash a chart hover.
        log.warn('web pointer position failed; hover sample dropped', {
          error,
        });
      }
    };
    // onMouseMove/onMouseLeave are react-native-web passthrough props; the
    // RN ViewProps type does not know them, hence the widening cast.
    return {
      onMouseMove: fromMouse,
      onMouseLeave: onClear,
    } as ViewProps;
  }

  const fromTouch = (event: GestureResponderEvent): void => {
    onPoint(event.nativeEvent.locationX, event.nativeEvent.locationY);
  };
  return {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderGrant: fromTouch,
    onResponderMove: fromTouch,
    onResponderRelease: onClear,
    onResponderTerminate: onClear,
  };
}
