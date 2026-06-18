/**
 * Pure language-preference resolution (shell.md 8.4; StrykerJS mutation
 * target). The impure half -- reading the device locale via Intl, with the
 * logged fallback -- lives in ./systemLocale.ts so this module stays a pure
 * (setting, locale) -> Lang function.
 */
import type { Lang, LanguageSetting } from './strings';

/**
 * Resolve the persisted preference to a concrete language.
 *
 * - An explicit 'en' / 'ko' preference wins unconditionally.
 * - 'system' inspects the device locale's primary subtag: Korean ('ko',
 *   'ko-KR', 'ko_KR', any case) resolves to 'ko'; everything else --
 *   including null (detection failed) and lookalike subtags such as 'kok'
 *   (Konkani) -- resolves to 'en'.
 */
export function resolveLang(
  setting: LanguageSetting,
  systemLocale: string | null,
): Lang {
  if (setting !== 'system') return setting;
  if (systemLocale === null) return 'en';
  const normalized = systemLocale.trim().toLowerCase();
  // Primary-subtag match: bare 'ko' or 'ko' followed by a subtag separator
  // (BCP-47 '-' or the POSIX-style '_' some platforms report).
  return normalized === 'ko' ||
    normalized.startsWith('ko-') ||
    normalized.startsWith('ko_')
    ? 'ko'
    : 'en';
}

/**
 * BCP-47 tag for Intl date/number formatting in the active language
 * (shell.md 8.3 "monthLabel and friends": date labels route through
 * Intl / app/src/lib/dates.ts with this locale; money formatting stays on
 * Money / CurrencyAmount and never uses this).
 */
export function localeTag(lang: Lang): 'en-US' | 'ko-KR' {
  return lang === 'ko' ? 'ko-KR' : 'en-US';
}
