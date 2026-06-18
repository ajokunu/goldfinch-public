/**
 * TanStack Query v5 client + RN environment wiring.
 *
 * - staleTime 30s / gcTime 5m / one retry, never retrying 4xx (master plan
 *   section 12 configuration values).
 * - onlineManager driven by expo-network connectivity events on native (the
 *   browser's own online/offline events are kept on web).
 * - focusManager driven by AppState on native so queries refetch when the app
 *   returns to the foreground (window focus handles web).
 */
import { AppState, Platform } from 'react-native';
import * as Network from 'expo-network';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';

import { QUERY_GC_TIME_MS, QUERY_STALE_TIME_MS } from '../config';
import { ApiError, NotAuthenticatedError } from './errors';

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof NotAuthenticatedError) return false;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return true;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME_MS,
      gcTime: QUERY_GC_TIME_MS,
      retry: shouldRetry,
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Wire onlineManager + focusManager to native platform events. Call once from
 * the root layout; returns a cleanup function (used by fast refresh).
 */
export function setupReactQueryManagers(): () => void {
  if (Platform.OS === 'web') {
    // Browser online/offline + visibility events are handled by the defaults.
    return () => {};
  }

  onlineManager.setEventListener((setOnline) => {
    const subscription = Network.addNetworkStateListener((state) => {
      setOnline(state.isConnected === true && state.isInternetReachable !== false);
    });
    return () => subscription.remove();
  });

  const appStateSubscription = AppState.addEventListener('change', (status) => {
    focusManager.setFocused(status === 'active');
  });

  return () => appStateSubscription.remove();
}
