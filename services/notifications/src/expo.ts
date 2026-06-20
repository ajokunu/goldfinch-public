/**
 * Minimal Expo Push Service client over plain `fetch` (Node 20 global).
 *
 * The master plan picks the free Expo relay (https://exp.host/--/api/v2/push/...)
 * over direct APNs/FCM so each Lambda stays a simple outbound-HTTPS caller —
 * no .p8 signing, no FCM OAuth, no VPC. The expo-server-sdk dependency is
 * deliberately NOT used: at two-user scale we need exactly three behaviors
 * (token validation, 100-message chunking, receipt fetching) and implementing
 * them directly keeps the Lambda bundle tiny and the unit tests on mocked fetch.
 *
 * Authentication: an Expo access token with "Enhanced Security for Push
 * Notifications" enabled (stored in SSM SecureString /goldfinch/expo/access-token)
 * is sent as a Bearer token; without it anyone holding a captured
 * ExponentPushToken[...] could spam the relay.
 */

export const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

/** Expo accepts at most 100 messages per send request. */
export const PUSH_CHUNK_SIZE = 100;
/** Expo accepts at most 1000 receipt ids per getReceipts request. */
export const RECEIPT_CHUNK_SIZE = 1000;

/** Structural subset of the fetch API used here; injectable for unit tests. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface ExpoPushMessage {
  /** "ExponentPushToken[...]" */
  to: string;
  title?: string;
  body?: string;
  /** JSON payload delivered to the app. Keep it non-sensitive: the relay sees it. */
  data?: Record<string, unknown>;
  priority?: 'default' | 'normal' | 'high';
  /** Android notification channel ('sync' | 'budget'). */
  channelId?: string;
  sound?: 'default' | null;
  badge?: number;
  /** Seconds the message may be retained for delivery. */
  ttl?: number;
}

export interface ExpoErrorDetails {
  error?: string;
  expoPushToken?: string;
  [key: string]: unknown;
}

export type ExpoPushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: ExpoErrorDetails };

export type ExpoPushReceipt =
  | { status: 'ok' }
  | { status: 'error'; message: string; details?: ExpoErrorDetails };

/** Receipt error that means the token is dead and its row must be pruned. */
export const DEVICE_NOT_REGISTERED = 'DeviceNotRegistered';

export class ExpoPushError extends Error {
  readonly httpStatus?: number;

  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = 'ExpoPushError';
    this.httpStatus = httpStatus;
  }
}

// The Expo token format guard lives in @goldfinch/shared/push so the API write
// path and this fan-out cannot drift; re-exported here so send.ts/index.ts keep
// importing it from './expo.js'.
export { EXPO_PUSH_TOKEN_PATTERN, isExpoPushToken } from '@goldfinch/shared/push';

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export interface ExpoClientOptions {
  /**
   * Expo access token (enhanced push security), sent as a Bearer header.
   * OPTIONAL to support the P7-8 degraded mode: when the SSM parameter is
   * missing (push credentials not provisioned yet) the client still works
   * against Expo Go projects; relay rejections then surface as ticket errors,
   * which are logged -- never a crash.
   */
  accessToken?: string;
  /** Injectable for unit tests; defaults to the Node 20 global fetch. */
  fetchImpl?: FetchLike;
  sendUrl?: string;
  receiptsUrl?: string;
}

export interface ExpoClient {
  /**
   * Sends messages in chunks of 100 and returns one ticket per message, in the
   * same order as the input array (Expo guarantees per-request ordering and the
   * chunks are concatenated in order).
   */
  sendPushMessages(messages: readonly ExpoPushMessage[]): Promise<ExpoPushTicket[]>;
  /** Fetches receipts in chunks of 1000 ids; absent ids are not yet available. */
  getReceipts(ticketIds: readonly string[]): Promise<Record<string, ExpoPushReceipt>>;
}

interface ExpoApiErrorEntry {
  code?: string;
  message?: string;
}

async function postJson<T>(
  fetchImpl: FetchLike,
  url: string,
  accessToken: string | undefined,
  body: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (accessToken !== undefined && accessToken.length > 0) {
    headers.authorization = `Bearer ${accessToken}`;
  }
  const response = await fetchImpl(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new ExpoPushError(
      `Expo push API ${url} returned HTTP ${response.status}: ${text.slice(0, 500)}`,
      response.status,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExpoPushError(`Expo push API returned non-JSON body: ${text.slice(0, 200)}`);
  }

  const envelope = parsed as { data?: T; errors?: ExpoApiErrorEntry[] };
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
    const first = envelope.errors[0];
    throw new ExpoPushError(
      `Expo push API error: ${first?.code ?? 'UNKNOWN'} ${first?.message ?? ''}`.trim(),
    );
  }
  if (envelope.data === undefined) {
    throw new ExpoPushError('Expo push API response missing "data"');
  }
  return envelope.data;
}

export function createExpoClient(options: ExpoClientOptions): ExpoClient {
  const fetchImpl: FetchLike = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const sendUrl = options.sendUrl ?? EXPO_PUSH_SEND_URL;
  const receiptsUrl = options.receiptsUrl ?? EXPO_PUSH_RECEIPTS_URL;
  const { accessToken } = options;

  return {
    async sendPushMessages(messages) {
      const tickets: ExpoPushTicket[] = [];
      for (const part of chunk(messages, PUSH_CHUNK_SIZE)) {
        const data = await postJson<ExpoPushTicket[]>(fetchImpl, sendUrl, accessToken, part);
        if (!Array.isArray(data) || data.length !== part.length) {
          throw new ExpoPushError(
            `Expo returned ${Array.isArray(data) ? data.length : 'non-array'} tickets for ${part.length} messages`,
          );
        }
        tickets.push(...data);
      }
      return tickets;
    },

    async getReceipts(ticketIds) {
      const receipts: Record<string, ExpoPushReceipt> = {};
      for (const part of chunk(ticketIds, RECEIPT_CHUNK_SIZE)) {
        const data = await postJson<Record<string, ExpoPushReceipt>>(
          fetchImpl,
          receiptsUrl,
          accessToken,
          { ids: part },
        );
        Object.assign(receipts, data);
      }
      return receipts;
    },
  };
}
