/**
 * SyncCompleted EventBridge emission (P7-8): bus/source/detail-type wiring,
 * the detail contract, and the fire-and-forget guarantee — every failure path
 * returns false AND logs at error level; emitSyncCompleted never throws.
 */

import { SYNC_COMPLETED_DETAIL_TYPE, SYNC_EVENT_SOURCE } from '@goldfinch/shared/constants';
import { describe, expect, it } from 'vitest';

import {
  emitSyncCompleted,
  type PutEventsResultLike,
  type SyncCompletedDetail,
  type SyncEventEntry,
} from '../src/events.js';
import { captureLogger } from './capture-logger.js';

const DETAIL: SyncCompletedDetail = {
  runId: 'run-123',
  status: 'success',
  accountsSynced: 2,
  txnsUpserted: 3,
  household: 'goldfinch-home',
};

function acceptingPutEvents(captured: SyncEventEntry[]) {
  return async (entry: SyncEventEntry): Promise<PutEventsResultLike> => {
    captured.push(entry);
    return { FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] };
  };
}

describe('emitSyncCompleted', () => {
  it('puts one entry with the configured bus, source, shared detail-type, and the full detail payload', async () => {
    const { logger, atLevel } = captureLogger();
    const captured: SyncEventEntry[] = [];

    const emitted = await emitSyncCompleted(DETAIL, {
      busName: 'goldfinch-bus',
      source: SYNC_EVENT_SOURCE,
      logger,
      putEvents: acceptingPutEvents(captured),
    });

    expect(emitted).toBe(true);
    expect(captured).toHaveLength(1);
    const entry = captured[0]!;
    expect(entry.EventBusName).toBe('goldfinch-bus');
    expect(entry.Source).toBe('goldfinch.sync');
    expect(entry.DetailType).toBe(SYNC_COMPLETED_DETAIL_TYPE);
    expect(JSON.parse(entry.Detail)).toEqual({
      runId: 'run-123',
      status: 'success',
      accountsSynced: 2,
      txnsUpserted: 3,
      household: 'goldfinch-home',
    });
    expect(atLevel('error')).toHaveLength(0);
    expect(atLevel('info')[0]?.msg).toBe('SyncCompleted event emitted');
  });

  it('honors an env-overridden source verbatim', async () => {
    const { logger } = captureLogger();
    const captured: SyncEventEntry[] = [];

    await emitSyncCompleted(DETAIL, {
      busName: 'default',
      source: 'custom.source',
      logger,
      putEvents: acceptingPutEvents(captured),
    });

    expect(captured[0]?.Source).toBe('custom.source');
  });

  it('returns false and logs loudly when EventBridge rejects the entry (FailedEntryCount > 0)', async () => {
    const { logger, atLevel } = captureLogger();

    const emitted = await emitSyncCompleted(DETAIL, {
      busName: 'goldfinch-bus',
      source: SYNC_EVENT_SOURCE,
      logger,
      putEvents: async () => ({
        FailedEntryCount: 1,
        Entries: [{ ErrorCode: 'ThrottlingException', ErrorMessage: 'slow down' }],
      }),
    });

    expect(emitted).toBe(false);
    const errors = atLevel('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.msg).toBe('SyncCompleted event rejected by EventBridge');
    expect(errors[0]?.errorCode).toBe('ThrottlingException');
    expect(errors[0]?.errorMessage).toBe('slow down');
    expect(errors[0]?.busName).toBe('goldfinch-bus');
    expect(errors[0]?.detail).toEqual(DETAIL);
  });

  it('returns false (never throws) and logs the error with full context when PutEvents throws', async () => {
    const { logger, atLevel } = captureLogger();

    const emitted = await emitSyncCompleted(DETAIL, {
      busName: 'goldfinch-bus',
      source: SYNC_EVENT_SOURCE,
      logger,
      putEvents: async () => {
        throw new Error('socket hang up');
      },
    });

    expect(emitted).toBe(false);
    const errors = atLevel('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.msg).toBe('SyncCompleted event emission failed');
    expect(errors[0]?.detail).toEqual(DETAIL);
    expect((errors[0]?.error as { message?: string }).message).toBe('socket hang up');
  });
});
