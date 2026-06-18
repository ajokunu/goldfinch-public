import assert from 'node:assert/strict';
import { test } from 'node:test';
import { userPk } from '@goldfinch/shared/keys';
import { HOUSEHOLD_ID, SCHEMA_VERSION } from '@goldfinch/shared/constants';
import { pushTicketSk, pushTokenSk, sentNotifSk } from './keys.js';
import { createDynamoStore, type DocumentClientLike } from './store.js';
import type { PushTokenItem, SentNotifItem } from './types.js';

/** Capturing fakes for the injected lib-dynamodb command constructors. */
class FakeQueryCommand {
  readonly kind = 'Query';
  constructor(readonly input: Record<string, unknown>) {}
}
class FakePutCommand {
  readonly kind = 'Put';
  constructor(readonly input: Record<string, unknown>) {}
}
class FakeDeleteCommand {
  readonly kind = 'Delete';
  constructor(readonly input: Record<string, unknown>) {}
}
type FakeCommand = FakeQueryCommand | FakePutCommand | FakeDeleteCommand;

function makeStore(respond: (command: FakeCommand) => unknown) {
  const sent: FakeCommand[] = [];
  const client: DocumentClientLike = {
    async send(command) {
      const cmd = command as FakeCommand;
      sent.push(cmd);
      return respond(cmd);
    },
  };
  const store = createDynamoStore({
    client,
    commands: {
      QueryCommand: FakeQueryCommand,
      PutCommand: FakePutCommand,
      DeleteCommand: FakeDeleteCommand,
    },
    tableName: 'goldfinch-table',
    household: HOUSEHOLD_ID,
  });
  return { store, sent };
}

test('loadPushTokens issues a begins_with(PUSHTOKEN#) query in the household partition and paginates', async () => {
  let page = 0;
  const { store, sent } = makeStore((command) => {
    assert.equal(command.kind, 'Query');
    page += 1;
    return page === 1
      ? { Items: [{ deviceId: 'dev-1' }], LastEvaluatedKey: { PK: 'x', SK: 'y' } }
      : { Items: [{ deviceId: 'dev-2' }] };
  });

  const tokens = await store.loadPushTokens();

  assert.equal(tokens.length, 2);
  assert.equal(sent.length, 2);
  const first = sent[0]!.input;
  assert.equal(first.TableName, 'goldfinch-table');
  assert.deepEqual(first.ExpressionAttributeValues, {
    ':pk': userPk(HOUSEHOLD_ID),
    ':prefix': 'PUSHTOKEN#',
  });
  assert.equal(first.ExclusiveStartKey, undefined);
  assert.deepEqual(sent[1]!.input.ExclusiveStartKey, { PK: 'x', SK: 'y' });
});

test('tryPutSentNotif uses attribute_not_exists(SK) and maps the conditional failure to false', async () => {
  const item: SentNotifItem = {
    PK: userPk(HOUSEHOLD_ID),
    SK: sentNotifSk('2026-06', 'dining', 80),
    entityType: 'SENT_NOTIF',
    schemaVersion: SCHEMA_VERSION,
    period: '2026-06',
    categoryId: 'dining',
    threshold: 80,
    sentAt: '2026-06-09T12:00:00Z',
    ttl: 1769904000,
  };

  const ok = makeStore(() => ({}));
  assert.equal(await ok.store.tryPutSentNotif(item), true);
  assert.equal(ok.sent[0]!.input.ConditionExpression, 'attribute_not_exists(SK)');

  const dup = makeStore(() => {
    const error = new Error('exists');
    error.name = 'ConditionalCheckFailedException';
    throw error;
  });
  assert.equal(await dup.store.tryPutSentNotif(item), false);

  const broken = makeStore(() => {
    const error = new Error('throttled');
    error.name = 'ProvisionedThroughputExceededException';
    throw error;
  });
  await assert.rejects(broken.store.tryPutSentNotif(item), /throttled/);
});

test('disablePushToken writes the full item back with disabledAt set (Put, not Update/Delete)', async () => {
  const { store, sent } = makeStore(() => ({}));
  const token: PushTokenItem = {
    PK: userPk(HOUSEHOLD_ID),
    SK: pushTokenSk('dev-9'),
    entityType: 'PUSH_TOKEN',
    schemaVersion: SCHEMA_VERSION,
    deviceId: 'dev-9',
    expoPushToken: 'ExponentPushToken[dev-9]',
    platform: 'ios',
    ownerSub: 'sub-test',
    createdAt: '2026-06-01T00:00:00.000Z',
  };

  await store.disablePushToken(token, '2026-06-09T12:00:00.000Z');

  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.kind, 'Put');
  assert.deepEqual(sent[0]!.input.Item, {
    ...token,
    disabledAt: '2026-06-09T12:00:00.000Z',
  });
});

test('deletePushTicket targets the exact composite key', async () => {
  const { store, sent } = makeStore(() => ({}));
  await store.deletePushTicket(pushTicketSk(1765290000000, 't-1'));

  assert.equal(sent[0]!.kind, 'Delete');
  assert.deepEqual(sent[0]!.input.Key, {
    PK: userPk(HOUSEHOLD_ID),
    SK: 'PUSHTICKET#1765290000000#t-1',
  });
});
