/**
 * Auth context: session restore on cold start, sign-in/sign-out orchestration,
 * and the bridge between token storage and the in-memory auth store that the
 * router guards read.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

import { queryClient } from '../api/queryClient';
import { useAuthStore } from '../state/authStore';
import {
  restoreSession,
  signIn as oauthSignIn,
  signOut as oauthSignOut,
  type SignInResult,
} from './authSession';
import { clearTokens } from './tokenStore';
import { fireAndForget, logger } from '../lib/logger';
import { registerPush, unregisterPush } from '../notifications/registerPush';

export interface AuthContextValue {
  isAuthenticated: boolean;
  isRestoring: boolean;
  signIn(): Promise<SignInResult>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isRestoring = useAuthStore((s) => s.isRestoring);
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);
  const setRestoring = useAuthStore((s) => s.setRestoring);

  // Cold-start restore: a valid or refreshable token marks the session as
  // authenticated; the biometric gate independently keeps content locked.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const restored = await restoreSession();
        if (!cancelled) setAuthenticated(restored);
      } catch (error) {
        // Stay signed out (the initial state); never an unhandled rejection.
        logger.error('session restore threw; remaining signed out', { error });
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setAuthenticated, setRestoring]);

  const signIn = useCallback(async (): Promise<SignInResult> => {
    const result = await oauthSignIn();
    if (result.status === 'success') {
      setAuthenticated(true);
      // Contextual push prompt after auth completes. Fire-and-forget, but
      // never silent: registerPush logs every non-registered outcome itself,
      // and fireAndForget reports any unexpected rejection.
      fireAndForget(registerPush(), 'registerPush');
    }
    return result;
  }, [setAuthenticated]);

  const signOut = useCallback(async (): Promise<void> => {
    // Remove this device's push registration while we still hold a token.
    await unregisterPush();
    try {
      await oauthSignOut();
    } catch (error) {
      logger.warn('OAuth sign-out failed; clearing local tokens anyway', {
        error,
      });
      await clearTokens();
    }
    queryClient.clear();
    setAuthenticated(false);
  }, [setAuthenticated]);

  const value = useMemo(
    () => ({ isAuthenticated, isRestoring, signIn, signOut }),
    [isAuthenticated, isRestoring, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
