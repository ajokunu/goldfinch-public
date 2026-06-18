/**
 * Replacement for src/auth/AuthProvider in the component suite (wired in
 * test/setup.ts). Screens under test always render as an authenticated,
 * fully-restored session; sign-out becomes an observable spy asserted by the
 * Settings test.
 */
import type { ReactNode } from 'react';

import type { AuthContextValue } from '../src/auth/AuthProvider';

export const signOutSpy: jest.Mock<Promise<void>, []> = jest.fn(
  async () => undefined,
);
export const signInSpy: jest.Mock<Promise<void>, []> = jest.fn(
  async () => undefined,
);

export function resetAuthMock(): void {
  signOutSpy.mockClear();
  signOutSpy.mockImplementation(async () => undefined);
  signInSpy.mockClear();
}

const value: AuthContextValue = {
  isAuthenticated: true,
  isRestoring: false,
  signIn: signInSpy as unknown as AuthContextValue['signIn'],
  signOut: signOutSpy,
};

/** Module shape for `jest.mock('../src/auth/AuthProvider', ...)`. */
export const authProviderModuleMock = {
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: (): AuthContextValue => value,
};
