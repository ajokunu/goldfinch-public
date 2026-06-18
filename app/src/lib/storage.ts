/**
 * Cross-platform key/value storage adapters.
 *
 * - secureStorage: hardware-backed secrets (Cognito tokens). iOS Keychain /
 *   Android Keystore via expo-secure-store. On web, expo-secure-store is
 *   unavailable; we fall back to localStorage. That is an accepted tradeoff
 *   for the web SPA: the tokens are short-lived Cognito JWTs scoped to the
 *   user's own household partition, and the web origin is first-party only.
 * - prefStorage: non-secret preferences (theme override, biometric toggle).
 *   Same backends; exposed as a zustand `StateStorage`.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { logger } from './logger';

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

function webLocalStorage(): KeyValueStorage {
  // P7-10: degraded storage (private mode / quota) keeps working in memory,
  // but each failure is logged with the key NAME (never the value).
  return {
    async getItem(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch (error) {
        logger.warn('web storage read failed; treating key as absent', { key, error });
        return null;
      }
    },
    async setItem(key, value) {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch (error) {
        // Storage unavailable (private mode); session continues in memory.
        logger.warn('web storage write failed; value not persisted', { key, error });
      }
    },
    async removeItem(key) {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch (error) {
        logger.warn('web storage remove failed', { key, error });
      }
    },
  };
}

function nativeSecureStorage(): KeyValueStorage {
  return {
    async getItem(key) {
      return SecureStore.getItemAsync(key);
    },
    async setItem(key, value) {
      await SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
    },
    async removeItem(key) {
      await SecureStore.deleteItemAsync(key);
    },
  };
}

export const secureStorage: KeyValueStorage =
  Platform.OS === 'web' ? webLocalStorage() : nativeSecureStorage();

/** zustand-compatible StateStorage for persisted (non-secret) UI preferences. */
export const prefStorage = {
  getItem: (name: string): Promise<string | null> => secureStorage.getItem(name),
  setItem: (name: string, value: string): Promise<void> =>
    secureStorage.setItem(name, value),
  removeItem: (name: string): Promise<void> => secureStorage.removeItem(name),
};
