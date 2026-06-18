/**
 * Measured-width hook for the chart primitives: charts stretch to their
 * container and draw once the first layout pass reports a real width.
 */
import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

export function useContainerWidth(): {
  width: number;
  onLayout: (event: LayoutChangeEvent) => void;
} {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width));
  }, []);
  return { width, onLayout };
}
