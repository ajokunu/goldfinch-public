/**
 * Pure i18n lookup (shell.md 8.2; StrykerJS mutation target). Keys are the
 * English source strings, so English rendering is the key itself and Korean
 * rendering is the table value. No fallback branch exists at runtime because
 * I18nKey statically guarantees every key has a Korean value.
 */
import { ko, type I18nKey, type Lang } from './strings';

/** Render `key` in `lang`. English is the identity; Korean is the table. */
export function translate(lang: Lang, key: I18nKey): string {
  return lang === 'ko' ? ko[key] : key;
}
