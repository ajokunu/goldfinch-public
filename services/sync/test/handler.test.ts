import {
  netWorthSk,
  syncRunningSk,
  syncStateSk,
  txnSk,
  userPk,
} from '@goldfinch/shared/keys';
import {
  SimpleFinAuthError,
  SimpleFinPaymentRequiredError,
  type FetchLike,
  type SimpleFinAccountSet,
} from '@goldfinch/shared/simplefin';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PutEventsFn, SyncEventEntry } from '../src/events.js';
import { createHandler } from '../src/handler.js';
import { clearAccessUrlCache, type SsmClientLike } from '../src/secrets.js';
import { FakeDdb } from './fake-ddb.js';
import {
  ACCESS_URL,
  HOUSEHOLD,
  NOW,
  PENDING_TXN,
  POSTED_TXN,
  TABLE_NAME,
  baseAccountSet,
  checkingAccount,
  postedAccountSet,
} from './fixtures.js';

const PK = userPk(HOUSEHOLD);
const NOW_EPOCH = Math.trunc(NOW.getTime() / 1000);

function fakeSsm(value: string = ACCESS_URL): SsmClientLike {
  return {
    send: async () => ({ Parameter: { Value: value } }),
  } as unknown as SsmClientLike;
}

function fakeFetchJson(payload: () => SimpleFinAccountSet): FetchLike {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => payload(),
    text: async () => '',
  })) as unknown as FetchLike;
}

function fakeFetchStatus(status: number): FetchLike {
  return (async () => ({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => '',
  })) as unknown as FetchLike;
}

interface Harness {
  ddb: FakeDdb;
  metricLines: string[];
  /** SyncCompleted entries accepted by the default putEvents fake. */
  events: SyncEventEntry[];
  run: (fetchImpl: FetchLike, putEvents?: PutEventsFn) => Promise<unknown>;
}

function harness(): Harness {
  const ddb = new FakeDdb();
  const metricLines: string[] = [];
  const events: SyncEventEntry[] = [];
  const acceptingPutEvents: PutEventsFn = async (entry) => {
    events.push(entry);
    return { FailedEntryCount: 0, Entries: [{ EventId: 'evt-test' }] };
  };
  return {
    ddb,
    metricLines,
    events,
    run: (fetchImpl: FetchLike, putEvents?: PutEventsFn) =>
      createHandler({
        ssmClient: fakeSsm(),
        docClient: ddb.asDocClient(),
        fetchImpl,
        now: () => NOW,
        metricsWrite: (line) => metricLines.push(line),
        sleep: async () => {},
        putEvents: putEvents ?? acceptingPutEvents,
      })(
        {},
        undefined,
      ),
  };
}

function lastMetrics(lines: string[]): Record<string, unknown> {
  const line = lines[lines.length - 1];
  expect(line).toBeDefined();
  return JSON.parse(line as string) as Record<string, unknown>;
}

describe('sync handler', () => {
  beforeEach(() => {
    clearAccessUrlCache();
    process.env.TABLE_NAME = TABLE_NAME;
    process.env.HOUSEHOLD_ID = HOUSEHOLD;
    process.env.METRICS_NAMESPACE = 'GoldFinch/Sync';
    process.env.ACCOUNT_TYPES_JSON = JSON.stringify({ 'ACT-credit-1': 'credit' });
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
    delete process.env.HOUSEHOLD_ID;
    delete process.env.METRICS_NAMESPACE;
    delete process.env.ACCOUNT_TYPES_JSON;
  });

  it('runs end to end: upserts items, writes SYNC#STATE, advances the cursor, emits EMF', async () => {
    const h = harness();
    const summary = (await h.run(fakeFetchJson(baseAccountSet))) as Record<string, unknown>;

    expect(summary.status).toBe('success');
    expect(summary.txnsUpserted).toBe(3);
    expect(summary.accountsSynced).toBe(2);

    expect(h.ddb.listSks(PK, 'TXN#')).toHaveLength(3);
    expect(h.ddb.listSks(PK, 'ACCT#')).toHaveLength(2);

    const state = h.ddb.getItem(PK, syncStateSk());
    expect(state).toBeDefined();
    expect(state?.lastRunStatus).toBe('success');
    expect(state?.lastSuccessEpoch).toBe(NOW_EPOCH);
    expect(state?.lastRunAt).toBe(NOW.toISOString());
    const perAccount = state?.perAccount as Record<string, { txnCount: number }>;
    expect(perAccount['ACT-checking-1']?.txnCount).toBe(2);
    expect(perAccount['ACT-credit-1']?.txnCount).toBe(1);

    const emf = lastMetrics(h.metricLines);
    expect(emf.TxnsUpserted).toBe(3);
    expect(emf.AccountsSynced).toBe(2);
    expect(emf.SyncErrors).toBe(0);
    expect(emf.TerminalErrors).toBe(0);
    const aws = emf._aws as { CloudWatchMetrics: Array<{ Namespace: string }> };
    expect(aws.CloudWatchMetrics[0]?.Namespace).toBe('GoldFinch/Sync');

    // P7-4: the daily net-worth snapshot landed for today's ET date.
    expect(summary.netWorthSnapshotDate).toBe('2026-06-09');
    const snapshot = h.ddb.getItem(PK, netWorthSk('2026-06-09'));
    expect(snapshot?.entityType).toBe('NETWORTH_SNAPSHOT');
    // checking 1234.56 asset; credit -432.10 liability folded as abs().
    expect(snapshot?.assetsMinor).toBe(123456);
    expect(snapshot?.liabilitiesMinor).toBe(43210);
    expect(snapshot?.netMinor).toBe(80246);

    // P7-8: exactly one SyncCompleted event with the contract detail.
    expect(summary.syncCompletedEventEmitted).toBe(true);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.Source).toBe('goldfinch.sync');
    expect(h.events[0]?.DetailType).toBe('SyncCompleted');
    expect(JSON.parse(h.events[0]?.Detail ?? '{}')).toEqual({
      runId: summary.runId,
      status: 'success',
      accountsSynced: 2,
      txnsUpserted: 3,
      household: HOUSEHOLD,
    });
  });

  it('detects recurring series from accrued table history during the post-upsert pass', async () => {
    const h = harness();
    // Accrued history from prior runs: a monthly subscription older than this
    // run's fetch window (the recurrence pass reads the TABLE, not the payload).
    for (const [i, date] of ['2026-03-01', '2026-04-01', '2026-05-01'].entries()) {
      h.ddb.putItem({
        PK,
        SK: txnSk(date, `TXN-sub-${i}`),
        entityType: 'TRANSACTION',
        schemaVersion: 1,
        amountMinor: -999,
        currency: 'USD',
        payee: 'StreamCo',
        categoryId: null,
        accountId: 'ACT-checking-1',
        pending: false,
        isTransfer: false,
        postedDate: date,
        simplefinTxnId: `TXN-sub-${i}`,
        categorizedBy: null,
        userCategorized: false,
        lastEditedBy: null,
        version: 1,
      });
    }

    const summary = (await h.run(fakeFetchJson(baseAccountSet))) as Record<string, unknown>;
    expect(summary.recurringSeriesUpserted).toBe(1);

    const recurringSks = h.ddb.listSks(PK, 'RECURRING#');
    expect(recurringSks).toHaveLength(1);
    const series = h.ddb.getItem(PK, recurringSks[0] as string);
    expect(series?.status).toBe('detected');
    expect(series?.payee).toBe('StreamCo');
    expect(series?.cadence).toBe('monthly');
    expect(series?.nextExpectedDate).toBe('2026-06-01');
  });

  it('ingests SimpleFIN holdings end-to-end and stamps holdingsSupported on the account', async () => {
    const h = harness();
    const withHoldings = (): SimpleFinAccountSet => {
      const set = baseAccountSet();
      set.accounts[0]!.holdings = [
        {
          id: 'HOL-vti',
          created: NOW.getTime() / 1000 - 3600,
          market_value: '6234.56',
          shares: '21.5',
          symbol: 'VTI',
        },
      ];
      return set;
    };

    const summary = (await h.run(fakeFetchJson(withHoldings))) as Record<string, unknown>;
    expect(summary.holdingsWritten).toBe(1);

    expect(h.ddb.listSks(PK, 'HOLDING#')).toEqual(['HOLDING#ACT-checking-1#HOL-vti']);
    expect(h.ddb.getItem(PK, 'ACCT#ACT-checking-1')?.holdingsSupported).toBe(true);
    expect(h.ddb.getItem(PK, 'ACCT#ACT-credit-1')?.holdingsSupported).toBe(false);

    // Sticky: the flag survives a later payload without a holdings array.
    await h.run(fakeFetchJson(baseAccountSet));
    expect(h.ddb.getItem(PK, 'ACCT#ACT-checking-1')?.holdingsSupported).toBe(true);
    expect(h.ddb.listSks(PK, 'HOLDING#')).toHaveLength(1); // absence != sold
  });

  it('never fails the run when SyncCompleted emission fails; the summary reports it', async () => {
    const h = harness();
    const summary = (await h.run(fakeFetchJson(baseAccountSet), async () => {
      throw new Error('eventbridge down');
    })) as Record<string, unknown>;

    expect(summary.status).toBe('success');
    expect(summary.syncCompletedEventEmitted).toBe(false);
    // The run still persisted everything and advanced state.
    expect(h.ddb.listSks(PK, 'TXN#')).toHaveLength(3);
    expect(h.ddb.getItem(PK, syncStateSk())?.lastRunStatus).toBe('success');
  });

  it('is idempotent across full handler runs (overlap window re-pull)', async () => {
    const h = harness();
    await h.run(fakeFetchJson(baseAccountSet));
    await h.run(fakeFetchJson(baseAccountSet));

    expect(h.ddb.listSks(PK, 'TXN#')).toHaveLength(3);
    expect(h.ddb.listSks(PK, 'TXNPTR#')).toHaveLength(3);
    expect(h.ddb.listSks(PK, 'ACCT#')).toHaveLength(2);
  });

  it('handles pending -> posted across runs: one row per id, stays in its purchase-date bucket', async () => {
    const h = harness();
    await h.run(fakeFetchJson(baseAccountSet));
    await h.run(fakeFetchJson(postedAccountSet));

    // transacted_at present -> clearing on 06-09 does NOT move the SK out of the
    // 06-07 purchase week; it's an in-place update, not a re-key.
    const txnSks = h.ddb.listSks(PK, 'TXN#').filter((sk) => sk.endsWith('#TXN-pending-1'));
    expect(txnSks).toEqual(['TXN#2026-06-07#TXN-pending-1']);
    const pointer = h.ddb.getItem(PK, 'TXNPTR#TXN-pending-1');
    expect(pointer?.currentSk).toBe('TXN#2026-06-07#TXN-pending-1');
  });

  it('classifies 403 as terminal: throws SimpleFinAuthError, records failure state, emits TerminalErrors', async () => {
    const h = harness();
    await expect(h.run(fakeFetchStatus(403))).rejects.toBeInstanceOf(SimpleFinAuthError);

    const state = h.ddb.getItem(PK, syncStateSk());
    expect(state?.lastRunStatus).toBe('error');
    expect(state?.lastSuccessEpoch).toBeUndefined();
    const errlist = state?.lastErrlist as Array<{ code: string }>;
    expect(errlist[0]?.code).toBe('simplefin.403');

    const emf = lastMetrics(h.metricLines);
    expect(emf.SyncErrors).toBe(1);
    expect(emf.TerminalErrors).toBe(1);
  });

  it('classifies 402 as terminal without retrying', async () => {
    const h = harness();
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return { ok: false, status: 402, json: async () => ({}), text: async () => '' };
    }) as unknown as FetchLike;

    await expect(h.run(counting)).rejects.toBeInstanceOf(SimpleFinPaymentRequiredError);
    expect(calls).toBe(1); // terminal: the in-Lambda retry layer must not retry

    const emf = lastMetrics(h.metricLines);
    expect(emf.TerminalErrors).toBe(1);
  });

  it('retries 5xx then succeeds', async () => {
    const h = harness();
    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 503, json: async () => ({}), text: async () => '' };
      }
      return {
        ok: true,
        status: 200,
        json: async () => baseAccountSet(),
        text: async () => '',
      };
    }) as unknown as FetchLike;

    const summary = (await h.run(flaky)) as Record<string, unknown>;
    expect(calls).toBe(2);
    expect(summary.status).toBe('success');
  });

  it('marks the run partial on a non-empty errlist; accounts present with data still advance', async () => {
    const h = harness();
    const withErrlist = (): SimpleFinAccountSet => ({
      ...baseAccountSet(),
      errlist: [{ code: 'con.auth', msg: 'Reconnect Example Bank: login expired' }],
    });

    const summary = (await h.run(fakeFetchJson(withErrlist))) as Record<string, unknown>;
    expect(summary.status).toBe('partial');

    const state = h.ddb.getItem(PK, syncStateSk());
    expect(state?.lastRunStatus).toBe('partial');
    // SimpleFIN errlist carries no account ids, so error attribution is by
    // absence; every account in this payload came back WITH data, so each
    // per-account cursor (and therefore the record-level min) advances even
    // though the run is partial.
    expect(state?.lastSuccessEpoch).toBe(NOW_EPOCH);
    const errlist = state?.lastErrlist as Array<{ code: string }>;
    expect(errlist[0]?.code).toBe('con.auth');

    const emf = lastMetrics(h.metricLines);
    expect(emf.SyncErrors).toBe(1);
    expect(emf.TerminalErrors).toBe(0);
  });

  it('marks accounts absent from an errored payload as error; healthy accounts keep advancing', async () => {
    const h = harness();
    await h.run(fakeFetchJson(baseAccountSet)); // both accounts success @ NOW

    // Example Card's connection breaks: its account disappears from the
    // payload and the errlist explains why.
    const broken = (): SimpleFinAccountSet => ({
      errors: [],
      errlist: [{ code: 'con.auth', msg: 'Reconnect Example Card: login expired' }],
      accounts: [checkingAccount([POSTED_TXN, PENDING_TXN])],
    });
    const summary = (await h.run(fakeFetchJson(broken))) as Record<string, unknown>;
    expect(summary.status).toBe('partial');

    const state = h.ddb.getItem(PK, syncStateSk());
    const perAccount = state?.perAccount as Record<string, Record<string, unknown>>;
    expect(perAccount['ACT-checking-1']?.status).toBe('success');
    expect(perAccount['ACT-checking-1']?.lastSuccessEpoch).toBe(NOW_EPOCH);
    expect(perAccount['ACT-credit-1']?.status).toBe('error');
    expect(perAccount['ACT-credit-1']?.lastErrorAt).toBe(NOW.toISOString());
    expect(perAccount['ACT-credit-1']?.errorReason).toContain('Reconnect Example Card');
    // The errored account's last good cursor is preserved, not wiped.
    expect(perAccount['ACT-credit-1']?.lastSuccessEpoch).toBe(NOW_EPOCH);
  });

  it('derives the window from healthy cursors only: a pinned account does not force full-history pulls, and heals on recovery', async () => {
    const h = harness();
    const staleCursor = NOW_EPOCH - 60 * 86_400;
    const freshCursor = NOW_EPOCH - 1 * 86_400;
    // Seed: checking healthy with a fresh cursor; credit chronically failing
    // with a 60-day-old cursor.
    h.ddb.putItem({
      PK,
      SK: syncStateSk(),
      entityType: 'SYNC_STATE',
      schemaVersion: 1,
      lastRunAt: NOW.toISOString(),
      lastRunStatus: 'partial',
      lastSuccessEpoch: staleCursor,
      perAccount: {
        'ACT-checking-1': {
          lastSyncedAt: NOW.toISOString(),
          status: 'success',
          txnCount: 2,
          lastSuccessEpoch: freshCursor,
        },
        'ACT-credit-1': {
          lastSyncedAt: NOW.toISOString(),
          status: 'error',
          txnCount: 1,
          lastSuccessEpoch: staleCursor,
          lastErrorAt: NOW.toISOString(),
          errorReason: 'con.auth: Reconnect Example Card',
        },
      },
    });

    // Run 1: window comes from the healthy cursor, NOT the stale errored one
    // (old behavior: global cursor pinned => daily 90-day re-pulls).
    const summary1 = (await h.run(fakeFetchJson(baseAccountSet))) as Record<string, unknown>;
    expect(summary1.windowStartEpoch).toBe(freshCursor - 7 * 86_400);

    // The credit account recovered (present with data) but this window did
    // not cover its 60-day gap: it turns success WITHOUT advancing its cursor.
    let state = h.ddb.getItem(PK, syncStateSk());
    let perAccount = state?.perAccount as Record<string, Record<string, unknown>>;
    expect(perAccount['ACT-credit-1']?.status).toBe('success');
    expect(perAccount['ACT-credit-1']?.lastSuccessEpoch).toBe(staleCursor);
    expect(perAccount['ACT-checking-1']?.lastSuccessEpoch).toBe(NOW_EPOCH);
    expect(state?.lastSuccessEpoch).toBe(staleCursor); // record-level = min over accounts

    // Run 2: the recovered account's stale cursor re-enters the min, widening
    // the window to cover its gap; only then does its cursor advance.
    const summary2 = (await h.run(fakeFetchJson(baseAccountSet))) as Record<string, unknown>;
    expect(summary2.windowStartEpoch).toBe(staleCursor - 7 * 86_400);
    state = h.ddb.getItem(PK, syncStateSk());
    perAccount = state?.perAccount as Record<string, Record<string, unknown>>;
    expect(perAccount['ACT-credit-1']?.lastSuccessEpoch).toBe(NOW_EPOCH);
    expect(state?.lastSuccessEpoch).toBe(NOW_EPOCH);
  });

  it('throws and keeps the cursor when batch writes never drain', async () => {
    const h = harness();
    h.ddb.failAllBatches = true;

    await expect(h.run(fakeFetchJson(baseAccountSet))).rejects.toThrowError(
      /unprocessed/,
    );

    const state = h.ddb.getItem(PK, syncStateSk());
    expect(state?.lastRunStatus).toBe('error');
    expect(state?.lastSuccessEpoch).toBeUndefined();
    // Post-upsert passes and the SyncCompleted event require a fully
    // persisted run: nothing here may fire.
    expect(h.events).toHaveLength(0);
    expect(h.ddb.listSks(PK, 'NETWORTH#')).toHaveLength(0);
  });

  // The API claims a SYNC#RUNNING marker before invoking (its tap-spam fan-out
  // guard); the sync handler clears it at the END of every run so the next
  // scheduled/manual run proceeds. A crashed run that never clears it self-
  // heals via the marker's soft TTL on the API side.
  describe('SYNC#RUNNING in-flight marker', () => {
    function seedMarker(h: Harness): void {
      h.ddb.putItem({
        PK,
        SK: syncRunningSk(),
        entityType: 'SYNC_RUNNING',
        schemaVersion: 1,
        runningSince: NOW.toISOString(),
      });
    }

    it('clears the marker after a successful run, so the next run proceeds', async () => {
      const h = harness();
      seedMarker(h);
      expect(h.ddb.getItem(PK, syncRunningSk())).toBeDefined();

      const summary = (await h.run(fakeFetchJson(baseAccountSet))) as Record<string, unknown>;
      expect(summary.status).toBe('success');
      // The marker is gone: a subsequent POST /sync/run is no longer refused.
      expect(h.ddb.getItem(PK, syncRunningSk())).toBeUndefined();
    });

    it('clears the marker even when the run fails terminally (finally path)', async () => {
      const h = harness();
      seedMarker(h);

      await expect(h.run(fakeFetchStatus(403))).rejects.toBeInstanceOf(SimpleFinAuthError);
      // A crashed/failed run must not wedge the button: the marker is cleared.
      expect(h.ddb.getItem(PK, syncRunningSk())).toBeUndefined();
    });

    it('is a harmless no-op when no marker exists (scheduled run path)', async () => {
      const h = harness();
      // No marker seeded — a cron-triggered run never claimed one.
      const summary = (await h.run(fakeFetchJson(baseAccountSet))) as Record<string, unknown>;
      expect(summary.status).toBe('success');
      expect(h.ddb.getItem(PK, syncRunningSk())).toBeUndefined();
    });
  });
});
