/**
 * More section: a stack inside the More tab hosting the low-frequency
 * management destinations (see the IA doc in ../(app)/_layout.tsx).
 * The hub (index) lists Goals / Recurring / Rules / Import / Settings.
 *
 * Restyle (design-spec shell.md 3.2): header titles are localized via useT()
 * (re-rendered on language change because the hook reads zustand state) and
 * set in the direction display font; chrome maps to the theme tokens (bg
 * background, text tint, no shadow).
 *
 * Motion (PHASE9-DECISIONS P9-2 item 2): pushes slide with parallax via the
 * motion module's stack transition (platform push on iOS -- which
 * under-slides the outgoing screen -- slide on Android; reduced motion
 * collapses to a fast fade, multiplier 0 disables). react-native-screens
 * does not animate stack pushes on web, so web adds a screenLayout that
 * FadeRises each pushed screen's content in -- the sidebar's "content
 * crossfades" leg for in-stack destinations.
 */
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import type { ReactNode } from 'react';

import { useT } from '../../../src/i18n';
import { FadeRise, useStackTransition } from '../../../src/ui/motion';
import { useTheme } from '../../../src/ui/ThemeProvider';

/** Web-only screen wrapper: pushed content fades in (no native animation). */
function webScreenLayout({ children }: { children: ReactNode }) {
  return <FadeRise style={{ flex: 1 }}>{children}</FadeRise>;
}

export default function MoreStackLayout() {
  const theme = useTheme();
  const t = useT();
  const stackTransition = useStackTransition();

  return (
    <Stack
      screenLayout={Platform.OS === 'web' ? webScreenLayout : undefined}
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.bg },
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: {
          color: theme.colors.textPrimary,
          fontFamily: theme.fonts.display,
        },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.bg },
        ...stackTransition,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="goals" options={{ title: t('Goals') }} />
      <Stack.Screen name="recurring" options={{ title: t('Recurring') }} />
      <Stack.Screen name="rules" options={{ title: t('Rules') }} />
      <Stack.Screen name="import" options={{ title: t('Import') }} />
      <Stack.Screen name="settings" options={{ title: t('Settings') }} />
    </Stack>
  );
}
