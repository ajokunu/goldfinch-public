/**
 * Stagger -- entrance orchestration (PHASE9-DECISIONS P9-2 items 1/9): wraps
 * each direct child in a FadeRise whose delay grows by `intervalMs` per
 * child (45ms dashboard cascade by default; 60ms for sheet content).
 *
 * The delays handed to FadeRise are raw token values; FadeRise itself
 * applies the reduced-motion / multiplier rules, so a reduced-motion user
 * gets simultaneous fast fades and a killed multiplier gets an instant list.
 */
import { Children, isValidElement, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { FadeRise } from './FadeRise';
import { staggerChildDelayMs } from './motionMath';
import { distances, durations, stagger } from './tokens';

export interface StaggerProps {
  children?: ReactNode;
  /** Delay between consecutive children, ms. */
  intervalMs?: number;
  /** Delay before the first child starts, ms. */
  initialDelayMs?: number;
  /** Per-child fade duration, ms. */
  durationMs?: number;
  /** Per-child vertical travel in dp. */
  distance?: number;
  style?: StyleProp<ViewStyle>;
  /** Style applied to each FadeRise wrapper (e.g. list-gap spacing). */
  itemStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Stagger({
  children,
  intervalMs = stagger.cascadeMs,
  initialDelayMs = 0,
  durationMs = durations.gentle,
  distance = distances.rise,
  style,
  itemStyle,
  testID,
}: StaggerProps) {
  const items = Children.toArray(children);
  return (
    <View style={style} testID={testID}>
      {items.map((child, index) => (
        <FadeRise
          key={
            isValidElement(child) && child.key !== null
              ? child.key
              : `stagger-${index}`
          }
          delay={staggerChildDelayMs(index, intervalMs, initialDelayMs)}
          durationMs={durationMs}
          distance={distance}
          style={itemStyle}
        >
          {child}
        </FadeRise>
      ))}
    </View>
  );
}
