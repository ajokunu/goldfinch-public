/**
 * expo-router replacement for the component suite (wired in test/setup.ts).
 * Screens under test are rendered directly (not through the router file
 * tree), so navigation collapses to observable spies:
 *
 * - useRouter() returns a stable object whose push/replace/back are jest
 *   spies, asserted by the More-hub and dashboard tests.
 * - <Link> renders its children inside a Pressable that records the href on
 *   press, preserving the pressable/accessibility tree of the real Link.
 */
import { createElement, type ReactNode } from 'react';
import { Pressable } from 'react-native';

export const routerMock = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
  dismiss: jest.fn(),
  canGoBack: jest.fn(() => true),
};

/**
 * Route search params surfaced through useLocalSearchParams (the drill-down
 * contract, P8-2). Tests set them BEFORE rendering via setSearchParams();
 * router.setParams stays a spy and does not mutate this object, mirroring a
 * screen that consumed the param on mount.
 */
let searchParams: Record<string, string> = {};

export function setSearchParams(params: Record<string, string>): void {
  searchParams = { ...params };
}

export function resetRouterMock(): void {
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
  routerMock.back.mockClear();
  routerMock.navigate.mockClear();
  routerMock.setParams.mockClear();
  routerMock.dismiss.mockClear();
  routerMock.canGoBack.mockClear();
  searchParams = {};
}

interface LinkProps {
  href: unknown;
  asChild?: boolean;
  children?: ReactNode;
  [key: string]: unknown;
}

function Link({ href, asChild: _asChild, children, ...rest }: LinkProps) {
  return createElement(
    Pressable,
    { ...rest, onPress: () => routerMock.push(href) },
    children,
  );
}

/** Module shape for `jest.mock('expo-router', ...)`. */
export const expoRouterModuleMock = {
  useRouter: () => routerMock,
  router: routerMock,
  Link,
  usePathname: () => '/',
  useLocalSearchParams: () => searchParams,
  useSegments: () => [],
  useFocusEffect: (_effect: () => void) => {},
};
