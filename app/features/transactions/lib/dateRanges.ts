/**
 * Date-range presets + period scope for the transactions filter bar.
 *
 * Two surfaces share this module:
 *  - The FilterBar's date-scope segmented control (P11-5): This Week / This
 *    Month / This Year / Custom. The first three are backed by the SHARED
 *    `periodWindow` (the single source for the current weekly/monthly/yearly
 *    calendar window in DEFAULT_TZ), so the Activity scope and the Budget
 *    spend windows always agree. Custom hands off to the existing from/to
 *    picker (the FilterSheet preset radio list below) unchanged.
 *  - The FilterSheet's preset radio list (pre-P11): the longer-window presets
 *    (30/90 days, YTD, 12 months) computed on the user's local calendar.
 *
 * The API treats from/to as inclusive yyyy-mm-dd bounds. Every preset stays
 * within the server's MAX_RANGE_DAYS (366) cap, so no preset can trigger
 * RANGE_TOO_LARGE. Default scope is This Month (P11-5; the pre-P11 list
 * defaulted to the last 90 days, kept as the Custom list's default selection).
 */
import type { BudgetPeriod, IsoDate } from '@goldfinch/shared/types';
import { periodWindow } from '@goldfinch/shared/periodWindow';

import type { I18nKey } from '../../../src/i18n';
import { toIsoDate } from '../../../src/lib/dates';

/**
 * Date-scope control values (P11-5). The three period scopes resolve through
 * the shared `periodWindow`; `custom` keeps the existing from/to preset list.
 */
export type DateScope = 'thisWeek' | 'thisMonth' | 'thisYear' | 'custom';

/** The BudgetPeriod each non-custom scope maps onto for `periodWindow`. */
const SCOPE_PERIOD: Readonly<Record<Exclude<DateScope, 'custom'>, BudgetPeriod>> = {
  thisWeek: 'weekly',
  thisMonth: 'monthly',
  thisYear: 'yearly',
};

export interface DateScopeOption {
  scope: DateScope;
  /** Short label (I18nKey) rendered on the segmented control. */
  label: I18nKey;
}

/** Segmented control order (P11-5): Week / Month / Year / Custom. */
export const DATE_SCOPE_OPTIONS: readonly DateScopeOption[] = [
  { scope: 'thisWeek', label: 'Week' },
  { scope: 'thisMonth', label: 'Month' },
  { scope: 'thisYear', label: 'Year' },
  { scope: 'custom', label: 'Custom' },
] as const;

/** Default scope (P11-5): This Month preserves the pre-P11 default window. */
export const DEFAULT_DATE_SCOPE: DateScope = 'thisMonth';

export type DateRangePresetId =
  | 'thisMonth'
  | 'last30'
  | 'last90'
  | 'ytd'
  | 'last12mo';

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export interface DateRangePreset {
  id: DateRangePresetId;
  /** Short label rendered on the filter chip. */
  label: string;
}

export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { id: 'last30', label: '30 days' },
  { id: 'last90', label: '90 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last12mo', label: '12 months' },
] as const;

/** Default selection within the Custom preset list (pre-P11 default window). */
export const DEFAULT_DATE_RANGE_PRESET: DateRangePresetId = 'last90';

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function daysAgo(days: number, now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - days);
  return d;
}

/**
 * Resolve a non-custom period scope to inclusive from/to bounds via the SHARED
 * `periodWindow` (DEFAULT_TZ calendar). `now` is injectable for tests; defaults
 * to the current instant.
 */
export function resolveScopeRange(
  scope: Exclude<DateScope, 'custom'>,
  now: Date = new Date(),
): DateRange {
  return periodWindow(SCOPE_PERIOD[scope], now);
}

/**
 * Resolve a Custom preset to inclusive from/to bounds. `now` is injectable for
 * tests; defaults to the current wall-clock date.
 */
export function resolveDateRange(
  preset: DateRangePresetId,
  now: Date = new Date(),
): DateRange {
  const to = toIsoDate(now);
  switch (preset) {
    case 'thisMonth':
      return { from: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`, to };
    case 'last30':
      return { from: toIsoDate(daysAgo(29, now)), to };
    case 'last90':
      return { from: toIsoDate(daysAgo(89, now)), to };
    case 'ytd':
      return { from: `${now.getFullYear()}-01-01`, to };
    case 'last12mo':
      return { from: toIsoDate(daysAgo(364, now)), to };
  }
}
