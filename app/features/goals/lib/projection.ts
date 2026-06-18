/**
 * Projected-completion math for savings goals (P7-2).
 *
 * Model: linear pace. The goal's average daily funding rate since creation is
 * progress / elapsedDays; the projection extends that pace until the target
 * is reached. The server computes progress and percentComplete (shared
 * percentUsed); this module derives only the projection the API deliberately
 * does not provide, so it must exist client-side.
 *
 * House money rules: all arithmetic on integer minor units, BigInt-exact for
 * the rate division -- no float ever touches a money value. Date objects
 * appear only for UTC calendar arithmetic (never `new Date('yyyy-mm-dd')`).
 *
 * Pure and platform-neutral (no react-native imports): exercised directly by
 * node --test in test/projection.test.ts.
 */
import type { IsoDate, IsoTimestamp, MinorUnits } from '@goldfinch/shared/types';
import { daysBetween } from '@goldfinch/shared/recurrence';

export class ProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectionError';
  }
}

/**
 * Pace projections further out than ~100 years are noise (e.g. one cent of
 * progress on day one); the UI states "too far out" instead of a fake date.
 */
export const MAX_PROJECTION_DAYS = 36_500;

export type GoalProjection =
  | { kind: 'achieved' }
  | { kind: 'none'; reason: 'no-progress' | 'too-distant' }
  | { kind: 'projected'; date: IsoDate; daysRemaining: number };

export type PaceStatus = 'on-track' | 'behind';

export interface ProjectionInput {
  /** Server-computed progress (linked balance or contribution sum). */
  progressMinor: MinorUnits;
  /** Goal target; must be a positive integer (server invariant). */
  targetMinor: MinorUnits;
  /** Goal creation instant (GoalDto.createdAt); its date part anchors the pace window. */
  createdAt: IsoTimestamp;
  /** Local-calendar today (toIsoDate(new Date()) on the client). */
  today: IsoDate;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoParts(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return null;
  const [, y = '', m = '', d = ''] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1) return null;
  // Day 0 of the NEXT month is the last day of this month (UTC, layout-only).
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return { year, month, day };
}

/** Calendar-correct yyyy-mm-dd check (rejects 2025-02-29, 2026-13-01, ...). */
export function isValidIsoDate(value: string): value is IsoDate {
  return isoParts(value) !== null;
}

/**
 * Shift an ISO date by whole days (negative allowed) with exact UTC calendar
 * math; month/year/leap boundaries handled by Date.UTC day overflow.
 */
export function addDaysToIsoDate(date: IsoDate, days: number): IsoDate {
  const parts = isoParts(date);
  if (parts === null) {
    throw new ProjectionError(`addDaysToIsoDate: invalid IsoDate: ${date}`);
  }
  if (!Number.isSafeInteger(days)) {
    throw new ProjectionError(`addDaysToIsoDate: invalid day count: ${days}`);
  }
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  const yyyy = String(shifted.getUTCFullYear()).padStart(4, '0');
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Project the completion date from the average funding pace since creation.
 *
 * daysRemaining = ceil(remaining * elapsedDays / progress), computed with
 * BigInt so the intermediate product is exact at any safe-integer magnitude.
 * The elapsed window is clamped to >= 1 day (a goal created today with
 * progress already counts one day of pace; a device clock behind the server's
 * createdAt cannot produce a negative window).
 *
 * Throws ProjectionError on malformed input (non-safe integers, target <= 0,
 * invalid dates); UI callers catch + log via safeProjection-style wrappers.
 */
export function projectCompletion(input: ProjectionInput): GoalProjection {
  const { progressMinor, targetMinor, createdAt, today } = input;
  if (!Number.isSafeInteger(progressMinor)) {
    throw new ProjectionError(
      `projectCompletion: progressMinor is not a safe integer: ${progressMinor}`,
    );
  }
  if (!Number.isSafeInteger(targetMinor) || targetMinor <= 0) {
    throw new ProjectionError(
      `projectCompletion: targetMinor must be a positive safe integer: ${targetMinor}`,
    );
  }
  if (!isValidIsoDate(today)) {
    throw new ProjectionError(`projectCompletion: invalid today: ${today}`);
  }
  const createdDate = createdAt.slice(0, 10);
  if (!isValidIsoDate(createdDate)) {
    throw new ProjectionError(
      `projectCompletion: createdAt has no valid date part: ${createdAt}`,
    );
  }

  if (progressMinor >= targetMinor) return { kind: 'achieved' };
  if (progressMinor <= 0) return { kind: 'none', reason: 'no-progress' };

  const elapsedDays = Math.max(1, daysBetween(createdDate, today));
  const remaining = BigInt(targetMinor - progressMinor);
  const progress = BigInt(progressMinor);
  const days = (remaining * BigInt(elapsedDays) + progress - 1n) / progress;
  if (days > BigInt(MAX_PROJECTION_DAYS)) {
    return { kind: 'none', reason: 'too-distant' };
  }
  const daysRemaining = Number(days);
  return {
    kind: 'projected',
    date: addDaysToIsoDate(today, daysRemaining),
    daysRemaining,
  };
}

/**
 * Compare the projection against the user's deadline. Null without a
 * deadline; an unprojectable goal (no progress / too distant) with a deadline
 * is 'behind' -- the current pace cannot reach any finite date.
 */
export function paceStatus(
  projection: GoalProjection,
  targetDate: IsoDate | null | undefined,
): PaceStatus | null {
  if (targetDate === null || targetDate === undefined || targetDate === '') {
    return null;
  }
  if (projection.kind === 'achieved') return 'on-track';
  if (projection.kind === 'none') return 'behind';
  // Lexicographic compare is correct for zero-padded yyyy-mm-dd.
  return projection.date <= targetDate ? 'on-track' : 'behind';
}

export type TargetDateInputResult =
  | { ok: true; value: IsoDate | undefined }
  | { ok: false };

/**
 * Parse the optional target-date form field: blank means "no deadline"
 * (undefined), anything else must be a calendar-valid yyyy-mm-dd.
 */
export function parseTargetDateInput(raw: string): TargetDateInputResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: undefined };
  return isValidIsoDate(trimmed) ? { ok: true, value: trimmed } : { ok: false };
}
