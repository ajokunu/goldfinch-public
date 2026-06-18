/**
 * CountUp -- the rolling-digit money ticker (PHASE9-DECISIONS P9-2 items
 * 1/4): money headlines roll each digit on a vertical 0-9 strip, 650ms with
 * the easeOutCubic curve, on mount (from zero -- the app-open ticker) and on
 * value change (from the previous digits).
 *
 * Formatting is the SHARED money path: formatMinorAmount (per-currency
 * minor-unit digits, exact decimal strings, no floats). The slicing of the
 * formatted string into rolling/static columns is pure logic in
 * countUpMath.ts (unit + mutation tested); this file only binds that plan to
 * Reanimated worklets.
 *
 * Kill-switch contract: reduced motion or multiplier 0 renders a single
 * static Text with the exact formatted value -- the same output
 * CurrencyAmount would produce -- so accessibility and tests always see the
 * final value immediately.
 */
import { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { CurrencyCode, MinorUnits } from '@goldfinch/shared/types';

import { logger } from '../../lib/logger';
import { formatMinorAmount } from '../CurrencyAmount';
import { HIDDEN_AMOUNT, useAmountsHidden } from '../../state/uiStore';
import { useTheme } from '../ThemeProvider';
import {
  DIGIT_STRIP,
  planColumns,
  stripOffset,
  type CountUpColumn,
} from './countUpMath';
import { flowEasing, rollEasing } from './flowEasing';
import { fadeDuration, moveDuration, type MotionSettings } from './motionMath';
import { durations } from './tokens';
import { useMotionSettings } from './useMotionSettings';

const log = logger.child({ component: 'CountUp' });

export interface CountUpProps {
  /** Integer minor units (e.g. -4599 for -$45.99), the *Minor API fields. */
  amountMinor: MinorUnits;
  currency: CurrencyCode;
  signDisplay?: 'auto' | 'always' | 'never';
  /** Color the value by sign: danger for negative, positive for >= 0. */
  colorBySign?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Roll duration, ms (pre-multiplier). */
  durationMs?: number;
  /** Roll digits up from zero on first mount (the app-open ticker). */
  animateOnMount?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Shared-formatting wrapper with the failure path made visible: a malformed
 * runtime amount (non-safe-integer from a bad payload) must degrade to a
 * readable fallback, never crash a money headline.
 */
function safeFormat(
  amountMinor: MinorUnits,
  currency: CurrencyCode,
  signDisplay: 'auto' | 'always' | 'never' | undefined,
): string {
  try {
    return formatMinorAmount(amountMinor, currency, { signDisplay });
  } catch (error) {
    log.error('money formatting failed; rendering raw fallback', {
      error,
      amountMinor: String(amountMinor),
      currency,
    });
    return `${String(amountMinor)} ${currency}`;
  }
}

interface PlanState {
  formatted: string;
  columns: CountUpColumn[];
}

export function CountUp({
  amountMinor,
  currency,
  signDisplay,
  colorBySign = false,
  size = 'xl',
  durationMs = durations.countUp,
  animateOnMount = true,
  style,
  testID,
}: CountUpProps) {
  const theme = useTheme();
  const settings = useMotionSettings();
  const rollMs = moveDuration(durationMs, settings);
  const hidden = useAmountsHidden();
  const formatted = hidden
    ? HIDDEN_AMOUNT
    : safeFormat(amountMinor, currency, signDisplay);

  // Column plan derived from the formatted string: recomputed during render
  // when the value changes (React's sanctioned derived-state pattern), so
  // each column knows the digit it is rolling away from.
  const [plan, setPlan] = useState<PlanState>(() => ({
    formatted,
    columns: planColumns(null, formatted, animateOnMount),
  }));
  if (plan.formatted !== formatted) {
    setPlan({ formatted, columns: planColumns(plan.formatted, formatted) });
  }

  // Headline call sites override the size token through `style` (hero 40/46,
  // report heroes 28/34); the digit-strip metrics MUST follow the effective
  // glyph size or the rolling windows drift off the baseline.
  const flatStyle = StyleSheet.flatten(style) as TextStyle | undefined;
  const fontSize =
    flatStyle?.fontSize ??
    (size === 'sm'
      ? theme.text.caption
      : size === 'md'
        ? theme.text.body
        : size === 'lg'
          ? theme.text.heading
          : theme.text.title);
  // Explicit row height keeps the strip window and every glyph on one
  // baseline; 1.3x covers ascenders/descenders across the kit's font stacks.
  const rowHeight = Math.round(flatStyle?.lineHeight ?? fontSize * 1.3);

  const color = colorBySign
    ? amountMinor < 0
      ? theme.colors.danger
      : theme.colors.positive
    : theme.colors.textPrimary;

  const glyphStyle: TextStyle = {
    color,
    fontSize,
    lineHeight: rowHeight,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  };

  // Reduced motion / kill switch / privacy-masked: render the value (or the
  // mask) as static text. Digit-roll over bullet glyphs would be meaningless,
  // and animating reveals nothing under privacy mode.
  if (settings.reduceMotion || rollMs === 0 || hidden) {
    return (
      <Text
        style={[glyphStyle, style]}
        accessibilityLabel={formatted}
        testID={testID}
      >
        {formatted}
      </Text>
    );
  }

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={formatted}
      testID={testID}
      style={styles.row}
    >
      {plan.columns.map((column) =>
        column.kind === 'digit' && column.digit !== null ? (
          <DigitColumn
            key={column.key}
            column={column}
            rowHeight={rowHeight}
            rollMs={rollMs}
            settings={settings}
            textStyle={[glyphStyle, style]}
          />
        ) : (
          <Text key={column.key} style={[glyphStyle, style]}>
            {column.char}
          </Text>
        ),
      )}
    </View>
  );
}

/**
 * One rolling digit: a 0-9 strip inside an overflow-hidden window of one row,
 * translated on the UI thread to the active digit. Mount starts from the
 * plan's fromDigit (or in place when entering); updates roll from wherever
 * the strip currently sits, which also makes interrupted rolls continuous.
 */
function DigitColumn({
  column,
  rowHeight,
  rollMs,
  settings,
  textStyle,
}: {
  column: CountUpColumn;
  rowHeight: number;
  rollMs: number;
  settings: MotionSettings;
  textStyle: StyleProp<TextStyle>;
}) {
  const target = column.digit ?? 0;
  const mountFrom = column.fromDigit ?? target;
  const offset = useSharedValue(stripOffset(mountFrom, rowHeight));
  const opacity = useSharedValue(
    column.entering && column.fromDigit === null ? 0 : 1,
  );

  // Runs on mount (rolling from the plan's fromDigit) and whenever the
  // target digit or metrics change (rolling from wherever the strip sits).
  useEffect(() => {
    offset.value = withTiming(stripOffset(target, rowHeight), {
      duration: rollMs,
      easing: rollEasing,
    });
    opacity.value = withTiming(1, {
      duration: fadeDuration(Math.min(rollMs, durations.base), settings),
      easing: flowEasing,
    });
  }, [offset, opacity, target, rowHeight, rollMs, settings]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: offset.value }],
  }));

  return (
    <View style={{ height: rowHeight, overflow: 'hidden' }}>
      <Animated.View style={animatedStyle}>
        {DIGIT_STRIP.map((digitChar) => (
          <Text key={digitChar} style={[textStyle, { height: rowHeight }]}>
            {digitChar}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = {
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  } as const satisfies ViewStyle,
};
