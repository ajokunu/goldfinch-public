/**
 * Device fan-out: load PUSHTOKEN# rows, skip disabled ones, validate format,
 * send via the Expo relay, persist PUSHTICKET# rows for the receipt sweep, and
 * disable tokens that fail immediately (malformed, or the ticket itself says
 * DeviceNotRegistered).
 *
 * The outcome reports PER-MESSAGE acceptance: a message is "accepted" when at
 * least one device ticket came back ok. The handler writes SENTNOTIF# dedup
 * markers ONLY for accepted messages (P7-8 marker-after-send), so a relay or
 * transport failure leaves no marker and the next run retries. A relay/
 * transport error is logged and degrades to zero acceptance -- never a crash.
 */

import { userPk } from '@goldfinch/shared/keys';
import { SCHEMA_VERSION } from '@goldfinch/shared/constants';
import type { Logger } from '@goldfinch/shared/logger';
import type { PushTokenItem } from '@goldfinch/shared/types';
import {
  DEVICE_NOT_REGISTERED,
  isExpoPushToken,
  type ExpoClient,
  type ExpoPushMessage,
} from './expo.js';
import { pushTicketSk } from './keys.js';
import type { OutboundMessage } from './payload.js';
import type { NotificationStore } from './store.js';
import type { NotificationKind, PushTicketItem } from './types.js';

/** Ticket rows expire 25h after send: receipts live 24h, plus one hour of slack. */
export const TICKET_TTL_SECONDS = 25 * 60 * 60;

export interface SendDeps {
  store: NotificationStore;
  expo: ExpoClient;
  household: string;
  logger: Logger;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

/** One notification to fan out, tagged with its class for the ticket rows. */
export interface KindedMessage {
  kind: NotificationKind;
  message: OutboundMessage;
}

export interface SendOutcome {
  /** Device-messages handed to Expo (valid devices x notifications). */
  attempted: number;
  /** accepted[i] is true when notifications[i] got at least one ok ticket. */
  accepted: boolean[];
  /** deviceIds disabled in this call (invalid token format or DeviceNotRegistered ticket). */
  disabledTokens: string[];
  /** Ticket rows persisted for the receipt sweep. */
  tickets: PushTicketItem[];
}

/**
 * Sends each notification to every registered, enabled device. Tokens with an
 * invalid format are disabled inline (never sent to Expo). Tickets that
 * immediately return DeviceNotRegistered disable their token too; other ticket
 * errors are logged and dropped (no ticket row -- there is no receipt to
 * sweep). A thrown relay error logs and returns all-unaccepted.
 */
export async function sendNotifications(
  deps: SendDeps,
  notifications: readonly KindedMessage[],
): Promise<SendOutcome> {
  const now = deps.now ?? (() => new Date());
  const { logger } = deps;
  const outcome: SendOutcome = {
    attempted: 0,
    accepted: notifications.map(() => false),
    disabledTokens: [],
    tickets: [],
  };
  if (notifications.length === 0) return outcome;

  const nowIso = now().toISOString();
  const tokenRows = await deps.store.loadPushTokens();
  const validRows: PushTokenItem[] = [];
  for (const row of tokenRows) {
    if (row.disabledAt !== undefined && row.disabledAt !== null) {
      continue; // already known dead; kept for history per the shared contract
    }
    if (isExpoPushToken(row.expoPushToken)) {
      validRows.push(row);
    } else {
      logger.warn('disabling push token with invalid format', { deviceId: row.deviceId });
      await deps.store.disablePushToken(row, nowIso);
      outcome.disabledTokens.push(row.deviceId);
    }
  }
  if (validRows.length === 0) {
    logger.info('no enabled push tokens registered; nothing sent', {
      notifications: notifications.length,
    });
    return outcome;
  }

  // Token-major fan-out with explicit parallel target/source arrays, so
  // ticket[i] always maps back to its device AND its source notification.
  const messages: ExpoPushMessage[] = [];
  const targets: PushTokenItem[] = [];
  const sourceIndex: number[] = [];
  for (const row of validRows) {
    for (let n = 0; n < notifications.length; n += 1) {
      const notification = notifications[n];
      if (notification === undefined) continue;
      messages.push({ ...notification.message, to: row.expoPushToken });
      targets.push(row);
      sourceIndex.push(n);
    }
  }

  let tickets;
  try {
    tickets = await deps.expo.sendPushMessages(messages);
  } catch (error) {
    // Degraded mode (P7-8): relay/transport failure must not crash the run.
    // Nothing is accepted, so no SENTNOTIF# marker is written and the next
    // SyncCompleted event retries the whole batch.
    logger.error('expo push send failed; no messages accepted, will retry next run', {
      error,
      messages: messages.length,
    });
    return outcome;
  }
  outcome.attempted = messages.length;

  const sentAt = now();
  const sentAtIso = sentAt.toISOString();
  const sentAtMs = sentAt.getTime();
  const ttl = Math.floor(sentAtMs / 1000) + TICKET_TTL_SECONDS;
  const alreadyDisabled = new Set<string>();

  for (let i = 0; i < tickets.length; i += 1) {
    const ticket = tickets[i];
    const target = targets[i];
    const source = sourceIndex[i];
    if (ticket === undefined || target === undefined || source === undefined) continue;
    const kind = notifications[source]?.kind ?? 'sync';

    if (ticket.status === 'ok') {
      outcome.accepted[source] = true;
      outcome.tickets.push({
        PK: userPk(deps.household),
        SK: pushTicketSk(sentAtMs, ticket.id),
        entityType: 'PUSH_TICKET',
        schemaVersion: SCHEMA_VERSION,
        ticketId: ticket.id,
        deviceId: target.deviceId,
        token: target.expoPushToken,
        kind,
        sentAt: sentAtIso,
        ttl,
      });
      continue;
    }

    if (ticket.details?.error === DEVICE_NOT_REGISTERED) {
      if (!alreadyDisabled.has(target.deviceId)) {
        alreadyDisabled.add(target.deviceId);
        logger.warn('disabling push token: ticket says DeviceNotRegistered', {
          deviceId: target.deviceId,
        });
        await deps.store.disablePushToken(target, sentAtIso);
        outcome.disabledTokens.push(target.deviceId);
      }
      continue;
    }

    logger.warn('expo push ticket error (dropped)', {
      deviceId: target.deviceId,
      kind,
      error: ticket.details?.error,
      message: ticket.message,
    });
  }

  if (outcome.tickets.length > 0) {
    await deps.store.putPushTickets(outcome.tickets);
  }
  return outcome;
}
