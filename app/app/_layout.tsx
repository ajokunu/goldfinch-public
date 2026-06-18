/**
 * Root layout: provider stack + auth-gated navigation tree.
 *
 * Provider order matters:
 *   QueryClientProvider -> ThemeProvider -> AuthProvider -> BiometricGate -> Stack
 *
 * Route protection is declarative (Stack.Protected): the (app) group requires
 * an authenticated session; the (auth) group is only reachable signed out.
 * The biometric gate sits ABOVE the navigator so locked content is never
 * mounted-but-visible behind a modal.
 */
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient, setupReactQueryManagers } from '../src/api/queryClient';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { BiometricGate } from '../src/auth/BiometricGate';
import { configureNotificationHandling } from '../src/notifications/registerPush';
import { RootErrorBoundary } from '../src/ui/RootErrorBoundary';
import { ThemeProvider, useTheme } from '../src/ui/ThemeProvider';

configureNotificationHandling();

function RootNavigator() {
  const { isAuthenticated, isRestoring } = useAuth();
  const theme = useTheme();

  if (isRestoring) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.bg,
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => setupReactQueryManagers(), []);

  return (
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <BiometricGate>
              <RootNavigator />
            </BiometricGate>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </RootErrorBoundary>
  );
}
