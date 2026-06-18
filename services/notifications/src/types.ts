/**
 * Item shapes and event contracts for the notifications service (P7-8).
 *
 * Items live in the same single table as everything else (PK = USER#<household>).
 * PUSH_TOKEN is the shared entity (written by the API's POST /devices/push-token
 * route, read here); PUSH_TICKET and SENT_NOTIF stay local because nobody else
 * reads them. Promote them into @goldfinch/shared/types if that changes.
 */

import type { UserPk } from '@goldfinch/shared/keys';
import type {
  EpochSeconds,
  IsoMonth,
  IsoTimestamp,
  MinorUnits,
  SyncRunStatus,
} from '@goldfinch/shared/types';
import type { PushTicketSk, SentNotifSk } from './keys.js';

// The device-token item is the SHARED contract now (P7-8): the API Lambda
// writes it, this service reads it and sets `disabledAt` on dead devices.
export type { PushPlatform, PushTokenItem } from '@goldfinch/shared/types';

/** The two notification classes GoldFinch sends. */
export type NotificationKind = 'sync' | 'budget';

/**
 * Expo push ticket persisted at send time so the receipt sweep can fetch the
 * real delivery outcome (~15 min later, receipts expire after 24h). TTL-expired
 * at sentAt + 25h so unswept rows never accumulate.
 */
export interface PushTicketItem {
  PK: UserPk;
  SK: PushTicketSk;
  entityType: 'PUSH_TICKET';
  schemaVersion: number;
  /** Expo ticket id returned by the push send endpoint. */
  ticketId: string;
  /** Device the message targeted, to disable its PUSHTOKEN# row on receipt error. */
  deviceId: string;
  /** The Expo push token the message was sent to. */
  token: string;
  kind: NotificationKind;
  sentAt: IsoTimestamp;
  /** DynamoDB TTL attribute, epoch seconds = sentAt + 25h. */
  ttl: EpochSeconds;
}

/**
 * Budget-threshold dedup marker. Its existence means "this category's
 * <threshold>% notification for <period> was ACCEPTED by the Expo relay";
 * it is written strictly AFTER a successful send (P7-8 marker-after-send),
 * so a failed send leaves no marker and the next SyncCompleted run retries.
 * TTL-expired shortly after the period ends.
 */
export interface SentNotifItem {
  PK: UserPk;
  SK: SentNotifSk;
  entityType: 'SENT_NOTIF';
  schemaVersion: number;
  period: IsoMonth;
  categoryId: string;
  /** Percent of limit, e.g. 80 or 100. */
  threshold: number;
  sentAt: IsoTimestamp;
  /** DynamoDB TTL attribute, epoch seconds (start of period + 2, i.e. after the period closes). */
  ttl: EpochSeconds;
}

// ---------------------------------------------------------------------------
// Inbound event (P7-8): one event class, SyncCompleted, emitted by the sync
// Lambda on the default EventBridge bus with source SYNC_EVENT_SOURCE and
// detail-type SYNC_COMPLETED_DETAIL_TYPE (both from @goldfinch/shared/constants
// so the emitter, the EventBridge rule, and this consumer cannot drift).
// ---------------------------------------------------------------------------

/**
 * Detail payload of the SyncCompleted event — the shared wire contract
 * (@goldfinch/shared/types SyncCompletedEventDetail), re-exported under the
 * local name this service has always used. Required fields (runId/status/
 * household) are the contract; the count fields are OPTIONAL extras the
 * emitter SHOULD include -- without one the sync-complete push is skipped
 * (budget evaluation still runs, because spend is read from the table).
 */
export type { SyncCompletedEventDetail as SyncCompletedDetail } from '@goldfinch/shared/types';

/** One category's period-to-date spend (positive minor units), computed here. */
export interface BudgetSpendEntry {
  categoryId: string;
  spentMinor: MinorUnits;
}

/** Result returned by the event handler (logs + integration tests). */
export interface HandlerResult {
  runId: string;
  status: SyncRunStatus;
  /** Push messages handed to the Expo relay (devices x notifications). */
  attempted: number;
  /** Push messages with at least one relay-accepted ticket. */
  accepted: number;
  /** deviceIds whose PUSHTOKEN# rows were disabled during this invocation. */
  disabledTokens: string[];
  /** categoryIds notified AND marked (send accepted) this run. */
  notifiedCategories: string[];
  /** categoryIds whose send failed; left UNMARKED so the next run retries. */
  retryCategories: string[];
  /** Present when the whole event was intentionally ignored. */
  skippedReason?: 'household-mismatch' | 'sync-error';
  /** Present when the sync-complete push was intentionally not sent. */
  syncSkippedReason?: 'no-new-transactions' | 'unknown-count' | 'prefs-disabled';
  /** Present when no budget push was sent. */
  budgetSkippedReason?: 'prefs-disabled' | 'no-budgets' | 'no-thresholds-crossed';
  /** True when the run proceeded without an Expo access token (P7-8 degraded mode). */
  degraded: boolean;
}

/** Result returned by the receipt sweep (logs + integration tests). */
export interface SweepResult {
  /** Tickets present in the table when the sweep started. */
  checked: number;
  /** Tickets resolved (receipt seen) and deleted. */
  deletedTickets: number;
  /** deviceIds disabled because their receipt said DeviceNotRegistered. */
  disabledTokens: string[];
  /** Tickets whose receipt was not available yet (left for the next sweep / TTL). */
  pending: number;
}
