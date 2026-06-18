/**
 * Per-card empty and error primitives. Each dashboard card composes:
 * isPending -> CardSkeleton, isError -> ErrorState (with refetch), empty data
 * -> EmptyState, else content. Icons are lucide-react-native (no emoji).
 */
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CircleAlert, type LucideProps } from 'lucide-react-native';

import { useTheme } from '../../../src/ui/ThemeProvider';
import { Card } from './Card';

export function EmptyState({
  icon: IconComponent,
  title,
  message,
}: {
  icon: ComponentType<LucideProps>;
  title: string;
  message?: string;
}) {
  const theme = useTheme();
  return (
    <Card>
      <View style={[styles.center, { paddingVertical: theme.spacing.lg }]}>
        <IconComponent size={28} color={theme.colors.textSecondary} />
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.body,
            fontWeight: '600',
            marginTop: theme.spacing.sm,
            textAlign: 'center',
          }}
        >
          {title}
        </Text>
        {message ? (
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: theme.text.caption,
              marginTop: theme.spacing.xs,
              textAlign: 'center',
            }}
          >
            {message}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message?: string;
  onRetry: () => void;
}) {
  const theme = useTheme();
  return (
    <Card>
      <View style={[styles.center, { paddingVertical: theme.spacing.lg }]}>
        <CircleAlert size={28} color={theme.colors.danger} />
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.body,
            fontWeight: '600',
            marginTop: theme.spacing.sm,
            textAlign: 'center',
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.text.caption,
            marginTop: theme.spacing.xs,
            textAlign: 'center',
          }}
        >
          {message ?? 'Something went wrong while loading this section.'}
        </Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={({ pressed }) => [
            styles.retryButton,
            {
              backgroundColor: theme.colors.accent,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.sm,
              marginTop: theme.spacing.md,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text
            style={{
              color: theme.colors.onAccent,
              fontSize: theme.text.body,
              fontWeight: '600',
            }}
          >
            Try again
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  retryButton: { alignItems: 'center', minWidth: 120 },
});
