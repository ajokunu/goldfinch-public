/**
 * Expo push registration (client side of the notifications part, P7-8).
 *
 * Flow (invoked AFTER Cognito auth completes -- contextual prompt, never on
 * cold start): check/request notification permission, ensure the Android
 * channel exists, mint the Expo push token for this EAS project, and POST it
 * to the API (POST /devices/push-token, shared RegisterPushTokenRequest DTO)
 * keyed by a stable device id. On sign-out, unregisterPush() deletes the
 * registration server-side (DELETE /devices/push-token/{deviceId}).
 *
 * Failure policy (P7-10, no silent void): every non-registered outcome is
 * logged here with context -- callers may fire-and-forget registerPush()
 * because this module owns the reporting. It must keep working in Expo Go /
 * web by returning 'unsupported' (logged), never crashing.
 *
 * APNs/FCM credentials live in EAS credentials; the server relays through the
 * Expo Push Service.
 */
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import { ENV, SECURE_KEYS } from '../config';
import { logger } from '../lib/logger';
import { secureStorage } from '../lib/storage';
import { registerPushToken, unregisterPushToken } from '../api/endpoints';

const pushLogger = logger.child({ module: 'registerPush' });

export type RegisterPushResult =
  | { status: 'registered'; token: string; deviceId: string }
  | { status: 'denied' }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; message: string };

/** Foreground presentation: banner + list, silent, no badge churn. */
export function configureNotificationHandling(): void {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Stable per-install device id: vendor/install id where the platform offers
 * one, otherwise a generated UUID persisted in secure storage.
 */
export async function getDeviceId(): Promise<string> {
  if (Platform.OS === 'android') {
    const androidId = Application.getAndroidId();
    if (androidId) return androidId;
  }
  if (Platform.OS === 'ios') {
    const vendorId = await Application.getIosIdForVendorAsync();
    if (vendorId) return vendorId;
  }
  const existing = await secureStorage.getItem(SECURE_KEYS.deviceId);
  if (existing) return existing;
  const generated = Crypto.randomUUID();
  await secureStorage.setItem(SECURE_KEYS.deviceId, generated);
  return generated;
}

function resolveEasProjectId(): string | null {
  if (ENV.easProjectId) return ENV.easProjectId;
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: string } }
    | undefined;
  const projectId = extra?.eas?.projectId;
  return projectId ? projectId : null;
}

export async function registerPush(): Promise<RegisterPushResult> {
  if (Platform.OS === 'web') {
    const reason = 'Expo push is native-only';
    pushLogger.info('Push registration skipped', { reason });
    return { status: 'unsupported', reason };
  }
  if (!Device.isDevice) {
    const reason = 'Push requires a physical device';
    pushLogger.info('Push registration skipped', { reason });
    return { status: 'unsupported', reason };
  }
  const projectId = resolveEasProjectId();
  if (!projectId) {
    const reason = 'EAS project id is not configured (EAS_PROJECT_ID)';
    // A real misconfiguration in standalone builds; expected in Expo Go.
    pushLogger.warn('Push registration skipped', { reason });
    return { status: 'unsupported', reason };
  }

  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') {
      pushLogger.info('Push permission denied by user', { permission: status });
      return { status: 'denied' };
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    const deviceId = await getDeviceId();

    await registerPushToken({
      deviceId,
      expoPushToken: tokenResponse.data,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });

    pushLogger.info('Push token registered', {
      deviceId,
      platform: Platform.OS,
    });
    return { status: 'registered', token: tokenResponse.data, deviceId };
  } catch (error) {
    pushLogger.error('Push registration failed', { error });
    return {
      status: 'error',
      message:
        error instanceof Error ? error.message : 'Push registration failed',
    };
  }
}

/**
 * Delete this device's registration server-side (called before sign-out).
 * Best effort -- a stale token is also pruned by the server's receipt sweep --
 * but failures are logged, never swallowed silently.
 */
export async function unregisterPush(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const deviceId = await getDeviceId();
    await unregisterPushToken(deviceId);
    pushLogger.info('Push token unregistered', { deviceId });
  } catch (error) {
    pushLogger.warn('Push unregistration failed (server sweep will prune)', {
      error,
    });
  }
}
