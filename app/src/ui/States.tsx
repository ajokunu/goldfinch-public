/**
 * Loading / error / empty states shared across features (promoted from
 * features/budget in Phase 7). Self-contained: the retry affordance is a
 * themed Pressable, so this module has no feature dependencies.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CircleAlert } from 'lucide-react-native';

import { useTheme } from './ThemeProvider';

export function LoadingState() {
  const theme = useTheme();
  return (
    <View style={[styles.center, { padding: theme.spacing.xl }]}>
      <ActivityIndicator color={theme.colors.accent} />
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.center, { padding: theme.spacing.xl }]}>
      <CircleAlert size={28} color={theme.colors.danger} />
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: theme.text.body,
          textAlign: 'center',
          marginTop: theme.spacing.sm,
          marginBottom: theme.spacing.md,
        }}
      >
        {message}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={({ pressed }) => [
            styles.retryButton,
            {
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surfaceAlt,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.sm,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text
            style={{
              color: theme.colors.textPrimary,
              fontSize: theme.text.body,
              fontWeight: '600',
            }}
          >
            Try again
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.center, { padding: theme.spacing.xl }]}>
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: theme.text.body,
          fontWeight: '600',
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      {body ? (
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.text.caption,
            textAlign: 'center',
            marginTop: theme.spacing.xs,
          }}
        >
          {body}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  retryButton: { alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, minWidth: 120 },
});
