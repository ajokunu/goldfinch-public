/**
 * Sort-key builders for the notification item families that live in the
 * GoldFinch single table. The partition key is always the shared household
 * partition built with `userPk()` from @goldfinch/shared/keys.
 *
 * PUSHTOKEN#<deviceId> was promoted into @goldfinch/shared/keys in Phase 7
 * (the API's POST /devices/push-token route writes it); this module re-exports
 * the shared builder so older imports keep compiling. Still service-local:
 *   PUSHTICKET#<sentAtEpochMs>#<ticketId>       Expo push ticket awaiting its
 *                                               receipt (TTL sentAt + 25h)
 *   SENTNOTIF#<period>#<categoryId>#<threshold> budget-threshold dedup marker,
 *                                               written ONLY after the relay
 *                                               accepted the send (P7-8)
 */

import { KEY_PREFIX, KeyError } from '@goldfinch/shared/keys';
import type { IsoMonth } from '@goldfinch/shared/types';

export { pushTokenSk, type PushTokenSk } from '@goldfinch/shared/keys';

export type PushTicketSk = `PUSHTICKET#${string}#${string}`;
export type SentNotifSk = `SENTNOTIF#${string}#${string}#${string}`;

/** Prefixes for `begins_with` key conditions. */
export const NOTIF_KEY_PREFIX = {
  pushToken: KEY_PREFIX.pushToken,
  pushTicket: 'PUSHTICKET#',
  sentNotif: 'SENTNOTIF#',
} as const;

const ISO_MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** Reject empty components and '#' injection that would corrupt composite keys. */
function assertComponent(label: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new KeyError(`${label} must be a non-empty string`);
  }
  if (value.includes('#')) {
    throw new KeyError(`${label} must not contain "#" (got "${value}")`);
  }
}

export function assertIsoMonth(value: string): asserts value is IsoMonth {
  if (!ISO_MONTH_PATTERN.test(value)) {
    throw new KeyError(`expected yyyy-mm month, got "${value}"`);
  }
}

/**
 * Epoch-milliseconds first so tickets sort chronologically; 13-digit ms epochs have a
 * constant width until the year 2286, so lexicographic order == chronological order.
 */
export function pushTicketSk(sentAtEpochMs: number, ticketId: string): PushTicketSk {
  if (!Number.isSafeInteger(sentAtEpochMs) || sentAtEpochMs <= 0) {
    throw new KeyError(`sentAtEpochMs must be a positive integer, got ${sentAtEpochMs}`);
  }
  assertComponent('ticketId', ticketId);
  return `PUSHTICKET#${sentAtEpochMs}#${ticketId}`;
}

export function sentNotifSk(
  period: IsoMonth,
  categoryId: string,
  threshold: number,
): SentNotifSk {
  assertIsoMonth(period);
  assertComponent('categoryId', categoryId);
  if (!Number.isSafeInteger(threshold) || threshold <= 0) {
    throw new KeyError(`threshold must be a positive integer, got ${threshold}`);
  }
  return `SENTNOTIF#${period}#${categoryId}#${threshold}`;
}

/** `begins_with` prefix over one period's dedup markers. */
export function sentNotifPeriodPrefix(period: IsoMonth): `SENTNOTIF#${string}#` {
  assertIsoMonth(period);
  return `SENTNOTIF#${period}#`;
}
