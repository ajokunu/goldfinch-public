/**
 * Device-locale detection for the 'system' language setting (shell.md 8.4).
 *
 * Uses Intl.DateTimeFormat().resolvedOptions().locale, which is available on
 * Hermes and on web -- deliberately no expo-localization dependency (installs
 * are forbidden by the integration decisions). This is the impure half of
 * language resolution; the pure mapping lives in ./resolve.ts so the fallback
 * path is unit-testable without mocking Intl.
 */
import { logger } from '../lib/logger';

/**
 * The device's BCP-47 locale, or null when detection fails (the caller's
 * resolveLang treats null as English).
 */
export function detectSystemLocale(): string | null {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    return typeof locale === 'string' && locale.length > 0 ? locale : null;
  } catch (error) {
    logger.warn('system locale detection failed; defaulting to en', { error });
    return null;
  }
}
