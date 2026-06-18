/**
 * Badge primitive (components.md 5.4) behind the feature wrappers
 * (transactions PendingBadge, recurring CadenceBadge): uppercase micro-label
 * in three variants. The uppercase transform is visual only -- screen
 * readers get the readable label.
 */
import { Text } from 'react-native';

import { withAlpha } from './mixColor';
import { useTheme } from './ThemeProvider';

export interface BadgeProps {
  /** Already-localized; rendered uppercase. */
  label: string;
  variant: 'pending' | 'neutral' | 'learned';
}

export function Badge({ label, variant }: BadgeProps) {
  const theme = useTheme();

  const color =
    variant === 'neutral' ? theme.colors.textSecondary : theme.colors.accent2;
  const backgroundColor =
    variant === 'pending'
      ? withAlpha(theme.colors.accent2, 0.16)
      : variant === 'learned'
        ? withAlpha(theme.colors.accent2, 0.14)
        : theme.colors.surfaceAlt;
  const fontSize = variant === 'learned' ? 10 : 10.5;
  // 0.03em (learned 0.04em) at the rendered size.
  const letterSpacing = fontSize * (variant === 'learned' ? 0.04 : 0.03);
  const paddingVertical = variant === 'pending' ? 2 : 3;
  const paddingHorizontal = variant === 'neutral' ? 8 : 7;

  return (
    <Text
      accessibilityLabel={label}
      numberOfLines={1}
      style={{
        color,
        backgroundColor,
        fontSize,
        letterSpacing,
        paddingVertical,
        paddingHorizontal,
        fontWeight: '700',
        fontFamily: theme.fonts.sans,
        textTransform: 'uppercase',
        borderRadius: 6,
        overflow: 'hidden',
        flexShrink: 0,
        alignSelf: 'flex-start',
      }}
    >
      {label}
    </Text>
  );
}
