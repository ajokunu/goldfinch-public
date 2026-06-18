/**
 * Unit tests for the per-account cursor / window semantics (state.ts):
 * partial runs must not pin the window at full history forever, and one
 * chronically failing institution must not force full-window re-pulls for
 * the healthy accounts.
 */

import { syncStateSk, userPk } from '@goldfinch/shared/keys';
import { describe, expect, it } from 'vitest';

import { buildRunState, computeWindowStart, type RunOutcome } from '../src/state.js';
import type { SyncAccountState, SyncStateRecord } from '../src/types.js';
import { HOUSEHOLD } from './fixtures.js';

const DAY = 86_400;
const NOW_EPOCH = 1_780_000_000;
const NOW_ISO = '2026-06-09T13:00:00.000Z';
const OVERLAP = 7;
const MAX_HISTORY = 90;
const EARLIEST = NOW_EPOCH - MAX_HISTORY * DAY;

function account(partial: Partial<SyncAccountState>): SyncAccountState {
  return {
    lastSyncedAt: NOW_ISO,
    status: 'success',
    txnCount: 1,
    ...partial,
  };
}

function stateWith(
  perAccount: Record<string, SyncAccountState>,
  lastSuccessEpoch?: number,
): SyncStateRecord {
  const record: SyncStateRecord = {
    PK: userPk(HOUSEHOLD),
    SK: syncStateSk(),
    entityType: 'SYNC_STATE',
    schemaVersion: 1,
    lastRunAt: NOW_ISO,
    lastRunStatus: 'partial',
    perAccount,
  };
  if (lastSuccessEpoch !== undefined) {
    record.lastSuccessEpoch = lastSuccessEpoch;
  }
  return record;
}

function outcome(partial: Partial<RunOutcome>): RunOutcome {
  return {
    nowIso: NOW_ISO,
    nowEpoch: NOW_EPOCH,
    status: 'success',
    windowStartEpoch: EARLIEST,
    earliestEpoch: EARLIEST,
    perAccountTxnCounts: {},
    errlist: [],
    ...partial,
  };
}

describe('computeWindowStart', () => {
  it('pulls the full history window on the first run', () => {
    expect(computeWindowStart(null, NOW_EPOCH, OVERLAP, MAX_HISTORY)).toBe(EARLIEST);
  });

  it('falls back to the record-level cursor when no per-account cursors exist (legacy record)', () => {
    const previous = stateWith({}, NOW_EPOCH - 2 * DAY);
    expect(computeWindowStart(previous, NOW_EPOCH, OVERLAP, MAX_HISTORY)).toBe(
      NOW_EPOCH - 2 * DAY - OVERLAP * DAY,
    );
  });

  it('excludes errored accounts: one pinned institution does not force full-window re-pulls', () => {
    const previous = stateWith({
      healthy: account({ status: 'success', lastSuccessEpoch: NOW_EPOCH - 1 * DAY }),
      broken: account({
        status: 'error',
        lastSuccessEpoch: NOW_EPOCH - 60 * DAY,
        lastErrorAt: NOW_ISO,
        errorReason: 'con.auth: reconnect',
      }),
    });
    expect(computeWindowStart(previous, NOW_EPOCH, OVERLAP, MAX_HISTORY)).toBe(
      NOW_EPOCH - (1 + OVERLAP) * DAY,
    );
  });

  it('takes the min over successful accounts so a lagging healthy account widens the window', () => {
    const previous = stateWith({
      fresh: account({ lastSuccessEpoch: NOW_EPOCH - 1 * DAY }),
      lagging: account({ lastSuccessEpoch: NOW_EPOCH - 20 * DAY }),
    });
    expect(computeWindowStart(previous, NOW_EPOCH, OVERLAP, MAX_HISTORY)).toBe(
      NOW_EPOCH - (20 + OVERLAP) * DAY,
    );
  });

  it('clamps to the history cap', () => {
    const previous = stateWith({
      ancient: account({ lastSuccessEpoch: NOW_EPOCH - 200 * DAY }),
    });
    expect(computeWindowStart(previous, NOW_EPOCH, OVERLAP, MAX_HISTORY)).toBe(EARLIEST);
  });

  it('forces a full pull while a successful account has never had a covered window', () => {
    const previous = stateWith({
      fresh: account({ lastSuccessEpoch: NOW_EPOCH - 1 * DAY }),
      newcomer: account({}), // success, no cursor yet
    });
    expect(computeWindowStart(previous, NOW_EPOCH, OVERLAP, MAX_HISTORY)).toBe(EARLIEST);
  });

  it('falls back to the record-level cursor when every account is errored', () => {
    const previous = stateWith(
      { broken: account({ status: 'error', lastSuccessEpoch: NOW_EPOCH - 30 * DAY }) },
      NOW_EPOCH - 30 * DAY,
    );
    expect(computeWindowStart(previous, NOW_EPOCH, OVERLAP, MAX_HISTORY)).toBe(
      NOW_EPOCH - (30 + OVERLAP) * DAY,
    );
  });
});

describe('buildRunState', () => {
  it('partial run: present accounts succeed and advance; absent accounts are errored with a reason', () => {
    const previous = stateWith({
      'ACT-checking-1': account({ lastSuccessEpoch: NOW_EPOCH - 1 * DAY }),
      'ACT-credit-1': account({ lastSuccessEpoch: NOW_EPOCH - 1 * DAY, txnCount: 4 }),
    });

    const state = buildRunState(previous, HOUSEHOLD, outcome({
      status: 'partial',
      windowStartEpoch: NOW_EPOCH - 8 * DAY,
      perAccountTxnCounts: { 'ACT-checking-1': 2 },
      errlist: [{ code: 'con.auth', msg: 'Reconnect Example Card' }],
    }));

    const checking = state.perAccount['ACT-checking-1'];
    expect(checking?.status).toBe('success');
    expect(checking?.lastSuccessEpoch).toBe(NOW_EPOCH);
    expect(checking?.lastErrorAt).toBeUndefined();

    const credit = state.perAccount['ACT-credit-1'];
    expect(credit?.status).toBe('error');
    expect(credit?.lastErrorAt).toBe(NOW_ISO);
    expect(credit?.errorReason).toContain('Reconnect Example Card');
    // The errored account's cursor and counters are preserved, not wiped.
    expect(credit?.lastSuccessEpoch).toBe(NOW_EPOCH - 1 * DAY);
    expect(credit?.txnCount).toBe(4);

    // Record-level cursor stays the conservative min over accounts.
    expect(state.lastSuccessEpoch).toBe(NOW_EPOCH - 1 * DAY);
  });

  it('does not advance an account cursor when the window did not cover its gap (recovery heals next run)', () => {
    const staleCursor = NOW_EPOCH - 60 * DAY;
    const previous = stateWith({
      recovered: account({ status: 'error', lastSuccessEpoch: staleCursor }),
      healthy: account({ lastSuccessEpoch: NOW_EPOCH - 1 * DAY }),
    });

    // Window derived from the healthy account only: does not reach staleCursor.
    const windowStartEpoch = NOW_EPOCH - 8 * DAY;
    const state = buildRunState(previous, HOUSEHOLD, outcome({
      windowStartEpoch,
      perAccountTxnCounts: { recovered: 1, healthy: 2 },
    }));

    // The recovered account is healthy again but keeps its stale cursor, so
    // the NEXT window (min over success cursors) widens to cover its gap.
    expect(state.perAccount['recovered']?.status).toBe('success');
    expect(state.perAccount['recovered']?.lastSuccessEpoch).toBe(staleCursor);
    expect(state.perAccount['healthy']?.lastSuccessEpoch).toBe(NOW_EPOCH);
    expect(
      computeWindowStart(state, NOW_EPOCH, OVERLAP, MAX_HISTORY),
    ).toBe(staleCursor - OVERLAP * DAY);
  });

  it('advances an account cursor after a full-history window even without a prior cursor', () => {
    const state = buildRunState(null, HOUSEHOLD, outcome({
      windowStartEpoch: EARLIEST,
      perAccountTxnCounts: { fresh: 3 },
    }));
    expect(state.perAccount['fresh']?.lastSuccessEpoch).toBe(NOW_EPOCH);
    expect(state.lastSuccessEpoch).toBe(NOW_EPOCH);
  });

  it('a run that failed to fully persist marks every present account error and holds all cursors', () => {
    const previous = stateWith({
      a: account({ lastSuccessEpoch: NOW_EPOCH - 2 * DAY }),
    });
    const state = buildRunState(previous, HOUSEHOLD, outcome({
      status: 'error',
      windowStartEpoch: NOW_EPOCH - 9 * DAY,
      perAccountTxnCounts: { a: 5 },
    }));
    expect(state.perAccount['a']?.status).toBe('error');
    expect(state.perAccount['a']?.errorReason).toContain('did not fully persist');
    expect(state.perAccount['a']?.lastSuccessEpoch).toBe(NOW_EPOCH - 2 * DAY);
    expect(state.lastSuccessEpoch).toBe(NOW_EPOCH - 2 * DAY);
  });
});
