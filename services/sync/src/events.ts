/**
 * SyncCompleted EventBridge emission (P7-8).
 *
 * After a run that fully persisted, the sync Lambda puts ONE event on the
 * configured bus:
 *
 *   source:      env EVENT_SOURCE (default: shared SYNC_EVENT_SOURCE,
 *                "goldfinch.sync")
 *   detail-type: shared SYNC_COMPLETED_DETAIL_TYPE ("SyncCompleted")
 *   detail:      { runId, status, accountsSynced, txnsUpserted, household }
 *
 * The infra rule routes it to the notifications Lambda (budget thresholds +
 * Expo push). Emission is FIRE-AND-FORGET BY CONTRACT: any failure — SDK
 * error, missing module, or a rejected entry in the PutEvents response — is
 * logged loudly via the shared logger and reported as `false`, but NEVER
 * fails the sync run (the bank data is already persisted; notifications are
 * best-effort).
 *
 * The injectable seam is a plain `PutEventsFn` rather than an SDK client so
 * tests never have to construct SDK command objects; the production
 * implementation (`sdkPutEvents`) lazily imports @aws-sdk/client-eventbridge
 * on first use, keeping the SDK out of every test path and out of cold-start
 * work for runs that fail before emission.
 */

import { SYNC_COMPLETED_DETAIL_TYPE } from '@goldfinch/shared/constants';
import type { Logger } from '@goldfinch/shared/logger';
import type { SyncCompletedEventDetail } from '@goldfinch/shared/types';

/**
 * The SyncCompleted `detail` payload this emitter produces. The wire contract
 * (what the notifications consumer may rely on) is the shared
 * SyncCompletedEventDetail; the counts are REQUIRED here so this producer can
 * never silently stop including the field that drives the sync push.
 */
export interface SyncCompletedDetail extends SyncCompletedEventDetail {
  accountsSynced: number;
  txnsUpserted: number;
}

/** One PutEvents request entry, pre-serialized. */
export interface SyncEventEntry {
  EventBusName: string;
  Source: string;
  DetailType: string;
  Detail: string;
}

/** Structural subset of the SDK's PutEventsCommandOutput. */
export interface PutEventsResultLike {
  FailedEntryCount?: number;
  Entries?: Array<{ EventId?: string; ErrorCode?: string; ErrorMessage?: string }>;
}

/** Injectable PutEvents seam; tests pass a capture/throwing fake. */
export type PutEventsFn = (entry: SyncEventEntry) => Promise<PutEventsResultLike>;

interface EventBridgeClientLike {
  send(command: unknown): Promise<PutEventsResultLike>;
}

// Module-scope client for warm reuse; created lazily on first real emission
// so tests (which always inject a PutEventsFn) never touch the SDK.
let defaultClient: EventBridgeClientLike | undefined;

/** Production PutEventsFn: lazy SDK import + cached client. */
export const sdkPutEvents: PutEventsFn = async (entry) => {
  const { EventBridgeClient, PutEventsCommand } = await import(
    '@aws-sdk/client-eventbridge'
  );
  defaultClient ??= new EventBridgeClient({}) as unknown as EventBridgeClientLike;
  return defaultClient.send(new PutEventsCommand({ Entries: [entry] }));
};

export interface EmitSyncCompletedOptions {
  busName: string;
  source: string;
  logger: Logger;
  /** Defaults to the real SDK implementation. */
  putEvents?: PutEventsFn;
}

/**
 * Emit the SyncCompleted event. Returns true when EventBridge accepted the
 * entry, false on ANY failure. Never throws — emission failure must never
 * fail the sync run — but every failure path logs at error level with full
 * context (P7-10: no silent fire-and-forget).
 */
export async function emitSyncCompleted(
  detail: SyncCompletedDetail,
  options: EmitSyncCompletedOptions,
): Promise<boolean> {
  const { busName, source, logger } = options;
  const putEvents = options.putEvents ?? sdkPutEvents;
  const entry: SyncEventEntry = {
    EventBusName: busName,
    Source: source,
    DetailType: SYNC_COMPLETED_DETAIL_TYPE,
    Detail: JSON.stringify(detail),
  };

  try {
    const result = await putEvents(entry);
    const failed = result.FailedEntryCount ?? 0;
    if (failed > 0) {
      const failure = result.Entries?.find((e) => e.ErrorCode !== undefined);
      logger.error('SyncCompleted event rejected by EventBridge', {
        busName,
        source,
        detailType: SYNC_COMPLETED_DETAIL_TYPE,
        failedEntryCount: failed,
        errorCode: failure?.ErrorCode,
        errorMessage: failure?.ErrorMessage,
        detail,
      });
      return false;
    }
    logger.info('SyncCompleted event emitted', {
      busName,
      source,
      detailType: SYNC_COMPLETED_DETAIL_TYPE,
      eventId: result.Entries?.[0]?.EventId,
    });
    return true;
  } catch (err) {
    // Loud but non-fatal by contract: the sync data is already persisted.
    logger.error('SyncCompleted event emission failed', {
      busName,
      source,
      detailType: SYNC_COMPLETED_DETAIL_TYPE,
      detail,
      error: err,
    });
    return false;
  }
}
