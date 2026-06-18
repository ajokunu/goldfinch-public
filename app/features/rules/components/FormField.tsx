/**
 * Labeled text input used by the rule editor (local copy of the small form
 * primitive each feature carries; the shell ships no input component).
 */
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '../../../src/ui/ThemeProvider';

export interface FormFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Inline validation message rendered under the input in danger color. */
  error?: string | null;
}

export function FormField({ label, error, ...inputProps }: FormFieldProps) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.caption,
          fontWeight: '600',
          marginBottom: theme.spacing.xs,
        }}
      >
        {label}
      </Text>
      <TextInput
        {...inputProps}
        placeholderTextColor={theme.colors.textSecondary}
        style={[
          styles.input,
          {
            color: theme.colors.textPrimary,
            backgroundColor: theme.colors.surfaceAlt,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            borderRadius: theme.radius.sm,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm + theme.spacing.xs,
            fontSize: theme.text.body,
          },
        ]}
      />
      {error ? (
        <Text
          style={{
            color: theme.colors.danger,
            fontSize: theme.text.caption,
            marginTop: theme.spacing.xs,
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1 },
});
