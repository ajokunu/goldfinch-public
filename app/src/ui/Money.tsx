/**
 * Money display: exact decimal string in, locale-formatted currency out.
 *
 * The API delivers every money field as a pair (decimal string `x` + integer
 * `xMinor`); this component renders the decimal string. No float is ever
 * created: the exact decimal string is handed to Intl.NumberFormat.format,
 * which accepts string inputs per the ES2023 Intl.NumberFormat v3 spec (the
 * same widened-cast technique used by @goldfinch/shared formatMinor, since
 * the lib typings still say number | bigint).
 */
import { Text, type StyleProp, type TextStyle } from 'react-native';
import type { CurrencyCode, DecimalString } from '@goldfinch/shared/types';

import { HIDDEN_AMOUNT, useAmountsHidden } from '../state/uiStore';
import { useTheme } from './ThemeProvider';

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

export function formatDecimalAmount(
  amount: DecimalString,
  currency: CurrencyCode = 'USD',
  options: { signDisplay?: 'auto' | 'always' | 'never'; locale?: string } = {},
): string {
  const trimmed = amount.trim();
  if (!DECIMAL_RE.test(trimmed)) {
    // Defensive: never feed a malformed value to Intl; show it verbatim.
    return `${amount} ${currency}`.trim();
  }
  // SimpleFIN may carry a non-ISO "currency" (e.g. a URL); fall back to a
  // plain decimal with the raw code appended.
  const isIsoCurrency = /^[A-Za-z]{3}$/.test(currency);
  try {
    const formatter = new Intl.NumberFormat(options.locale, {
      style: isIsoCurrency ? 'currency' : 'decimal',
      currency: isIsoCurrency ? currency.toUpperCase() : undefined,
      signDisplay: options.signDisplay ?? 'auto',
      minimumFractionDigits: isIsoCurrency ? undefined : 2,
    });
    // Exact decimal string in -- intentionally cast, see module docblock.
    const formatted = formatter.format(trimmed as unknown as number);
    return isIsoCurrency ? formatted : `${formatted} ${currency}`;
  } catch {
    return `${amount} ${currency}`.trim();
  }
}

export interface MoneyProps {
  /** Exact decimal string, e.g. "-45.99" (DecimalString from the API). */
  amount: DecimalString;
  currency?: CurrencyCode;
  /** Color the value by sign: danger for negative, positive for >= 0. */
  colorBySign?: boolean;
  signDisplay?: 'auto' | 'always' | 'never';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  style?: StyleProp<TextStyle>;
}

export function Money({
  amount,
  currency = 'USD',
  colorBySign = false,
  signDisplay,
  size = 'md',
  style,
}: MoneyProps) {
  const theme = useTheme();
  const isNegative = amount.trim().startsWith('-');

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
  const display = hidden
    ? HIDDEN_AMOUNT
    : formatDecimalAmount(amount, currency, { signDisplay });
  return (
    <Text
      style={[
        { color, fontSize, fontVariant: ['tabular-nums'], fontWeight: '600' },
        style,
      ]}
      accessibilityLabel={display}
    >
      {display}
    </Text>
  );
}
