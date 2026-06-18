/**
 * Labeled text input, consolidating the four per-feature FormField copies
 * (budget, goals, import, rules keep their paths as thin re-exports; the
 * props here are the superset -- goals' `hint` included).
 *
 * Restyle: eyebrow-style label (11/700 uppercase, textSecondary), borderless
 * surfaceAlt input at `radius.control` with `textFaint` placeholder (the
 * sheet note-input treatment from components.md 6.1); the danger border
 * appears only in the error state.
 */
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { useTheme } from './ThemeProvider';

export interface FormFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Inline validation message rendered under the input in danger color. */
  error?: string | null;
  /** Muted helper line under the input, e.g. format hints. */
  hint?: string;
}

export function FormField({
  label,
  error,
  hint,
  accessibilityLabel,
  ...inputProps
}: FormFieldProps) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: 11,
          fontWeight: '700',
          fontFamily: theme.fonts.sans,
          textTransform: 'uppercase',
          // 0.1em at 11px.
          letterSpacing: 1.1,
          marginBottom: 6,
        }}
      >
        {label}
      </Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={accessibilityLabel ?? label}
        placeholderTextColor={theme.colors.textFaint}
        style={[
          styles.input,
          {
            color: theme.colors.textPrimary,
            fontFamily: theme.fonts.sans,
            backgroundColor: theme.colors.surfaceAlt,
            borderColor: error ? theme.colors.danger : 'transparent',
            borderRadius: theme.radius.control,
          },
        ]}
      />
      {hint && !error ? (
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 12,
            fontFamily: theme.fonts.sans,
            marginTop: 6,
          }}
        >
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text
          style={{
            color: theme.colors.danger,
            fontSize: 12,
            fontFamily: theme.fonts.sans,
            marginTop: 6,
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14.5,
  },
});
