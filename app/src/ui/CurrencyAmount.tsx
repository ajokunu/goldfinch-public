/**
 * Currency display from integer minor units, using the shared per-currency
 * minor-unit digit table (P7-7: 0-digit JPY and 3-digit KWD render correctly,
 * never a hard-coded /100).
 *
 * This complements Money (which renders the API's exact DecimalString): use
 * CurrencyAmount wherever the value at hand is `*Minor` integer units --
 * report aggregates, net-worth slices, goal progress, budget math. No float
 * is ever created: the exact decimal string from toDecimalString is handed
 * to Intl.NumberFormat.format (string inputs per ES2023 Intl v3, same
 * widened-cast technique as shared formatMinor).
 */
import { Text, type StyleProp, type TextStyle } from 'react-native';
import type { CurrencyCode, MinorUnits } from '@goldfinch/shared/types';
import { minorUnitDigits, toDecimalString } from '@goldfinch/shared/money';

import { HIDDEN_AMOUNT, useAmountsHidden } from '../state/uiStore';
import { useTheme } from './ThemeProvider';

export interface FormatMinorAmountOptions {
  signDisplay?: 'auto' | 'always' | 'never';
  locale?: string;
}

export function formatMinorAmount(
  amountMinor: MinorUnits,
  currency: CurrencyCode,
  options: FormatMinorAmountOptions = {},
): string {
  const digits = minorUnitDigits(currency);
  const decimal = toDecimalString(amountMinor, digits);
  // SimpleFIN may carry a non-ISO "currency" (e.g. a URL); fall back to a
  // plain decimal with the raw code appended.
  const isIsoCurrency = /^[A-Za-z]{3}$/.test(currency);
  try {
    const formatter = new Intl.NumberFormat(options.locale, {
      style: isIsoCurrency ? 'currency' : 'decimal',
      currency: isIsoCurrency ? currency.toUpperCase() : undefined,
      signDisplay: options.signDisplay ?? 'auto',
      minimumFractionDigits: isIsoCurrency ? undefined : digits,
      maximumFractionDigits: isIsoCurrency ? undefined : digits,
    });
    // Exact decimal string in -- intentionally cast, see module docblock.
    const format = formatter.format as (value: number | bigint | string) => string;
    const formatted = format(decimal);
    return isIsoCurrency ? formatted : `${formatted} ${currency}`;
  } catch {
    // Render edge: degrade to the exact decimal + code rather than crash.
    return `${decimal} ${currency}`;
  }
}

export interface CurrencyAmountProps {
  /** Integer minor units (e.g. -4599 for -$45.99; -460 for JPY 460 owed). */
  amountMinor: MinorUnits;
  currency: CurrencyCode;
  /** Color the value by sign: danger for negative, positive for >= 0. */
  colorBySign?: boolean;
  signDisplay?: 'auto' | 'always' | 'never';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  style?: StyleProp<TextStyle>;
}

export function CurrencyAmount({
  amountMinor,
  currency,
  colorBySign = false,
  signDisplay,
  size = 'md',
  style,
}: CurrencyAmountProps) {
  const theme = useTheme();
  const isNegative = amountMinor < 0;

  const fontSize =
    size === 'sm'
      ? theme.text.caption
      : size === 'md'
        ? theme.text.body
        : size === 'lg'
          ? theme.text.heading
          : theme.text.title;

  const color = colorBySign
    ? isNegative
      ? theme.colors.danger
      : theme.colors.positive
    : theme.colors.textPrimary;

  const hidden = useAmountsHidden();
  const label = formatMinorAmount(amountMinor, currency, { signDisplay });
  return (
    <Text
      style={[
        { color, fontSize, fontVariant: ['tabular-nums'], fontWeight: '600' },
        style,
      ]}
      accessibilityLabel={hidden ? HIDDEN_AMOUNT : label}
    >
      {hidden ? HIDDEN_AMOUNT : label}
    </Text>
  );
}
