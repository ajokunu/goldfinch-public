/**
 * Count-up currency display (design-spec screens.md 0.2 item 3, the
 * prototype's AnimatedNumber): animates over the integer MinorUnits value --
 * rounded to an integer every frame -- and formats each frame through the
 * shared formatMinorAmount path. A DecimalString is never interpolated and no
 * float ever leaves this component: the only float is the easing scalar, and
 * the per-frame product is rounded back to integer minor units before
 * formatting (the sanctioned presentation extension).
 *
 * Reduced motion renders the final value immediately. The accessibility label
 * is always the exact final amount, never a mid-animation frame.
 */
import { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import type { CurrencyCode, MinorUnits } from '@goldfinch/shared/types';

import { formatMinorAmount } from '../../../src/ui/CurrencyAmount';
import { HIDDEN_AMOUNT, useAmountsHidden } from '../../../src/state/uiStore';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { useReducedMotion } from '../../../src/ui/useReducedMotion';

export interface AnimatedMinorAmountProps {
  /** Final integer minor-unit value (e.g. a per-currency progress sum). */
  amountMinor: MinorUnits;
  currency: CurrencyCode;
  /** BCP-47 tag from localeTag(useLang()); defaults to the device locale. */
  locale?: string;
  style?: StyleProp<TextStyle>;
}

export function AnimatedMinorAmount({
  amountMinor,
  currency,
  locale,
  style,
}: AnimatedMinorAmountProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  // Privacy mode masks the readout entirely: the count-up would otherwise
  // roll the real digits frame by frame, so when hidden we render the static
  // mask and skip the animation (rolling over bullets reveals nothing).
  const hidden = useAmountsHidden();
  const [frameMinor, setFrameMinor] = useState<MinorUnits>(
    reduced ? amountMinor : 0,
  );

  const durationMs = theme.motion.countUp.durationMs;

  useEffect(() => {
    if (reduced || hidden) {
      setFrameMinor(amountMinor);
      return undefined;
    }
    let frameId = 0;
    const startedAt = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - startedAt) / durationMs);
      // Ease-out cubic (motion.countUp); rounded back to integer minor units.
      const eased = 1 - (1 - t) ** 3;
      setFrameMinor(Math.round(amountMinor * eased));
      if (t < 1) frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [amountMinor, durationMs, reduced, hidden]);

  return (
    <Text
      accessibilityLabel={
        hidden
          ? HIDDEN_AMOUNT
          : formatMinorAmount(amountMinor, currency, { locale })
      }
      style={style}
    >
      {hidden
        ? HIDDEN_AMOUNT
        : formatMinorAmount(frameMinor, currency, { locale })}
    </Text>
  );
}
