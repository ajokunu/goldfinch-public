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
  // EAS Update (OTA): builds embed this URL + a runtimeVersion so JS/asset-only
  // changes ship over-the-air (free, no rebuild). The `appVersion` policy ties
  // runtimeVersion to `version` ("0.1.0"), so an update applies to every build
  // sharing that version; bump `version` whenever NATIVE code/deps change so an
  // OTA can never land on an incompatible binary. Channel is set per-profile in
  // eas.json (production -> "production"). NOTE: builds <= #20 shipped with no
  // updates URL and cannot receive OTA; OTA begins with the next build.
  updates: {
    url: 'https://u.expo.dev/74773365-bbde-47c0-9d00-4720e0d60b37',
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
  ios: {
    bundleIdentifier: 'com.tabletales.goldfinch',
    supportsTablet: true,
    // App Group shared between the app and the WidgetKit extension target
    // (added via @bacons/apple-targets). The WidgetBridge native module writes
    // the weekly-spend snapshot into UserDefaults(suiteName:) under this group
    // and the widget reads it. The SAME group MUST be declared on the widget
    // target's entitlements (targets/widget/expo-target.config.js); omission on
    // either side makes UserDefaults(suiteName:) nil and the widget show no data.
    entitlements: {
      'com.apple.security.application-groups': ['group.com.tabletales.goldfinch'],
    },
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
      backgroundColor: '#0191FC',
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
    // Home-screen widget (WIDGET-PLAN.md tasks 5-8). iOS: @bacons/apple-targets
    // adds the SwiftUI WidgetKit extension target authored under targets/widget/
    // (App Group entitlement declared there + on the app via ios.entitlements
    // above). Android: a custom config plugin injects the Jetpack Glance
    // AppWidget (Kotlin sources, manifest receiver, provider XML, Gradle deps).
    // require()'d (not a static import) so the plugin resolves at prebuild time
    // and the config module stays plain TS for typecheck/tests.
    '@bacons/apple-targets',
    './plugins/withWeeklySpendWidget',
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
