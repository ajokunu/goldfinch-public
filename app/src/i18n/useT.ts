/**
 * React bindings for i18n (shell.md 8.2). Language flows from the persisted
 * uiStore preference through these hooks -- the prototype's window.GF_LANG
 * global and remount-by-key trick are NOT integrated. Because the preference
 * is zustand state, every component that calls useT()/useLang() re-renders
 * when the user changes language in Settings.
 */
import { useMemo } from 'react';

import { useUiStore } from '../state/uiStore';
import { resolveLang } from './resolve';
import type { I18nKey, Lang } from './strings';
import { detectSystemLocale } from './systemLocale';
import { translate } from './translate';

/**
 * The active rendering language: the stored preference, resolved against the
 * device locale when the preference is 'system'. Useful alongside the
 * parameterized messages in ./messages.ts and localeTag() date formatting.
 */
export function useLang(): Lang {
  const setting = useUiStore((state) => state.language);
  return useMemo(
    () => resolveLang(setting, setting === 'system' ? detectSystemLocale() : null),
    [setting],
  );
}

/**
 * The t() hook: returns a stable-per-language lookup so it can appear in
 * dependency arrays. Apply ONLY to UI source strings (I18nKey enforces the
 * table at compile time) -- never to API data such as payees, account names,
 * or user category/goal names.
 */
export function useT(): (key: I18nKey) => string {
  const lang = useLang();
  return useMemo(() => (key: I18nKey) => translate(lang, key), [lang]);
}
