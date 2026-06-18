/**
 * Thin wrapper over the promoted shared button (app/src/ui/Button.tsx),
 * preserving this feature's historical API: 'secondary' maps to the kit's
 * 'outline' variant and 'danger' maps to 'outline' + destructive, per the
 * promotion contract in the kit's docblock (components.md 4.6).
 */
import type { StyleProp, ViewStyle } from 'react-native';

import { Button as KitButton } from '../../../src/ui/Button';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  /** Callers set flex in sheet footers. */
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  return (
    <KitButton
      label={label}
      onPress={onPress}
      variant={variant === 'primary' ? 'primary' : 'outline'}
      destructive={variant === 'danger'}
      disabled={disabled}
      loading={loading}
      style={style}
    />
  );
}
