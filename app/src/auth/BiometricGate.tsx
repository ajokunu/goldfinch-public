/**
 * Biometric lock gate (master plan section 12, decision 7).
 *
 * Behavior:
 * - Locks on COLD START (authStore starts isUnlocked=false in memory).
 * - Re-locks only after the app has been away from the foreground longer than
 *   LOCK_AFTER_MS (5 minutes) -- NOT on every background blip, because
 *   AppState routes through 'background'/'inactive' on app-switch and
 *   screen-lock and a naive lock-on-background prompts constantly.
 * - Face ID / Touch ID / Android biometrics with device-credential fallback.
 * - Disabled (auto-unlock) on web, when the user turned the gate off in
 *   settings, when signed out, or when no biometric hardware is enrolled.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Lock } from 'lucide-react-native';

import { LOCK_AFTER_MS } from '../config';
import { logger } from '../lib/logger';
import { useAuthStore } from '../state/authStore';
import { useUiHydrated, useUiStore } from '../state/uiStore';
import { useTheme } from '../ui/ThemeProvider';

async function canUseBiometrics(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    const securityLevel = await LocalAuthentication.getEnrolledLevelAsync();
    // NONE means no biometrics and no device credential; nothing to gate with.
    return securityLevel !== LocalAuthentication.SecurityLevel.NONE;
  } catch (error) {
    // Treated as "cannot gate" (auto-unlock); never silent (P7-10).
    logger.warn('biometric capability check failed; treating as unavailable', {
      error,
    });
    return false;
  }
}

export function BiometricGate({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const hydrated = useUiHydrated();
  const biometricEnabled = useUiStore((s) => s.biometricEnabled);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const setUnlocked = useAuthStore((s) => s.setUnlocked);

  const gateActive =
    Platform.OS !== 'web' && biometricEnabled && isAuthenticated;

  const [promptFailed, setPromptFailed] = useState(false);
  const promptInFlight = useRef(false);
  const leftForegroundAt = useRef<number | null>(null);

  const promptUnlock = useCallback(async () => {
    if (promptInFlight.current) return;
    promptInFlight.current = true;
    try {
      if (!(await canUseBiometrics())) {
        // No hardware/enrollment to gate with; do not brick the app.
        setUnlocked(true);
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock GoldFinch',
        cancelLabel: 'Cancel',
      });
      if (result.success) {
        setPromptFailed(false);
        setUnlocked(true);
      } else {
        setPromptFailed(true);
      }
    } catch (error) {
      // The gate stays locked and the retry button remains; the failure is
      // logged instead of surfacing as an unhandled rejection (P7-10).
      logger.error('biometric unlock prompt threw', { error });
    } finally {
      promptInFlight.current = false;
    }
  }, [setUnlocked]);

  // Auto-unlock whenever the gate does not apply (web, toggle off, signed out).
  useEffect(() => {
    if (!hydrated) return;
    if (!gateActive && !isUnlocked) {
      setUnlocked(true);
    }
  }, [hydrated, gateActive, isUnlocked, setUnlocked]);

  // Cold-start prompt: the store boots locked; prompt as soon as the gate is
  // active and the persisted toggle has rehydrated.
  useEffect(() => {
    if (hydrated && gateActive && !isUnlocked) {
      void promptUnlock();
    }
  }, [hydrated, gateActive, isUnlocked, promptUnlock]);

  // Inactivity re-lock via AppState.
  useEffect(() => {
    if (!gateActive) return;
    const subscription = AppState.addEventListener(
      'change',
      (status: AppStateStatus) => {
        if (status === 'active') {
          const away = leftForegroundAt.current;
          leftForegroundAt.current = null;
          if (away !== null && Date.now() - away > LOCK_AFTER_MS) {
            setUnlocked(false);
            // The cold-start effect re-prompts because isUnlocked flipped.
          }
        } else if (leftForegroundAt.current === null) {
          // Record when we first left the foreground; quick app-switches that
          // return within the window never lock.
          leftForegroundAt.current = Date.now();
        }
      },
    );
    return () => subscription.remove();
  }, [gateActive, setUnlocked]);

  if (!hydrated) {
    return <View style={[styles.fill, { backgroundColor: theme.colors.bg }]} />;
  }

  if (gateActive && !isUnlocked) {
    return (
      <View style={[styles.fill, styles.center, { backgroundColor: theme.colors.bg }]}>
        <Lock size={40} color={theme.colors.accent} />
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.heading,
            fontWeight: '600',
            marginTop: theme.spacing.md,
          }}
        >
          GoldFinch is locked
        </Text>
        {promptFailed ? (
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: theme.text.body,
              marginTop: theme.spacing.xs,
            }}
          >
            Authentication was cancelled or failed.
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => void promptUnlock()}
          style={({ pressed }) => [
            styles.unlockButton,
            {
              backgroundColor: theme.colors.accent,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.lg,
              paddingVertical: theme.spacing.sm + 2,
              marginTop: theme.spacing.lg,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text
            style={{
              color: theme.colors.onAccent,
              fontSize: theme.text.body,
              fontWeight: '600',
            }}
          >
            Unlock
          </Text>
        </Pressable>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  unlockButton: { alignItems: 'center' },
});
