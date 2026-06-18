/**
 * Pure helpers behind the net-worth hero card (design-spec screens.md 1.3):
 * range slicing of the snapshot history and the two-snapshot change pill.
 *
 * Money discipline: everything here is integer math on `netMinor` values
 * (P7-7 posture). The percent is a display-only ratio carried as integer
 * tenths of a percent so no float ever represents money; formatting of the
 * delta amount itself stays on CurrencyAmount/formatMinorAmount.
 */
import type { IsoDate } from '@goldfinch/shared/types';

import { toIsoDate } from '../../../src/lib/dates';

/** Hero range control keys (prototype `3M / 6M / 1Y`). */
export type NetWorthRangeKey = '3M' | '6M' | '1Y';

export interface NetWorthRangeOption {
  key: NetWorthRangeKey;
  months: number;
}

export const NET_WORTH_RANGES: ReadonlyArray<NetWorthRangeOption> = [
  { key: '3M', months: 3 },
  { key: '6M', months: 6 },
  { key: '1Y', months: 12 },
];

export const DEFAULT_NET_WORTH_RANGE: NetWorthRangeKey = '6M';

/** Local-calendar ISO date exactly `months` months before `now`. */
export function rangeStartIsoDate(months: number, now: Date): IsoDate {
  return toIsoDate(
    new Date(now.getFullYear(), now.getMonth() - months, now.getDate()),
  );
}

/**
 * Client-side slice of the snapshot history to the selected trailing window.
 * Items are assumed date-ascending (server order); lexicographic IsoDate
 * comparison is chronological. A window predating the first snapshot simply
 * clamps to everything available.
 */
export function sliceHistoryToRange<T extends { date: IsoDate }>(
  items: readonly T[],
  key: NetWorthRangeKey,
  now: Date = new Date(),
): T[] {
  const option = NET_WORTH_RANGES.find((range) => range.key === key);
  const months = option ? option.months : 6;
  const start = rangeStartIsoDate(months, now);
  return items.filter((item) => item.date >= start);
}

export interface NetWorthDelta {
  /** last.netMinor - previous.netMinor (integer subtraction). */
  deltaMinor: number;
  /**
   * |delta| / |previous| in integer tenths of a percent (e.g. 12 -> "1.2%").
   * null when the previous net is zero (ratio undefined).
   */
  pctTenths: number | null;
}

/**
 * Change between the two most recent snapshots (screens.md 1.3: rendered
 * only when >= 2 snapshots exist -- callers get null otherwise).
 */
export function netWorthDelta(
  items: ReadonlyArray<{ netMinor: number }>,
): NetWorthDelta | null {
  // .at() makes the "fewer than two snapshots" rule and the index guard the
  // SAME check -- a separate length test would be a dead shadow of it.
  const last = items.at(-1);
  const previous = items.at(-2);
  if (last === undefined || previous === undefined) return null;
  const deltaMinor = last.netMinor - previous.netMinor;
  const base = Math.abs(previous.netMinor);
  const pctTenths =
    base === 0 ? null : Math.round((Math.abs(deltaMinor) * 1000) / base);
  return { deltaMinor, pctTenths };
}

/** "12" tenths -> "1.2%"; whole percents drop the ".0" ("20" -> "2%"). */
export function formatPctTenths(pctTenths: number): string {
  const whole = Math.trunc(pctTenths / 10);
  const tenth = Math.abs(pctTenths % 10);
  return tenth === 0 ? `${whole}%` : `${whole}.${tenth}%`;
}
