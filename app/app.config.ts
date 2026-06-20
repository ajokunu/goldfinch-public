/**
 * Expo app config (master plan section 12).
 *
 * - Expo SDK 54, New Architecture ON (SDK 54 is the last SDK where it can be
 *   disabled; we build New-Arch-native from day one).
 * - OAuth deep-link scheme: goldfinch://callback (native PKCE redirect).
 * - Web is exported as a single-page app (S3 + CloudFront with the 403/404 ->
 *   /index.html rewrite owned by builds-distribution).
 * - APNs .p8 / FCM HTTP v1 credentials live in EAS credentials, never in this
 *   repo and never in AWS (notifications part).
 *
 * Build-time environment:
 * - EAS_PROJECT_ID: the EAS project id (uuid). Required for EAS builds and for
 *   expo-notifications getExpoPushTokenAsync. Set in eas.json env or CI.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'GoldFinch',
  slug: 'goldfinch',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'goldfinch',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  platforms: ['ios', 'android', 'web'],
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: 'com.tabletales.goldfinch',
    supportsTablet: true,
    infoPlist: {
      // Without this key iOS silently downgrades Face ID to passcode.
      NSFaceIDUsageDescription:
        'GoldFinch uses Face ID to unlock your financial data.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.tabletales.goldfinch',
    edgeToEdgeEnabled: true,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundImage: './assets/adaptive-bg.png',
      backgroundColor: '#1E4D3F',
    },
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#FFFFFF',
      },
    ],
    [
      'expo-local-authentication',
      {
        faceIDPermission:
          'GoldFinch uses Face ID to unlock your financial data.',
      },
    ],
    // APNs/FCM credentials are configured once in EAS credentials
    // (builds-distribution / notifications parts), not here.
    'expo-notifications',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      // Project id is public (not a secret); env override supported for forks.
      projectId: process.env.EAS_PROJECT_ID ?? '74773365-bbde-47c0-9d00-4720e0d60b37',
    },
  },
});
