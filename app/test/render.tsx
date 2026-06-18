/**
 * Provider harness for the per-screen integration tests: a fresh TanStack
 * QueryClient per render (retry disabled -- the production retry policy is
 * exercised by the API-layer tests, not the screen suite) inside the REAL
 * ThemeProvider, so every render path resolves actual theme tokens, waits for
 * the persisted-preference rehydration, and re-renders on theme switches
 * exactly like production.
 *
 * The optional theme probe surfaces the resolved theme tokens as text so
 * tests can assert that switching direction/mode actually changes what
 * consumers of useTheme() resolve.
 */
import type { ReactElement } from 'react';
import { Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { render, type RenderResult } from '@testing-library/react-native';

import { ThemeProvider, useTheme } from '../src/ui/ThemeProvider';

export const THEME_PROBE_TEST_ID = 'theme-probe';

/** Renders the resolved theme identity + a few load-bearing tokens as text. */
export function ThemeProbe() {
  const theme = useTheme();
  return (
    <Text testID={THEME_PROBE_TEST_ID}>
      {[
        theme.direction,
        theme.mode,
        theme.colors.accent,
        theme.colors.bg,
        String(theme.radius.card),
        theme.fonts.display,
      ].join('|')}
    </Text>
  );
}

export interface RenderWithProvidersOptions {
  /** Mount the theme probe next to the screen under test. */
  withThemeProbe?: boolean;
}

export interface ProviderRenderResult extends RenderResult {
  queryClient: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): ProviderRenderResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });

  const result = render(
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {ui}
          {options.withThemeProbe === true ? <ThemeProbe /> : null}
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );

  return Object.assign(result, { queryClient });
}
