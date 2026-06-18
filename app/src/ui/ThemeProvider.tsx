/**
 * Theme context: persisted direction + mode preference resolved against the
 * system color scheme into one frozen GFTheme, mapped onto React Navigation's
 * theme (so router chrome -- headers, tab bar, backgrounds -- matches on
 * native and web).
 *
 * Font loading (decisions item 3): the union of all four directions' cuts is
 * loaded via expo-font at startup while the native splash screen is held;
 * children do not mount until fonts have settled AND the persisted ui
 * preferences have rehydrated, so first paint is in the user's chosen
 * direction with the right families (no flash-of-wrong-theme). If font
 * loading fails we log and render anyway: release builds fall back to system
 * fonts rather than dead-ending the app.
 *
 * Theme crossfade (PHASE9-DECISIONS P9-2 item 8): direction/mode switches
 * animate the full palette over 350ms through useThemeCrossfade -- a snapshot
 * crossfade overlay on native, a document-level CSS color transition on web
 * -- so the change never hard-repaints. The hook lags the provided theme only
 * mid-transition; useTheme() consumers are byte-for-byte unchanged. Reduced
 * motion / kill switch collapse it to today's instant swap. The hook lives in
 * ThemeRoot, which mounts only once fonts + hydration settle, so the initial
 * resolve (default -> persisted theme behind the splash) never animates.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import {
  DarkTheme as NavDarkTheme,
  DefaultTheme as NavDefaultTheme,
  ThemeProvider as NavThemeProvider,
} from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';

import { logger } from '../lib/logger';
import { useUiHydrated, useUiStore } from '../state/uiStore';
import { THEME_FONT_ASSETS } from './fonts';
// Deep import (not the ./motion barrel): the barrel re-exports CountUp,
// which consumes useTheme from this module -- importing it here would create
// a require cycle. Feature code still consumes the hook via the barrel.
import { useThemeCrossfade } from './motion/useThemeCrossfade';
import { resolveMode, resolveTheme, type GFTheme } from './theme';

// Module scope so the splash holds from the first frame (this module is in
// the root layout's import graph). The promise can reject when the splash is
// already gone (e.g. fast refresh); that is log-worthy, never fatal.
SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
  logger.warn('SplashScreen.preventAutoHideAsync failed; splash may dismiss early', {
    error,
  });
});

const ThemeContext = createContext<GFTheme>(resolveTheme('meridian', 'light'));

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const override = useUiStore((s) => s.themeOverride);
  const direction = useUiStore((s) => s.themeDirection);
  const hydrated = useUiHydrated();
  const [fontsLoaded, fontError] = useFonts(THEME_FONT_ASSETS);

  const theme = useMemo(
    () => resolveTheme(direction, resolveMode(override, systemScheme)),
    [direction, override, systemScheme],
  );

  useEffect(() => {
    if (fontError != null) {
      logger.error('Theme font loading failed; falling back to system fonts', {
        error: fontError,
      });
    }
  }, [fontError]);

  // Hold until fonts settle (loaded or errored) and prefs rehydrate; the
  // native splash stays visible over the null render.
  const ready = (fontsLoaded || fontError != null) && hydrated;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch((error: unknown) => {
        logger.warn('SplashScreen.hideAsync failed', { error });
      });
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return <ThemeRoot target={theme}>{children}</ThemeRoot>;
}

/**
 * Mounted only once the provider is ready: holds the crossfade state so the
 * first theme it ever sees (the persisted one) is its baseline, and every
 * later identity change (Settings direction/mode switch, or the OS scheme
 * flipping under a 'system' preference) crossfades instead of repainting.
 */
function ThemeRoot({
  target,
  children,
}: {
  target: GFTheme;
  children: ReactNode;
}) {
  const { theme, containerRef, overlay } = useThemeCrossfade(target);

  const navTheme = useMemo(() => {
    const base = theme.mode === 'dark' ? NavDarkTheme : NavDefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.colors.accent,
        background: theme.colors.bg,
        card: theme.colors.surface,
        text: theme.colors.text,
        border: theme.colors.border,
        notification: theme.colors.neg,
      },
    };
  }, [theme]);

  return (
    <ThemeContext.Provider value={theme}>
      <NavThemeProvider value={navTheme}>
        <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
        {/* collapsable=false keeps a real native view for the snapshot leg;
            the overlay sits last so it covers exactly what it captured. */}
        <View ref={containerRef} collapsable={false} style={styles.container}>
          {children}
          {overlay}
        </View>
      </NavThemeProvider>
    </ThemeContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});

export function useTheme(): GFTheme {
  return useContext(ThemeContext);
}
