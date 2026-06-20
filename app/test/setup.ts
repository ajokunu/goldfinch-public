/**
 * Global setup for the component/integration suite (setupFilesAfterEnv).
 *
 * Module replacements (each documented in its own mock module):
 * - expo-secure-store -> deterministic in-memory map (uiStore persistence and
 *   token-store reads).
 * - expo-router -> spy router + pressable Link (screens render outside the
 *   router file tree).
 * - expo-font / expo-splash-screen -> immediate "fonts ready" so the real
 *   ThemeProvider mounts children without the native splash dance.
 * - react-native-safe-area-context -> the library's own jest mock.
 * - src/auth/authSession -> static bearer token; the typed client, endpoint
 *   functions, and TanStack hooks all run for real against the fetch mock.
 * - src/auth/AuthProvider -> authenticated session + sign-out spy.
 * - src/ui/useReducedMotion -> reduced motion ON, the sanctioned
 *   accessibility path in which every entrance/count-up renders its final
 *   value immediately (keeps money/text assertions exact).
 *
 * The fetch-level mockApi is installed once and reset around every test; a
 * request that hits no registered route fails that test in teardown.
 */
import { mockApi } from './mockApi';
import { resetRouterMock } from './expoRouterMock';
import { resetAuthMock } from './authProviderMock';
import { resetSecureStore } from './secureStoreMock';

jest.mock('expo-secure-store', () =>
  require('./secureStoreMock').secureStoreModuleMock,
);

jest.mock('expo-router', () => require('./expoRouterMock').expoRouterModuleMock);

jest.mock('expo-font', () => ({
  useFonts: () => [true, null],
  loadAsync: jest.fn(async () => undefined),
  isLoaded: jest.fn(() => true),
}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => true),
  setOptions: jest.fn(),
}));

jest.mock(
  'react-native-safe-area-context',
  () =>
    (
      require('react-native-safe-area-context/jest/mock') as {
        default: Record<string, unknown>;
      }
    ).default,
);

jest.mock('../src/auth/authSession', () => ({
  getFreshAccessToken: jest.fn(async () => 'test-access-token'),
  refreshTokens: jest.fn(async () => null),
  restoreSession: jest.fn(async () => true),
  signIn: jest.fn(async () => ({ kind: 'success' })),
  signOut: jest.fn(async () => undefined),
}));

jest.mock('../src/auth/AuthProvider', () =>
  require('./authProviderMock').authProviderModuleMock,
);

jest.mock('../src/ui/useReducedMotion', () => {
  const actual = jest.requireActual<
    typeof import('../src/ui/useReducedMotion')
  >('../src/ui/useReducedMotion');
  return { ...actual, useReducedMotion: () => true };
});

// The uiStore module is imported AFTER the mocks above so its persistence
// rides the in-memory secure store.
import { useUiStore } from '../src/state/uiStore';

const UI_DEFAULTS = {
  themeOverride: 'system',
  themeDirection: 'meridian',
  biometricEnabled: true,
  language: 'system',
  reduceAnimations: null,
  accountGrouping: 'type',
} as const;

beforeAll(() => {
  mockApi.install();
});

beforeEach(() => {
  mockApi.reset();
  resetSecureStore();
  resetRouterMock();
  resetAuthMock();
  useUiStore.setState(UI_DEFAULTS);
});

afterEach(() => {
  // Every request a screen makes must have been anticipated by the test.
  expect(mockApi.unmatchedRequests()).toEqual([]);
});

afterAll(() => {
  mockApi.uninstall();
});
