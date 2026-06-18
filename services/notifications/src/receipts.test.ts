/**
 * Receipt-sweep unit tests (P7-8). The sweep reads PUSHTICKET# rows, fetches
 * Expo receipts, DISABLES (never deletes) PUSHTOKEN# rows whose receipt says
 * DeviceNotRegistered, deletes resolved tickets, and leaves not-yet-available
 * receipts for the next sweep. Receipt errors are logged, never thrown
 * (degraded mode).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { userPk } from '@goldfinch/shared/keys';
import { HOUSEHOLD_ID, SCHEMA_VERSION } from '@goldfinch/shared/constants';
import { createLogger, type Logger } from '@goldfinch/shared/logger';
import type { ExpoClient, ExpoPushReceipt } from './expo.js';
import { pushTicketSk, pushTokenSk } from './keys.js';
import { sweepReceipts, type SweepDeps } from './receipts.js';
import { createMemoryStore, type MemoryStore } from './testing/memoryStore.js';
import type { PushTicketItem, PushTokenItem } from './types.js';

const PK = userPk(HOUSEHOLD_ID);

const silentLogger: Logger = createLogger({ sink: () => {} });

function capturingLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    logger: createLogger({ sink: (_level, line) => lines.push(line) }),
  };
}

function seedToken(store: MemoryStore, deviceId: string): void {
  const item: PushTokenItem = {
    PK,
    SK: pushTokenSk(deviceId),
    entityType: 'PUSH_TOKEN',
    schemaVersion: SCHEMA_VERSION,
    deviceId,
    expoPushToken: `ExponentPushToken[${deviceId}]`,
    platform: 'android',
    ownerSub: 'sub-test',
    createdAt: '2026-06-01T00:00:00.000Z',
  };
  store.tokens.set(item.SK, item);
}

function seedTicket(store: MemoryStore, ticketId: string, deviceId: string): PushTicketItem {
  const item: PushTicketItem = {
    PK,
    SK: pushTicketSk(1765290000000, ticketId),
    entityType: 'PUSH_TICKET',
    schemaVersion: SCHEMA_VERSION,
    ticketId,
    deviceId,
    token: `ExponentPushToken[${deviceId}]`,
    kind: 'sync',
    sentAt: '2026-06-09T08:00:00.000Z',
    ttl: 1765380000,
  };
  store.tickets.set(item.SK, item);
  return item;
}

function fakeExpo(receipts: Record<string, ExpoPushReceipt>): {
  client: ExpoClient;
  requestedIds: string[][];
} {
  const requestedIds: string[][] = [];
  return {
    requestedIds,
    client: {
      async sendPushMessages() {
        throw new Error('sendPushMessages must not be called by the sweep');
      },
      async getReceipts(ids) {
        requestedIds.push([...ids]);
        const out: Record<string, ExpoPushReceipt> = {};
        for (const id of ids) {
          const receipt = receipts[id];
          if (receipt !== undefined) out[id] = receipt;
        }
        return out;
      },
    },
  };
}

function deps(store: MemoryStore, expo: ExpoClient, logger: Logger = silentLogger): SweepDeps {
  return { store, expo, logger, now: () => new Date('2026-06-09T12:00:00.000Z') };
}

test('sweep with no outstanding tickets does not call Expo', async () => {
  const store = createMemoryStore();
  const expo = fakeExpo({});
  const result = await sweepReceipts(deps(store, expo.client));
  assert.deepEqual(result, { checked: 0, deletedTickets: 0, disabledTokens: [], pending: 0 });
  assert.equal(expo.requestedIds.length, 0);
});

test('ok receipts delete their ticket rows and leave tokens alone', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-1');
  const ticket = seedTicket(store, 't-ok', 'dev-1');
  const expo = fakeExpo({ 't-ok': { status: 'ok' } });

  const result = await sweepReceipts(deps(store, expo.client));

  assert.equal(result.checked, 1);
  assert.equal(result.deletedTickets, 1);
  assert.deepEqual(result.disabledTokens, []);
  assert.equal(store.tickets.has(ticket.SK), false);
  const token = store.tokens.get(pushTokenSk('dev-1'));
  assert.notEqual(token, undefined);
  assert.equal(token?.disabledAt, undefined);
  assert.deepEqual(expo.requestedIds, [['t-ok']]);
});

test('DeviceNotRegistered receipts disable the token (row kept) and consume the ticket', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-dead');
  seedToken(store, 'dev-live');
  seedTicket(store, 't-dead', 'dev-dead');
  seedTicket(store, 't-live', 'dev-live');
  const expo = fakeExpo({
    't-dead': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    't-live': { status: 'ok' },
  });

  const result = await sweepReceipts(deps(store, expo.client));

  assert.equal(result.deletedTickets, 2);
  assert.deepEqual(result.disabledTokens, ['dev-dead']);
  // The shared PUSH_TOKEN contract keeps the row and sets disabledAt.
  const dead = store.tokens.get(pushTokenSk('dev-dead'));
  assert.equal(dead?.disabledAt, '2026-06-09T12:00:00.000Z');
  const live = store.tokens.get(pushTokenSk('dev-live'));
  assert.equal(live?.disabledAt, undefined);
  assert.equal(store.tickets.size, 0);
});

test('missing receipts leave the ticket for the next sweep', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-1');
  const pendingTicket = seedTicket(store, 't-pending', 'dev-1');
  const expo = fakeExpo({});

  const result = await sweepReceipts(deps(store, expo.client));

  assert.equal(result.pending, 1);
  assert.equal(result.deletedTickets, 0);
  assert.equal(store.tickets.has(pendingTicket.SK), true);
});

test('non-DeviceNotRegistered receipt errors are logged, ticket consumed, token kept enabled', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-1');
  seedTicket(store, 't-err', 'dev-1');
  const { logger, lines } = capturingLogger();
  const expo = fakeExpo({
    't-err': {
      status: 'error',
      message: 'rate exceeded',
      details: { error: 'MessageRateExceeded' },
    },
  });

  const result = await sweepReceipts(deps(store, expo.client, logger));

  assert.equal(result.deletedTickets, 1);
  assert.deepEqual(result.disabledTokens, []);
  assert.equal(store.tokens.get(pushTokenSk('dev-1'))?.disabledAt, undefined);
  assert.equal(lines.some((line) => line.includes('expo push receipt error')), true);
  assert.equal(lines.some((line) => line.includes('MessageRateExceeded')), true);
});

test('two dead tickets for the same device disable the token only once', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-dead');
  seedTicket(store, 't-1', 'dev-dead');
  seedTicket(store, 't-2', 'dev-dead');
  const dead: ExpoPushReceipt = {
    status: 'error',
    message: 'gone',
    details: { error: 'DeviceNotRegistered' },
  };
  const expo = fakeExpo({ 't-1': dead, 't-2': dead });

  const result = await sweepReceipts(deps(store, expo.client));

  assert.deepEqual(result.disabledTokens, ['dev-dead']);
  assert.equal(
    store.calls.filter((c) => c === 'disablePushToken:dev-dead').length,
    1,
  );
  assert.equal(result.deletedTickets, 2);
});

test('DeviceNotRegistered receipt for an already-removed token row logs and still consumes the ticket', async () => {
  const store = createMemoryStore();
  // No token row: the user already called DELETE /devices/push-token.
  seedTicket(store, 't-gone', 'dev-gone');
  const { logger, lines } = capturingLogger();
  const expo = fakeExpo({
    't-gone': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
  });

  const result = await sweepReceipts(deps(store, expo.client, logger));

  assert.deepEqual(result.disabledTokens, []);
  assert.equal(result.deletedTickets, 1);
  assert.equal(store.tickets.size, 0);
  assert.equal(
    lines.some((line) => line.includes('push token row already removed')),
    true,
  );
});

test('more than 1000 tickets are fetched in receipt chunks', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-1');
  const receipts: Record<string, ExpoPushReceipt> = {};
  for (let i = 0; i < 1001; i += 1) {
    seedTicket(store, `t-${i}`, 'dev-1');
    receipts[`t-${i}`] = { status: 'ok' };
  }
  const expo = fakeExpo(receipts);

  const result = await sweepReceipts(deps(store, expo.client));

  assert.equal(result.checked, 1001);
  assert.equal(result.deletedTickets, 1001);
  assert.equal(expo.requestedIds.length, 2);
  assert.equal(expo.requestedIds[0]?.length, 1000);
  assert.equal(expo.requestedIds[1]?.length, 1);
});
