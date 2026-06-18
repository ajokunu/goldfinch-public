import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXPO_PUSH_RECEIPTS_URL,
  EXPO_PUSH_SEND_URL,
  ExpoPushError,
  chunk,
  createExpoClient,
  isExpoPushToken,
  type ExpoPushMessage,
  type ExpoPushTicket,
  type FetchLike,
} from './expo.js';

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(
  respond: (call: RecordedCall, index: number) => { status?: number; body: unknown },
): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: RecordedCall = { url, headers: init.headers, body: JSON.parse(init.body) };
    calls.push(call);
    const { status = 200, body } = respond(call, calls.length - 1);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  return { fetchImpl, calls };
}

function message(n: number): ExpoPushMessage {
  return { to: `ExponentPushToken[tok-${n}]`, title: 'Sync complete', body: `${n} new transactions` };
}

test('isExpoPushToken accepts Expo formats and rejects everything else', () => {
  assert.equal(isExpoPushToken('ExponentPushToken[abc123XYZ]'), true);
  assert.equal(isExpoPushToken('ExpoPushToken[abc123XYZ]'), true);
  assert.equal(isExpoPushToken('ExponentPushToken[]'), false);
  assert.equal(isExpoPushToken('apns-raw-token-deadbeef'), false);
  assert.equal(isExpoPushToken('ExponentPushToken[abc'), false);
  assert.equal(isExpoPushToken(42), false);
  assert.equal(isExpoPushToken(undefined), false);
});

test('chunk splits into fixed-size groups and rejects bad sizes', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 100), []);
  assert.throws(() => chunk([1], 0), RangeError);
});

test('sendPushMessages sends one authorized POST per 100-message chunk and concatenates tickets in order', async () => {
  const { fetchImpl, calls } = mockFetch((call) => {
    const sent = call.body as ExpoPushMessage[];
    const tickets: ExpoPushTicket[] = sent.map((m) => ({
      status: 'ok',
      id: `ticket-for-${m.to}`,
    }));
    return { body: { data: tickets } };
  });
  const client = createExpoClient({ accessToken: 'expo-secret', fetchImpl });

  const messages = Array.from({ length: 230 }, (_, i) => message(i));
  const tickets = await client.sendPushMessages(messages);

  assert.equal(calls.length, 3);
  assert.equal((calls[0]!.body as unknown[]).length, 100);
  assert.equal((calls[1]!.body as unknown[]).length, 100);
  assert.equal((calls[2]!.body as unknown[]).length, 30);
  for (const call of calls) {
    assert.equal(call.url, EXPO_PUSH_SEND_URL);
    assert.equal(call.headers.authorization, 'Bearer expo-secret');
    assert.equal(call.headers['content-type'], 'application/json');
  }
  assert.equal(tickets.length, 230);
  assert.deepEqual(tickets[0], { status: 'ok', id: 'ticket-for-ExponentPushToken[tok-0]' });
  assert.deepEqual(tickets[229], { status: 'ok', id: 'ticket-for-ExponentPushToken[tok-229]' });
});

test('sendPushMessages throws ExpoPushError on HTTP failure with the status attached', async () => {
  const { fetchImpl } = mockFetch(() => ({ status: 500, body: 'relay exploded' }));
  const client = createExpoClient({ accessToken: 't', fetchImpl });
  await assert.rejects(client.sendPushMessages([message(1)]), (error: unknown) => {
    assert.ok(error instanceof ExpoPushError);
    assert.equal(error.httpStatus, 500);
    return true;
  });
});

test('sendPushMessages throws on a top-level errors envelope', async () => {
  const { fetchImpl } = mockFetch(() => ({
    body: { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'mixed projects' }] },
  }));
  const client = createExpoClient({ accessToken: 't', fetchImpl });
  await assert.rejects(client.sendPushMessages([message(1)]), /PUSH_TOO_MANY_EXPERIENCE_IDS/);
});

test('sendPushMessages throws when the ticket count does not match the chunk', async () => {
  const { fetchImpl } = mockFetch(() => ({ body: { data: [] } }));
  const client = createExpoClient({ accessToken: 't', fetchImpl });
  await assert.rejects(client.sendPushMessages([message(1)]), /0 tickets for 1 messages/);
});

test('getReceipts posts ids to the receipts endpoint and returns the receipt map', async () => {
  const { fetchImpl, calls } = mockFetch(() => ({
    body: {
      data: {
        'id-1': { status: 'ok' },
        'id-2': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
      },
    },
  }));
  const client = createExpoClient({ accessToken: 'expo-secret', fetchImpl });

  const receipts = await client.getReceipts(['id-1', 'id-2']);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, EXPO_PUSH_RECEIPTS_URL);
  assert.deepEqual(calls[0]!.body, { ids: ['id-1', 'id-2'] });
  assert.equal(receipts['id-1']!.status, 'ok');
  const failed = receipts['id-2']!;
  assert.equal(failed.status, 'error');
  assert.equal(failed.status === 'error' ? failed.details?.error : undefined, 'DeviceNotRegistered');
});

test('getReceipts returns an empty map without calling fetch for zero ids', async () => {
  const { fetchImpl, calls } = mockFetch(() => ({ body: { data: {} } }));
  const client = createExpoClient({ accessToken: 't', fetchImpl });
  assert.deepEqual(await client.getReceipts([]), {});
  assert.equal(calls.length, 0);
});
