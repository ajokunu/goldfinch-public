/**
 * Receipt sweep (P7-8): the second Lambda entry point, on an EventBridge
 * Scheduler cron ~15 minutes after the daily sync.
 *
 * A push TICKET with status "ok" only means Expo accepted the message; real
 * delivery failures (DeviceNotRegistered, MessageRateExceeded, credential
 * problems) surface in RECEIPTS that become available ~15 minutes after the
 * send and expire after 24 hours. This handler reads every outstanding
 * PUSHTICKET# row, fetches receipts in chunks of 1000, disables PUSHTOKEN#
 * rows whose receipt says DeviceNotRegistered (sets `disabledAt` per the
 * shared PUSH_TOKEN contract -- registration history is kept), and deletes
 * resolved tickets. Tickets whose receipts are not yet available stay for the
 * next sweep; their 25h TTL guarantees the table never accumulates dead rows.
 *
 * Missing push credentials degrade exactly like the event handler: receipt
 * errors are logged with context, never thrown.
 */

import { pushTokenSk } from '@goldfinch/shared/keys';
import { createLogger, type Logger } from '@goldfinch/shared/logger';
import { chunk, DEVICE_NOT_REGISTERED, RECEIPT_CHUNK_SIZE, type ExpoClient } from './expo.js';
import type { NotificationStore } from './store.js';
import type { SweepResult } from './types.js';

export interface SweepDeps {
  store: NotificationStore;
  expo: ExpoClient;
  logger: Logger;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
}

/** Pure-DI core, exercised directly by unit tests. */
export async function sweepReceipts(deps: SweepDeps): Promise<SweepResult> {
  const { logger } = deps;
  const now = deps.now ?? (() => new Date());
  const tickets = await deps.store.listPushTickets();
  const result: SweepResult = {
    checked: tickets.length,
    deletedTickets: 0,
    disabledTokens: [],
    pending: 0,
  };
  if (tickets.length === 0) return result;

  const receipts: Record<string, import('./expo.js').ExpoPushReceipt> = {};
  for (const part of chunk(tickets, RECEIPT_CHUNK_SIZE)) {
    Object.assign(receipts, await deps.expo.getReceipts(part.map((t) => t.ticketId)));
  }

  // Token rows are loaded once so DeviceNotRegistered receipts can disable
  // the full item (the store writes a whole-item Put, not an Update).
  const tokensByDevice = new Map(
    (await deps.store.loadPushTokens()).map((token) => [token.deviceId, token]),
  );

  const disabledDevices = new Set<string>();
  for (const ticket of tickets) {
    const receipt = receipts[ticket.ticketId];
    if (receipt === undefined) {
      // Not available yet (sent < ~15 min ago); the next sweep or the 25h TTL
      // will take care of it.
      result.pending += 1;
      continue;
    }

    if (receipt.status === 'error') {
      if (receipt.details?.error === DEVICE_NOT_REGISTERED) {
        if (!disabledDevices.has(ticket.deviceId)) {
          disabledDevices.add(ticket.deviceId);
          logger.warn('disabling push token: receipt says DeviceNotRegistered', {
            deviceId: ticket.deviceId,
          });
          const token = tokensByDevice.get(ticket.deviceId);
          if (token !== undefined) {
            await deps.store.disablePushToken(token, now().toISOString());
            result.disabledTokens.push(ticket.deviceId);
          } else {
            // Row already gone (explicit DELETE /devices/push-token); log so
            // the cleanup is traceable, nothing to disable.
            logger.info('push token row already removed; nothing to disable', {
              deviceId: ticket.deviceId,
              sk: pushTokenSk(ticket.deviceId),
            });
          }
        }
      } else {
        // Credential or rate errors are operational, not data: log them loudly
        // and still delete the ticket (the receipt has been consumed).
        logger.warn('expo push receipt error', {
          ticketId: ticket.ticketId,
          deviceId: ticket.deviceId,
          error: receipt.details?.error,
          message: receipt.message,
        });
      }
    }

    await deps.store.deletePushTicket(ticket.SK);
    result.deletedTickets += 1;
  }

  return result;
}

/**
 * Lambda entry point for the EventBridge Scheduler invocation. The scheduler
 * payload is ignored; the sweep is idempotent and self-contained.
 */
export async function receiptsHandler(): Promise<SweepResult> {
  const logger = createLogger({ base: { service: 'notifications', entry: 'receipts' } });
  const { getRuntimeDeps } = await import('./aws.js');
  const result = await sweepReceipts(await getRuntimeDeps(logger));
  logger.info('receipt sweep complete', { ...result });
  return result;
}

/** Back-compat alias: infra may wire either `handler` or `receiptsHandler`. */
export { receiptsHandler as handler };
