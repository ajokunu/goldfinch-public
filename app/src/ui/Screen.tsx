/**
 * Screen scaffold: themed background, safe-area handling, optional scrolling
 * and standard padding. Every feature screen should render inside <Screen>.
 *
 * Restyle (components.md section 8): the horizontal gutter comes from the
 * theme's density token (`theme.density.pad`, the prototype `--pad`), so
 * tight/cozy/airy directions re-space every screen without call-site churn.
 */
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from './ThemeProvider';

export interface ScreenProps {
  children: ReactNode;
  /** Wrap content in a ScrollView (with keyboard-friendly defaults). */
  scroll?: boolean;
  /** Apply standard horizontal/vertical padding (default true). */
  padded?: boolean;
  /** Safe-area edges to respect; tab screens usually omit 'bottom'. */
  edges?: Array<'top' | 'bottom' | 'left' | 'right'>;
  style?: ViewStyle;
}

export function Screen({
  children,
  scroll = false,
  padded = true,
  edges = ['top', 'left', 'right'],
  style,
}: ScreenProps) {
  const theme = useTheme();
  const padding: ViewStyle = padded
    ? {
        paddingHorizontal: theme.density.pad,
        paddingVertical: theme.spacing.md,
      }
    : {};

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.root, { backgroundColor: theme.colors.bg }]}
    >
      {scroll ? (
        <ScrollView
          style={styles.root}
          contentContainerStyle={[padding, style]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.root, padding, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
