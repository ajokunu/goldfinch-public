/**
 * Dashboard hero money headline (screens.md 0.2.3, PHASE9-DECISIONS P9-2
 * items 1/4): the net-worth figure rides the shared CountUp primitive --
 * rolling digits over the exact formatMinorAmount string (integer minor
 * units only, no float ever represents money), 650ms, on mount AND on every
 * value change. No ad-hoc animation lives here (P9-1: feature code consumes
 * motion primitives only); reduced motion / the kill switch render the final
 * value immediately inside the primitive.
 *
 * Direction treatment (screens.md 1.3): studio ('editorial' hero) renders
 * 46px in accent; every other direction 40px in text color; the family is
 * the direction's display cut (meridian's serif face comes free from the
 * theme). The cut family carries its own weight -- never synthesize on top
 * of a loaded custom font (tokens.md 8.3).
 */
import type { CurrencyCode, MinorUnits } from '@goldfinch/shared/types';

import { CountUp } from '../../../src/ui/motion';
import { useTheme } from '../../../src/ui/ThemeProvider';

export function HeroAmount({
  amountMinor,
  currency,
  testID,
}: {
  amountMinor: MinorUnits;
  currency: CurrencyCode;
  testID?: string;
}) {
  const theme = useTheme();
  const editorial = theme.hero === 'editorial';

  return (
    <CountUp
      amountMinor={amountMinor}
      currency={currency}
      style={{
        color: editorial ? theme.colors.accent : theme.colors.text,
        fontSize: editorial ? 46 : 40,
        fontFamily: theme.fonts.display,
        fontWeight: 'normal',
        letterSpacing: -0.5,
      }}
      testID={testID}
    />
  );
}
