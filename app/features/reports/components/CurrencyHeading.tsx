/**
 * Small uppercase currency-code heading. Rendered above each per-currency
 * chart ONLY when a report spans more than one currency (P7-7: per-currency
 * sections, never a synthetic mixed-currency total).
 *
 * Restyled to the kit's caps-eyebrow treatment: the bold sans cut from the
 * active direction (the cut family carries the weight; no fontWeight with
 * loaded custom fonts, tokens.md 8.3).
 */
import { Text } from 'react-native';
import type { CurrencyCode } from '@goldfinch/shared/types';

import { useTheme } from '../../../src/ui/ThemeProvider';

export function CurrencyHeading({ currency }: { currency: CurrencyCode }) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: theme.colors.textSecondary,
        fontSize: 11.5,
        fontFamily: theme.fonts.sansSet.bold,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
      }}
    >
      {currency}
    </Text>
  );
}
