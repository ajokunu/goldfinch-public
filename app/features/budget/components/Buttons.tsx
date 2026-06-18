/**
 * Thin wrapper over the shared Button (app/src/ui/Button.tsx), preserving the
 * feature's historical variant names: 'secondary' maps to the kit 'outline'
 * variant and 'danger' maps to `variant="outline" destructive` per the kit's
 * promotion contract.
 */
import {
  Button as KitButton,
  type ButtonProps as KitButtonProps,
} from '../../../src/ui/Button';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: KitButtonProps['style'];
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const kitVariant: KitButtonProps['variant'] =
    variant === 'primary' ? 'primary' : 'outline';
  return (
    <KitButton
      label={label}
      onPress={onPress}
      variant={kitVariant}
      destructive={variant === 'danger'}
      disabled={disabled}
      loading={loading}
      style={style}
    />
  );
}
