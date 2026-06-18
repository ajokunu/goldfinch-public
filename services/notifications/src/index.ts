/**
 * @goldfinch/notifications -- public surface.
 *
 * Lambda entry contract with infra (NotificationsStack):
 *   events Lambda  entry src/handler.ts  -- exports `handler` (also the default
 *                  export) consuming the EventBridge SyncCompleted event
 *                  (source SYNC_EVENT_SOURCE, detail-type
 *                  SYNC_COMPLETED_DETAIL_TYPE, detail { runId, status,
 *                  household, newTxnCount? }).
 *   sweep Lambda   entry src/receipts.ts -- exports `receiptsHandler` (with a
 *                  `handler` alias) for the EventBridge Scheduler receipt sweep.
 *   env vars       TABLE_NAME (required), GOLDFINCH_HOUSEHOLD (optional,
 *                  default HOUSEHOLD_ID), EXPO_ACCESS_TOKEN_PARAM (optional,
 *                  default /goldfinch/expo/access-token).
 *
 * Everything else is exported for the API part (shared PUSH_TOKEN re-exports)
 * and tests.
 */

export {
  NOTIF_KEY_PREFIX,
  assertIsoMonth,
  pushTicketSk,
  pushTokenSk,
  sentNotifPeriodPrefix,
  sentNotifSk,
  type PushTicketSk,
  type PushTokenSk,
  type SentNotifSk,
} from './keys.js';

export {
  type BudgetSpendEntry,
  type HandlerResult,
  type NotificationKind,
  type PushPlatform,
  type PushTicketItem,
  type PushTokenItem,
  type SentNotifItem,
  type SweepResult,
  type SyncCompletedDetail,
} from './types.js';

export {
  DEVICE_NOT_REGISTERED,
  EXPO_PUSH_RECEIPTS_URL,
  EXPO_PUSH_SEND_URL,
  ExpoPushError,
  PUSH_CHUNK_SIZE,
  RECEIPT_CHUNK_SIZE,
  chunk,
  createExpoClient,
  isExpoPushToken,
  type ExpoClient,
  type ExpoClientOptions,
  type ExpoPushMessage,
  type ExpoPushReceipt,
  type ExpoPushTicket,
  type FetchLike,
} from './expo.js';

export {
  PayloadHygieneError,
  assertPayloadHygiene,
  buildBudgetThresholdMessage,
  buildSyncCompleteMessage,
  type OutboundMessage,
} from './payload.js';

export {
  buildSentNotifItem,
  evaluateBudgetThresholds,
  sentNotifTtl,
  spendByCategory,
  type EvaluateBudgetThresholdsInput,
  type SpendTxnRow,
  type ThresholdCrossing,
} from './budget.js';

export {
  createDynamoStore,
  monthDateRange,
  type DocumentClientLike,
  type DynamoStoreOptions,
  type NotificationStore,
} from './store.js';

export {
  TICKET_TTL_SECONDS,
  sendNotifications,
  type KindedMessage,
  type SendDeps,
  type SendOutcome,
} from './send.js';

export {
  EventParseError,
  handler,
  parseSyncCompletedEvent,
  processSyncCompleted,
  resolveNotifPrefs,
  type HandlerDeps,
  type NotifPrefs,
} from './handler.js';

export { receiptsHandler, sweepReceipts, type SweepDeps } from './receipts.js';

export {
  ConfigError,
  EXPO_ACCESS_TOKEN_PARAM_NAME,
  getConfigFromEnv,
  type NotificationsConfig,
} from './config.js';

export { handler as default } from './handler.js';
