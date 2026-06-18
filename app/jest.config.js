/**
 * Jest configuration for the app workspace's component/integration suite
 * (DESIGN-INTEGRATION-DECISIONS item 6: jest-expo +
 * @testing-library/react-native with per-screen integration tests over a
 * mocked API).
 *
 * The jest-expo preset is spread (not referenced via `preset:`) so its
 * moduleNameMapper can be EXTENDED rather than replaced: the @goldfinch/*
 * workspace packages publish ESM with `import`-only export conditions that
 * Jest's CommonJS resolver cannot follow, so they are mapped straight to
 * their built dist files (the exact artifacts Metro bundles at runtime).
 * Those files live outside node_modules (workspace symlinks resolve to
 * packages/), so babel-jest transforms their ESM via the app babel config.
 *
 * The node --test unit suites (src/ui, src/i18n, features/*) keep running
 * through `npm run test:unit`; testMatch here is restricted to <rootDir>/test
 * so the two harnesses never double-run each other's files.
 */
const expoPreset = require('jest-expo/jest-preset');

/** @type {import('jest').Config} */
module.exports = {
  ...expoPreset,
  rootDir: __dirname,
  testMatch: ['<rootDir>/test/**/*.test.ts', '<rootDir>/test/**/*.test.tsx'],
  // Skia's official jestSetup replaces @shopify/react-native-skia with its
  // CanvasKit-free mock (no native bindings exist under jest); the motion
  // delight primitives (ParticleBurst, RefreshMark) import Skia statically
  // through the src/ui/motion barrel, so every suite that touches the barrel
  // needs the mock registered globally.
  setupFiles: [
    ...(expoPreset.setupFiles ?? []),
    '@shopify/flash-list/jestSetup',
    '@shopify/react-native-skia/jestSetup',
  ],
  setupFilesAfterEnv: [
    ...(expoPreset.setupFilesAfterEnv ?? []),
    '<rootDir>/test/setup.ts',
  ],
  moduleNameMapper: {
    ...(expoPreset.moduleNameMapper ?? {}),
    '^@goldfinch/shared$': '<rootDir>/../packages/shared/dist/index.js',
    '^@goldfinch/shared/types$':
      '<rootDir>/../packages/shared/dist/types/index.js',
    '^@goldfinch/shared/(.*)$': '<rootDir>/../packages/shared/dist/$1.js',
    '^@goldfinch/testing$': '<rootDir>/../packages/testing/dist/index.js',
  },
  // The preset's whitelist, plus phosphor-react-native: src/ui/icons/glyphs.ts
  // deep-imports its per-icon TS source files (phosphor-react-native/src/...),
  // which babel-jest must transform like any other RN-ecosystem TS package.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|phosphor-react-native|@shopify/react-native-skia))',
    '/node_modules/react-native-reanimated/plugin/',
  ],
  // Keep jest away from the expo export output and the node --test compiled
  // trees (dist-test) so their .test.js files are never collected twice.
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/dist-test/'],
};
