/**
 * Dashboard-local parameterized labels (shell.md 8.3 pattern). These are
 * month-templated sentences the shared i18n table deliberately excludes
 * ([PARAM] rows): Korean word order forbids concatenating t() fragments, so
 * each is a typed pure (lang, args) -> string function, mirroring
 * app/src/i18n/messages.ts.
 *
 * Month names are produced by `isoMonthName` via Intl in the active locale
 * (with a logged fallback when Intl rejects the locale); money strings never
 * pass through here.
 */
import type { IsoMonth } from '@goldfinch/shared/types';
import type { Lang } from '../../../src/i18n/strings';
import { logger } from '../../../src/lib/logger';

const log = logger.child({ screen: 'dashboard', module: 'labels' });

/** "June" / "6월" -- month name only (isoMonthLabel includes the year). */
export function isoMonthName(month: IsoMonth, locale: string): string {
  const year = Number.parseInt(month.slice(0, 4), 10);
  const monthIndex = Number.parseInt(month.slice(5, 7), 10) - 1;
  if (Number.isNaN(year) || Number.isNaN(monthIndex)) return month;
  const date = new Date(Date.UTC(year, monthIndex, 1));
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'long',
      timeZone: 'UTC',
    }).format(date);
  } catch (error) {
    log.warn('month-name formatting failed; falling back to iso month', {
      month,
      locale,
      error,
    });
    return month;
  }
}

/** Spending-card title: "June spending" / "6월 지출" (prototype KO table). */
export function monthSpendingTitle(lang: Lang, monthName: string): string {
  return lang === 'ko' ? `${monthName} 지출` : `${monthName} spending`;
}

/**
 * Header date line: "Tuesday, June 10" / "6월 10일 화요일". Locale-formatted
 * from the device clock (screens.md 1.2); falls back to the ISO date when
 * Intl rejects the locale.
 */
export function headerDateLine(locale: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(now);
  } catch (error) {
    log.warn('header date-line formatting failed; falling back to iso date', {
      locale,
      error,
    });
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
}
