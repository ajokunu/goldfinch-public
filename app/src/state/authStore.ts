/**
 * In-memory auth/lock state (deliberately NOT persisted so a killed app
 * restarts locked; master plan section 12, decision 3).
 */
import { create } from 'zustand';

export interface AuthState {
  /** True once a usable (valid or refreshable) Cognito session exists. */
  isAuthenticated: boolean;
  /** True while the cold-start session restore is running. */
  isRestoring: boolean;
  /** Biometric gate state; starts locked on every cold start. */
  isUnlocked: boolean;
  setAuthenticated(value: boolean): void;
  setRestoring(value: boolean): void;
  setUnlocked(value: boolean): void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  isAuthenticated: false,
  isRestoring: true,
  isUnlocked: false,
  setAuthenticated: (value) => set({ isAuthenticated: value }),
  setRestoring: (value) => set({ isRestoring: value }),
  setUnlocked: (value) => set({ isUnlocked: value }),
}));
