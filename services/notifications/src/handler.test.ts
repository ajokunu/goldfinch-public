import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  BudgetItem,
  CategoryItem,
  PushTokenItem,
  TransactionItem,
  UserProfileItem,
} from '@goldfinch/shared/types';
import {
  budgetSk,
  categorySk,
  gsi1Pk,
  gsi1Sk,
  gsi2Pk,
  gsi2Sk,
  profileSk,
  pushTokenSk,
  txnSk,
  userPk,
} from '@goldfinch/shared/keys';
import {
  HOUSEHOLD_ID,
  SCHEMA_VERSION,
  SYNC_COMPLETED_DETAIL_TYPE,
  SYNC_EVENT_SOURCE,
} from '@goldfinch/shared/constants';
import { createLogger } from '@goldfinch/shared/logger';
import type { ExpoClient, ExpoPushMessage, ExpoPushTicket } from './expo.js';
import {
  EventParseError,
  parseSyncCompletedEvent,
  processSyncCompleted,
  resolveNotifPrefs,
  type HandlerDeps,
} from './handler.js';
import { assertPayloadHygiene, PayloadHygieneError } from './payload.js';
import { TICKET_TTL_SECONDS } from './send.js';
import { createMemoryStore, type MemoryStore } from './testing/memoryStore.js';
import type { SyncCompletedDetail } from './types.js';

const PK = userPk(HOUSEHOLD_ID);
// 2026-06-09T12:00:00Z is 2026-06-09 in America/New_York -> period 2026-06.
const NOW = new Date('2026-06-09T12:00:00.000Z');
const PERIOD = '2026-06';
const silentLogger = createLogger({ sink: () => {} });

function seedToken(store: MemoryStore, deviceId: string, expoPushToken: string): void {
  const item: PushTokenItem = {
    PK,
    SK: pushTokenSk(deviceId),
    entityType: 'PUSH_TOKEN',
    schemaVersion: SCHEMA_VERSION,
    deviceId,
    expoPushToken,
    platform: 'ios',
    ownerSub: 'sub-aaron',
    createdAt: '2026-06-01T00:00:00Z',
  };
  store.tokens.set(item.SK, item);
}

function profile(sub: string, notifPrefs?: Record<string, unknown>): UserProfileItem {
  return {
    PK,
    SK: profileSk(sub),
    entityType: 'USER',
    schemaVersion: SCHEMA_VERSION,
    cognitoSub: sub,
    displayName: sub,
    baseCurrency: 'USD',
    householdId: HOUSEHOLD_ID,
    createdAt: '2026-01-01T00:00:00Z',
    ...(notifPrefs ? { settings: { notifPrefs } } : {}),
  };
}

function budget(categoryId: string, limitMinor: number): BudgetItem {
  return {
    PK,
    SK: budgetSk(categoryId),
    entityType: 'BUDGET',
    schemaVersion: SCHEMA_VERSION,
    categoryId,
    period: 'monthly',
    limitMinor,
    rollover: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function category(categoryId: string, name: string): CategoryItem {
  return {
    PK,
    SK: categorySk(categoryId),
    entityType: 'CATEGORY',
    schemaVersion: SCHEMA_VERSION,
    categoryId,
    name,
    type: 'EXPENSE',
    sortOrder: 1,
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

let txnCounter = 0;
function expenseTxn(categoryId: string, amountMinor: number): TransactionItem {
  txnCounter += 1;
  const txnId = `txn-${txnCounter}`;
  const date = '2026-06-05';
  return {
    PK,
    SK: txnSk(date, txnId),
    entityType: 'TRANSACTION',
    schemaVersion: SCHEMA_VERSION,
    amountMinor,
    currency: 'USD',
    payee: 'Test Payee',
    categoryId,
    accountId: 'acct-1',
    pending: false,
    isTransfer: false,
    postedDate: date,
    simplefinTxnId: txnId,
    categorizedBy: 'rule',
    userCategorized: false,
    lastEditedBy: null,
    version: 1,
    GSI1PK: gsi1Pk(HOUSEHOLD_ID, 'acct-1'),
    GSI1SK: gsi1Sk(date, txnId),
    // Spend-index keys present == "categorized non-transfer expense" predicate.
    ...(amountMinor < 0
      ? { GSI2PK: gsi2Pk(HOUSEHOLD_ID, categoryId), GSI2SK: gsi2Sk(date, txnId) }
      : {}),
  };
}

function seedSpend(store: MemoryStore, categoryId: string, spentMinor: number): void {
  const rows = store.transactionsByMonth.get(PERIOD) ?? [];
  rows.push(expenseTxn(categoryId, -spentMinor));
  store.transactionsByMonth.set(PERIOD, rows);
}

function fakeExpo(
  ticketFor: (message: ExpoPushMessage, index: number) => ExpoPushTicket = (_, i) => ({
    status: 'ok',
    id: `tk-${i}`,
  }),
): { client: ExpoClient; sends: ExpoPushMessage[][] } {
  const sends: ExpoPushMessage[][] = [];
  return {
    sends,
    client: {
      async sendPushMessages(messages) {
        sends.push([...messages]);
        return messages.map((m, i) => ticketFor(m, i));
      },
      async getReceipts() {
        throw new Error('getReceipts must not be called by the event handler');
      },
    },
  };
}

function deps(store: MemoryStore, expo: ExpoClient): HandlerDeps {
  return {
    store,
    expo,
    household: HOUSEHOLD_ID,
    now: () => NOW,
    logger: silentLogger,
  };
}

function detail(overrides: Partial<SyncCompletedDetail> = {}): SyncCompletedDetail {
  return {
    runId: 'run-1',
    status: 'success',
    household: HOUSEHOLD_ID,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

test('parseSyncCompletedEvent accepts a bare detail object', () => {
  const parsed = parseSyncCompletedEvent({
    runId: 'r-1',
    status: 'success',
    household: HOUSEHOLD_ID,
    newTxnCount: 12,
  });
  assert.deepEqual(parsed, {
    runId: 'r-1',
    status: 'success',
    household: HOUSEHOLD_ID,
    newTxnCount: 12,
  });
});

test('parseSyncCompletedEvent unwraps the EventBridge envelope by detail-type', () => {
  const parsed = parseSyncCompletedEvent({
    source: SYNC_EVENT_SOURCE,
    'detail-type': SYNC_COMPLETED_DETAIL_TYPE,
    detail: {
      runId: 'r-2',
      status: 'partial',
      household: HOUSEHOLD_ID,
      txnsUpserted: 4,
      syncedAt: '2026-06-09T12:00:00Z',
    },
  });
  assert.deepEqual(parsed, {
    runId: 'r-2',
    status: 'partial',
    household: HOUSEHOLD_ID,
    txnsUpserted: 4,
    syncedAt: '2026-06-09T12:00:00Z',
  });
});

test('parseSyncCompletedEvent rejects unknown detail-types and malformed details', () => {
  assert.throws(() => parseSyncCompletedEvent('not an object'), EventParseError);
  assert.throws(
    () =>
      parseSyncCompletedEvent({
        'detail-type': 'goldfinch.budget-threshold',
        detail: { runId: 'r', status: 'success', household: HOUSEHOLD_ID },
      }),
    EventParseError,
  );
  assert.throws(
    () => parseSyncCompletedEvent({ status: 'success', household: HOUSEHOLD_ID }),
    EventParseError,
  );
  assert.throws(
    () => parseSyncCompletedEvent({ runId: 'r', status: 'weird', household: HOUSEHOLD_ID }),
    EventParseError,
  );
  assert.throws(
    () => parseSyncCompletedEvent({ runId: 'r', status: 'success' }),
    EventParseError,
  );
  assert.throws(
    () =>
      parseSyncCompletedEvent({
        runId: 'r',
        status: 'success',
        household: HOUSEHOLD_ID,
        newTxnCount: 1.5,
      }),
    EventParseError,
  );
});

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

test('resolveNotifPrefs defaults on, disables a kind only when every profile opts out', () => {
  assert.deepEqual(resolveNotifPrefs([]), { sync: true, budget: true });
  assert.deepEqual(resolveNotifPrefs([profile('a'), profile('b')]), { sync: true, budget: true });
  assert.deepEqual(
    resolveNotifPrefs([profile('a', { sync: false }), profile('b')]),
    { sync: true, budget: true },
  );
  assert.deepEqual(
    resolveNotifPrefs([profile('a', { sync: false }), profile('b', { sync: false })]),
    { sync: false, budget: true },
  );
});

// ---------------------------------------------------------------------------
// Event-level guards
// ---------------------------------------------------------------------------

test('an event for a different household is ignored', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-1', 'ExponentPushToken[aaa]');
  const expo = fakeExpo();

  const result = await processSyncCompleted(
    detail({ household: 'someone-else', newTxnCount: 5 }),
    deps(store, expo.client),
  );

  assert.equal(result.skippedReason, 'household-mismatch');
  assert.equal(expo.sends.length, 0);
});

test('a failed sync run sends nothing (sync alarms own failures)', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-1', 'ExponentPushToken[aaa]');
  const expo = fakeExpo();

  const result = await processSyncCompleted(
    detail({ status: 'error', newTxnCount: 5 }),
    deps(store, expo.client),
  );

  assert.equal(result.skippedReason, 'sync-error');
  assert.equal(expo.sends.length, 0);
});

// ---------------------------------------------------------------------------
// sync-complete push
// ---------------------------------------------------------------------------

test('zero new transactions sends no sync push', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-1', 'ExponentPushToken[aaa]');
  const expo = fakeExpo();

  const result = await processSyncCompleted(
    detail({ newTxnCount: 0 }),
    deps(store, expo.client),
  );

  assert.equal(result.syncSkippedReason, 'no-new-transactions');
  assert.equal(expo.sends.length, 0);
});

test('a detail without any count skips the sync push but still evaluates budgets', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-1', 'ExponentPushToken[aaa]');
  store.budgets = [budget('dining', 10000)];
  store.categories = [category('dining', 'Dining')];
  seedSpend(store, 'dining', 8500);
  const expo = fakeExpo();

  const result = await processSyncCompleted(detail(), deps(store, expo.client));

  assert.equal(result.syncSkippedReason, 'unknown-count');
  assert.equal(expo.sends.length, 1);
  assert.equal(expo.sends[0]![0]!.title, 'Dining budget');
  assert.deepEqual(result.notifiedCategories, ['dining']);
});

test('sync push fans out one message per device, persists tickets with a 25h ttl', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-1', 'ExponentPushToken[aaa]');
  seedToken(store, 'dev-2', 'ExponentPushToken[bbb]');
  const expo = fakeExpo();

  const result = await processSyncCompleted(
    detail({ newTxnCount: 12 }),
    deps(store, expo.client),
  );

  assert.equal(result.attempted, 2);
  assert.equal(result.accepted, 1); // one message, accepted by at least one device
  assert.equal(expo.sends.length, 1);
  const sent = expo.sends[0]!;
  assert.deepEqual(
    sent.map((m) => m.to).sort(),
    ['ExponentPushToken[aaa]', 'ExponentPushToken[bbb]'],
  );
  assert.equal(sent[0]!.body, '12 new transactions');
  assert.equal(sent[0]!.channelId, 'sync');
  assert.deepEqual(sent[0]!.data, { kind: 'sync' });

  const tickets = [...store.tickets.values()];
  assert.equal(tickets.length, 2);
  const expectedTtl = Math.floor(NOW.getTime() / 1000) + TICKET_TTL_SECONDS;
  for (const ticket of tickets) {
    assert.equal(ticket.kind, 'sync');
    assert.equal(ticket.ttl, expectedTtl);
    assert.match(ticket.SK, /^PUSHTICKET#\d{13}#tk-\d+$/);
    assert.equal(ticket.sentAt, NOW.toISOString());
  }
});

test('txnsUpserted is the fallback count when newTxnCount is absent', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-1', 'ExponentPushToken[aaa]');
  const expo = fakeExpo();

  const result = await processSyncCompleted(
    detail({ txnsUpserted: 1 }),
    deps(store, expo.client),
  );

  assert.equal(result.syncSkippedReason, undefined);
  assert.equal(expo.sends[0]![0]!.body, '1 new transaction');
});

test('malformed tokens are DISABLED inline (kept with disabledAt), never sent', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-ok', 'ExponentPushToken[good]');
  seedToken(store, 'dev-bad', 'not-a-push-token');
  const expo = fakeExpo();

  const result = await processSyncCompleted(
    detail({ newTxnCount: 1 }),
    deps(store, expo.client),
  );

  assert.deepEqual(result.disabledTokens, ['dev-bad']);
  const disabled = store.tokens.get(pushTokenSk('dev-bad'));
  assert.notEqual(disabled, undefined);
  assert.equal(typeof disabled!.disabledAt, 'string');
  assert.equal(store.tokens.get(pushTokenSk('dev-ok'))!.disabledAt, undefined);
  assert.equal(expo.sends[0]!.length, 1);
});

test('already-disabled tokens are skipped entirely', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-live', 'ExponentPushToken[live]');
  seedToken(store, 'dev-off', 'ExponentPushToken[off]');
  const off = store.tokens.get(pushTokenSk('dev-off'))!;
  store.tokens.set(off.SK, { ...off, disabledAt: '2026-06-01T00:00:00Z' });
  const expo = fakeExpo();

  await processSyncCompleted(detail({ newTxnCount: 2 }), deps(store, expo.client));

  assert.equal(expo.sends[0]!.length, 1);
  assert.equal(expo.sends[0]![0]!.to, 'ExponentPushToken[live]');
});

test('a ticket that immediately reports DeviceNotRegistered disables that token', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-live', 'ExponentPushToken[live]');
  seedToken(store, 'dev-dead', 'ExponentPushToken[dead]');
  const expo = fakeExpo((message, i) =>
    message.to === 'ExponentPushToken[dead]'
      ? {
          status: 'error',
          message: 'device gone',
          details: { error: 'DeviceNotRegistered' },
        }
      : { status: 'ok', id: `tk-${i}` },
  );

  const result = await processSyncCompleted(
    detail({ newTxnCount: 5 }),
    deps(store, expo.client),
  );

  assert.deepEqual(result.disabledTokens, ['dev-dead']);
  assert.equal(typeof store.tokens.get(pushTokenSk('dev-dead'))!.disabledAt, 'string');
  assert.equal([...store.tickets.values()].length, 1);
  assert.equal([...store.tickets.values()][0]!.deviceId, 'dev-live');
});

test('sync prefs off skips the sync push when every profile opts out', async () => {
  const store = createMemoryStore();
  seedToken(store, 'dev-1', 'ExponentPushToken[aaa]');
  store.profiles = [profile('a', { sync: false }), profile('b', { sync: false })];
  const expo = fakeExpo();

  const result = await processSyncCompleted(
    detail({ newTxnCount: 9 }),
    deps(store, expo.client),
  );

  assert.equal(result.syncSkippedReason, 'prefs-disabled');
  assert.equal(expo.sends.length, 0);
});

// ---------------------------------------------------------------------------
// budget evaluation (spend computed from the table, shared percent math)
// ---------------------------------------------------------------------------

function budgetStore(): MemoryStore {
  const store = createMemoryStore();
  seedToken(store, 'dev-1', 'ExponentPushToken[aaa]');
  store.budgets = [budget('dining', 10000)];
  store.categories = [category('dining', 'Dining')];
  return store;
}

test('crossing 80% notifies exactly once per period (read-then-mark dedup)', async () => {
  const store = budgetStore();
  seedSpend(store, 'dining', 8500);
  const expo = fakeExpo();

  const first = await processSyncCompleted(detail(), deps(store, expo.client));
  assert.deepEqual(first.notifiedCategories, ['dining']);
  assert.equal(expo.sends[0]![0]!.title, 'Dining budget');
  assert.equal(expo.sends[0]![0]!.body, '85% of limit used');
  assert.equal(expo.sends[0]![0]!.channelId, 'budget');
  assert.deepEqual(expo.sends[0]![0]!.data, { kind: 'budget', categoryId: 'dining' });
  assert.equal(store.sentNotifs.has('SENTNOTIF#2026-06#dining#80'), true);

  // Second run at the same level: dedup marker exists, nothing is sent.
  const second = await processSyncCompleted(
    detail({ runId: 'run-2' }),
    deps(store, expo.client),
  );
  assert.equal(second.budgetSkippedReason, 'no-thresholds-crossed');
  assert.deepEqual(second.notifiedCategories, []);
  assert.equal(expo.sends.length, 1);
});

test('escalating from 80% to 100% later in the period notifies again, once', async () => {
  const store = budgetStore();
  seedSpend(store, 'dining', 8500);
  const expo = fakeExpo();

  await processSyncCompleted(detail(), deps(store, expo.client));
  seedSpend(store, 'dining', 2700); // total 11200
  const escalated = await processSyncCompleted(
    detail({ runId: 'run-2' }),
    deps(store, expo.client),
  );

  assert.deepEqual(escalated.notifiedCategories, ['dining']);
  assert.equal(expo.sends[1]![0]!.body, '112% of limit used');
  assert.equal(store.sentNotifs.has('SENTNOTIF#2026-06#dining#100'), true);
});

test('jumping straight past 100% sends one push and marks 80 and 100', async () => {
  const store = budgetStore();
  seedSpend(store, 'dining', 10500);
  const expo = fakeExpo();

  const result = await processSyncCompleted(detail(), deps(store, expo.client));

  assert.deepEqual(result.notifiedCategories, ['dining']);
  assert.equal(expo.sends.length, 1);
  assert.equal(expo.sends[0]![0]!.body, '105% of limit used');
  assert.equal(store.sentNotifs.has('SENTNOTIF#2026-06#dining#100'), true);
  assert.equal(store.sentNotifs.has('SENTNOTIF#2026-06#dining#80'), true);

  // A later run still over 100% must not produce a stale 80% notification.
  const later = await processSyncCompleted(
    detail({ runId: 'run-2' }),
    deps(store, expo.client),
  );
  assert.deepEqual(later.notifiedCategories, []);
  assert.equal(expo.sends.length, 1);
});

test('budget prefs off skips evaluation', async () => {
  const store = budgetStore();
  seedSpend(store, 'dining', 9999999);
  store.profiles = [profile('a', { budget: false }), profile('b', { budget: false })];
  const expo = fakeExpo();

  const result = await processSyncCompleted(detail(), deps(store, expo.client));

  assert.equal(result.budgetSkippedReason, 'prefs-disabled');
  assert.equal(store.sentNotifs.size, 0);
  assert.equal(expo.sends.length, 0);
});

// ---------------------------------------------------------------------------
// THE P7-8 BUG FIX: markers are written only after the relay accepts the send
// ---------------------------------------------------------------------------

test('a relay transport failure writes NO marker and the next run retries', async () => {
  const store = budgetStore();
  seedSpend(store, 'dining', 8500);
  const failing: ExpoClient = {
    async sendPushMessages() {
      throw new Error('exp.host is down');
    },
    async getReceipts() {
      throw new Error('unused');
    },
  };

  const first = await processSyncCompleted(detail(), deps(store, failing));
  assert.deepEqual(first.notifiedCategories, []);
  assert.deepEqual(first.retryCategories, ['dining']);
  assert.equal(store.sentNotifs.size, 0); // nothing marked before/after the failed send

  // The next SyncCompleted run re-evaluates the same crossing and succeeds.
  const expo = fakeExpo();
  const second = await processSyncCompleted(
    detail({ runId: 'run-2' }),
    deps(store, expo.client),
  );
  assert.deepEqual(second.notifiedCategories, ['dining']);
  assert.equal(store.sentNotifs.has('SENTNOTIF#2026-06#dining#80'), true);
});

test('a per-message relay rejection leaves that message unmarked for retry', async () => {
  const store = budgetStore();
  seedSpend(store, 'dining', 8500);
  // Every ticket errors (non-DeviceNotRegistered): message never accepted.
  const expo = fakeExpo(() => ({
    status: 'error',
    message: 'PUSH_TOO_MANY_EXPERIENCE_IDS',
    details: { error: 'PushTooManyExperienceIds' },
  }));

  const result = await processSyncCompleted(detail(), deps(store, expo.client));

  assert.deepEqual(result.notifiedCategories, []);
  assert.deepEqual(result.retryCategories, ['dining']);
  assert.equal(store.sentNotifs.size, 0);
  assert.equal(store.tickets.size, 0); // no ok ticket, nothing for the sweep
});

test('with no registered devices nothing is marked, so a future device gets the push', async () => {
  const store = createMemoryStore();
  store.budgets = [budget('dining', 10000)];
  store.categories = [category('dining', 'Dining')];
  seedSpend(store, 'dining', 9000);
  const expo = fakeExpo();

  const result = await processSyncCompleted(detail(), deps(store, expo.client));

  assert.equal(expo.sends.length, 0);
  assert.deepEqual(result.notifiedCategories, []);
  assert.equal(store.sentNotifs.size, 0);
});

test('sync and budget pushes ride the same send batch with per-kind tickets', async () => {
  const store = budgetStore();
  seedSpend(store, 'dining', 8500);
  const expo = fakeExpo();

  const result = await processSyncCompleted(
    detail({ newTxnCount: 3 }),
    deps(store, expo.client),
  );

  assert.equal(expo.sends.length, 1); // ONE batch to the relay
  assert.equal(expo.sends[0]!.length, 2); // 1 device x 2 notifications
  assert.equal(result.accepted, 2);
  const kinds = [...store.tickets.values()].map((t) => t.kind).sort();
  assert.deepEqual(kinds, ['budget', 'sync']);
});

// ---------------------------------------------------------------------------
// Payload hygiene
// ---------------------------------------------------------------------------

test('payload hygiene rejects amounts, currency symbols, and account detail', () => {
  assert.throws(
    () => assertPayloadHygiene({ title: 'Dining', body: 'You spent $45.99 today' }),
    PayloadHygieneError,
  );
  assert.throws(
    () => assertPayloadHygiene({ title: 'Checking', body: 'balance is low' }),
    PayloadHygieneError,
  );
  assert.throws(
    () => assertPayloadHygiene({ title: 'Card', body: 'account number 12345678' }),
    PayloadHygieneError,
  );
  assert.throws(
    () => assertPayloadHygiene({ title: 'Txn', body: 'payee STARBUCKS posted 1,234.56' }),
    PayloadHygieneError,
  );
  // The two real payload shapes pass.
  assert.doesNotThrow(() =>
    assertPayloadHygiene({ title: 'Sync complete', body: '12 new transactions' }),
  );
  assert.doesNotThrow(() =>
    assertPayloadHygiene({ title: 'Dining budget', body: '85% of limit used' }),
  );
});
