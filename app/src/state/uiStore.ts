/**
 * Persisted UI preferences: theme direction + mode override, the
 * biometric-gate toggle, and the i18n language setting (design-spec shell.md
 * 5.3/8.2). Persistence goes through the secure key/value adapter
 * (SecureStore on native, localStorage on web); these values are not secrets.
 *
 * Theme persistence (tokens.md sections 6/10): `themeOverride` is the
 * light/dark/system mode preference (pre-existing key, values unchanged so
 * live users' persisted prefs stay valid); `themeDirection` is the new
 * four-direction choice, defaulting to 'meridian'. Persisted junk (from a
 * rollback or a future build) is coerced back to defaults on rehydration via
 * the pure guards in app/src/ui/themeResolve.ts.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useEffect, useState } from 'react';

import { SECURE_KEYS } from '../config';
import type { LanguageSetting } from '../i18n/strings';
import { logger } from '../lib/logger';
import { prefStorage } from '../lib/storage';
import {
  isThemeDirection,
  isThemeModePreference,
  type ThemeDirection,
  type ThemeModePreference,
} from '../ui/themeResolve';

/** Pre-redesign name for the mode preference; same persisted values. */
export type ThemeOverride = ThemeModePreference;

export interface UiState {
  themeOverride: ThemeOverride;
  /** Theme direction (Settings > Appearance picker), tokens.md section 1. */
  themeDirection: ThemeDirection;
  /** Whether the biometric gate is enabled (native only; ignored on web). */
  biometricEnabled: boolean;
  /**
   * UI language: follow the device locale, or force English/Korean. Read via
   * the src/i18n useT()/useLang() hooks, set from Settings > Language.
   * Persisted blobs written before this field existed rehydrate to the
   * 'system' default through the merge below.
   */
  language: LanguageSetting;
  /**
   * The Settings "Reduce animations" toggle (PHASE9-DECISIONS P9-3 motion
   * kill switch): null mirrors the OS reduced-motion flag; an explicit
   * boolean overrides it. Consumed by src/ui/motion/useMotionSettings.
   */
  reduceAnimations: boolean | null;
  /**
   * Privacy mode (Settings "Open with amounts hidden"). PERSISTED. When true,
   * money values render masked until revealed for the session.
   */
  privacyMode: boolean;
  /**
   * Dashboard Accounts-card grouping toggle (Type vs Bank). PERSISTED so the
   * user's last choice survives reloads; defaults to 'type'.
   */
  accountGrouping: AccountGrouping;
  /**
   * Widget privacy toggle: "Show amounts on widget" (Settings > Privacy, default
   * ON). PERSISTED. When OFF, the weekly-spend widget snapshot carries
   * showAmounts=false so the (native) home-screen widget renders an amount-less
   * indicator. SEPARATE from the per-session privacy-mode eye (privacyMode +
   * valuesRevealed) above.
   */
  showAmountsOnWidget: boolean;
  /**
   * Session-only reveal. NOT persisted (absent from partialize), so every
   * cold open starts hidden when privacyMode is on - the "open hidden"
   * contract. The header eye toggles this; it has no effect when privacyMode
   * is off.
   */
  valuesRevealed: boolean;
  setThemeOverride(value: ThemeOverride): void;
  setThemeDirection(value: ThemeDirection): void;
  setBiometricEnabled(value: boolean): void;
  setLanguage(value: LanguageSetting): void;
  setReduceAnimations(value: boolean | null): void;
  setPrivacyMode(value: boolean): void;
  setAccountGrouping(value: AccountGrouping): void;
  setShowAmountsOnWidget(value: boolean): void;
  toggleValuesRevealed(): void;
}

/** Dashboard Accounts-card grouping toggle (Type vs Bank). */
export type AccountGrouping = 'type' | 'institution';

function isAccountGrouping(value: unknown): value is AccountGrouping {
  return value === 'type' || value === 'institution';
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      themeOverride: 'system',
      themeDirection: 'meridian',
      biometricEnabled: true,
      language: 'system',
      reduceAnimations: null,
      privacyMode: false,
      accountGrouping: 'type',
      showAmountsOnWidget: true,
      valuesRevealed: false,
      setThemeOverride: (value) => set({ themeOverride: value }),
      setThemeDirection: (value) => set({ themeDirection: value }),
      setBiometricEnabled: (value) => set({ biometricEnabled: value }),
      setLanguage: (value) => set({ language: value }),
      setReduceAnimations: (value) => set({ reduceAnimations: value }),
      // Turning privacy mode on always starts hidden (reveal cleared);
      // turning it off makes reveal moot.
      setPrivacyMode: (value) =>
        set({ privacyMode: value, valuesRevealed: false }),
      setAccountGrouping: (value) => set({ accountGrouping: value }),
      setShowAmountsOnWidget: (value) => set({ showAmountsOnWidget: value }),
      toggleValuesRevealed: () =>
        set((s) => ({ valuesRevealed: !s.valuesRevealed })),
    }),
    {
      name: SECURE_KEYS.prefs,
      storage: createJSONStorage(() => prefStorage),
      partialize: (state) => ({
        themeOverride: state.themeOverride,
        themeDirection: state.themeDirection,
        biometricEnabled: state.biometricEnabled,
        language: state.language,
        reduceAnimations: state.reduceAnimations,
        privacyMode: state.privacyMode,
        accountGrouping: state.accountGrouping,
        showAmountsOnWidget: state.showAmountsOnWidget,
        // valuesRevealed is intentionally NOT persisted: every open re-hides.
      }),
      // Persisted values come from disk and may predate or postdate this
      // build; pick each known field explicitly (never blind-spread a disk
      // blob over a store that holds functions) and validate the theme
      // fields so junk never reaches resolveTheme(). An absent
      // themeDirection (pre-redesign installs) is normal and takes the
      // default silently.
      merge: (persisted, current) => {
        const incoming = (persisted ?? {}) as Partial<
          Record<keyof UiState, unknown>
        >;
        if (
          incoming.themeOverride !== undefined &&
          !isThemeModePreference(incoming.themeOverride)
        ) {
          logger.warn('Ignoring unknown persisted themeOverride', {
            value: incoming.themeOverride,
          });
        }
        if (
          incoming.themeDirection !== undefined &&
          !isThemeDirection(incoming.themeDirection)
        ) {
          logger.warn('Ignoring unknown persisted themeDirection', {
            value: incoming.themeDirection,
          });
        }
        return {
          ...current,
          themeOverride: isThemeModePreference(incoming.themeOverride)
            ? incoming.themeOverride
            : current.themeOverride,
          themeDirection: isThemeDirection(incoming.themeDirection)
            ? incoming.themeDirection
            : current.themeDirection,
          biometricEnabled:
            typeof incoming.biometricEnabled === 'boolean'
              ? incoming.biometricEnabled
              : current.biometricEnabled,
          // String check only: unknown-but-string languages keep the i18n
          // hooks' own fallback semantics (shell.md shallow-merge contract).
          language:
            typeof incoming.language === 'string'
              ? (incoming.language as LanguageSetting)
              : current.language,
          // Tri-state: explicit boolean override or null (mirror the OS).
          // Junk (or an absent pre-Phase-9 field) keeps the default.
          reduceAnimations:
            typeof incoming.reduceAnimations === 'boolean' ||
            incoming.reduceAnimations === null
              ? incoming.reduceAnimations
              : current.reduceAnimations,
          privacyMode:
            typeof incoming.privacyMode === 'boolean'
              ? incoming.privacyMode
              : current.privacyMode,
          // Junk (or an absent pre-this-build field) keeps the 'type' default.
          accountGrouping: isAccountGrouping(incoming.accountGrouping)
            ? incoming.accountGrouping
            : current.accountGrouping,
          // Absent pre-widget-build field rehydrates to the ON default.
          showAmountsOnWidget:
            typeof incoming.showAmountsOnWidget === 'boolean'
              ? incoming.showAmountsOnWidget
              : current.showAmountsOnWidget,
        };
      },
      // P7-10: zustand swallows rehydration errors unless a handler is
      // provided; defaults still apply, but the failure must be visible.
      onRehydrateStorage: () => (_state, error) => {
        if (error !== undefined) {
          logger.warn('UI preference rehydration failed; using defaults', { error });
        }
      },
    },
  ),
);

/**
 * True once the persisted preferences have been rehydrated. The biometric
 * gate and the ThemeProvider's splash hold wait for this so a user who
 * disabled the gate is not prompted -- and the wrong theme direction is not
 * painted -- during the brief pre-hydration window.
 */
export function useUiHydrated(): boolean {
  const [hydrated, setHydrated] = useState(useUiStore.persist.hasHydrated());
  useEffect(() => {
    const unsub = useUiStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useUiStore.persist.hasHydrated());
    return unsub;
  }, []);
  return hydrated;
}

/**
 * True when money values should render masked: privacy mode is on AND the
 * session has not been revealed. Gated centrally in Money/CurrencyAmount/
 * CountUp so all 9 features mask without per-feature work.
 */
export function useAmountsHidden(): boolean {
  return useUiStore((s) => s.privacyMode && !s.valuesRevealed);
}

/** Mask string for hidden money values (length-stable, not value-revealing). */
export const HIDDEN_AMOUNT = '••••';

/**
 * Pure mask gate for the SVG/chart/accessibility-label sites that cannot run
 * a hook (charts pass `formatValue`/`accessibilityLabel` plans built outside
 * React, and sankey/donut/line/bar labels render inside SVG). The owning
 * screen reads useAmountsHidden() once and threads the boolean down; every
 * leaf wraps its pre-formatted money string with this helper so a single
 * source of truth decides masking. Returns HIDDEN_AMOUNT when hidden, the
 * formatted value otherwise -- never the real digits when hidden.
 */
export function maskIfHidden(formatted: string, hidden: boolean): string {
  return hidden ? HIDDEN_AMOUNT : formatted;
}

/**
 * Masking-aware formatter pair for feature components that DO render inside
 * React. Returns the live `hidden` flag plus a `mask()` that yields
 * HIDDEN_AMOUNT when amounts are hidden and the already-formatted value
 * otherwise. Call sites that currently embed formatMinorAmount/
 * formatDecimalAmount output in captions, value-flag labels, or
 * accessibilityLabels route the formatted string through `mask()` so the
 * figure is never readable under privacy mode. The flag is returned so a
 * component can thread it into a pure/SVG child via maskIfHidden().
 */
export function useMaskMoney(): {
  hidden: boolean;
  mask: (formatted: string) => string;
} {
  const hidden = useAmountsHidden();
  return { hidden, mask: (formatted) => maskIfHidden(formatted, hidden) };
}
