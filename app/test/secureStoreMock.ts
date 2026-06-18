/**
 * In-memory replacement for expo-secure-store, shared by every suite (wired
 * in test/setup.ts via jest.mock). Deterministic storage for the two
 * consumers in the app: the zustand pref persistence (uiStore) and the
 * Cognito token store (profile-claim display reads).
 *
 * Tests seed identity via `seedSecureStore`; `resetSecureStore` runs in the
 * global beforeEach so state never leaks between tests.
 */
const store = new Map<string, string>();

export function seedSecureStore(key: string, value: string): void {
  store.set(key, value);
}

export function resetSecureStore(): void {
  store.clear();
}

/** Module shape consumed by app/src/lib/storage.ts and auth/tokenStore.ts. */
export const secureStoreModuleMock = {
  AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK',
  async getItemAsync(key: string): Promise<string | null> {
    return store.get(key) ?? null;
  },
  async setItemAsync(key: string, value: string): Promise<void> {
    store.set(key, value);
  },
  async deleteItemAsync(key: string): Promise<void> {
    store.delete(key);
  },
};
