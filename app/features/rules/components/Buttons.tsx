/**
 * Button primitives local to the rules feature (the shell ships no button
 * component; each feature carries its own copy of this small primitive).
 * Three variants: primary (accent fill), secondary (outline), danger
 * (destructive outline).
 */
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '../../../src/ui/ThemeProvider';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
}: ButtonProps) {
  const theme = useTheme();
  const blocked = disabled || loading;

  const backgroundColor =
    variant === 'primary' ? theme.colors.accent : 'transparent';
  const borderColor =
    variant === 'primary'
      ? theme.colors.accent
      : variant === 'danger'
        ? theme.colors.danger
        : theme.colors.border;
  const textColor =
    variant === 'primary'
      ? theme.colors.onAccent
      : variant === 'danger'
        ? theme.colors.danger
        : theme.colors.textPrimary;

  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor,
          borderColor,
          borderRadius: theme.radius.md,
          paddingVertical: theme.spacing.sm + theme.spacing.xs,
          paddingHorizontal: theme.spacing.md,
          opacity: blocked ? 0.5 : pressed ? 0.75 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <Text
          style={{
            color: textColor,
            fontSize: theme.text.body,
            fontWeight: '600',
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
