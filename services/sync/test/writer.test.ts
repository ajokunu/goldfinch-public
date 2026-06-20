import { gsi2Pk, gsi2Sk, txnPointerSk, txnSk, userPk } from '@goldfinch/shared/keys';
import { describe, expect, it } from 'vitest';

import { normalizeForSync } from '../src/normalize.js';
import {
  ACCOUNT_USER_OWNED_FIELDS,
  buildAccountFieldUpdate,
  buildBankFieldUpdate,
  upsertSyncItems,
  type UpsertOptions,
} from '../src/writer.js';
import { FakeDdb } from './fake-ddb.js';
import {
  HOUSEHOLD,
  NOW,
  TABLE_NAME,
  baseAccountSet,
  noTxPendingAccountSet,
  noTxPostedAccountSet,
  postedAccountSet,
} from './fixtures.js';

const PK = userPk(HOUSEHOLD);

const CTX = {
  household: HOUSEHOLD,
  now: NOW,
  accountTypes: { 'ACT-credit-1': 'credit' as const },
};

const USER_OWNED_FIELDS = [
  'categoryId',
  'note',
  'noteLower',
  'isTransfer',
  'userCategorized',
  'categorizedBy',
  'lastEditedBy',
  'createdAt',
  'GSI2PK',
  'GSI2SK',
];

function options(ddb: FakeDdb): UpsertOptions {
  return {
    docClient: ddb.asDocClient(),
    tableName: TABLE_NAME,
    household: HOUSEHOLD,
    baseDelayMs: 0,
    sleep: async () => {},
  };
}

describe('buildBankFieldUpdate', () => {
  it('never references user-owned attributes or an absolute version', () => {
    const normalized = normalizeForSync(baseAccountSet(), CTX);
    for (const txn of normalized.transactions) {
      const { updateExpression, names, values } = buildBankFieldUpdate(txn);
      for (const field of USER_OWNED_FIELDS) {
        expect(Object.values(names)).not.toContain(field);
        expect(updateExpression).not.toContain(field);
      }
      // version is bumped atomically, never SET to a literal value.
      expect(updateExpression).toContain('#version = if_not_exists(#version, :zero) + :one');
      expect(Object.keys(values)).not.toContain(':version');
    }
  });

  it('REMOVEs optional bank fields that SimpleFIN stopped sending', () => {
    const normalized = normalizeForSync(baseAccountSet(), CTX);
    // TXN-credit-1 has no memo / transacted_at in the fixture.
    const credit = normalized.transactions.find((t) => t.simplefinTxnId === 'TXN-credit-1');
    expect(credit).toBeDefined();
    const { updateExpression } = buildBankFieldUpdate(credit!);
    expect(updateExpression).toMatch(/REMOVE .*#memo/);
    expect(updateExpression).toMatch(/REMOVE .*#transactedAt/);
  });
});

describe('buildAccountFieldUpdate (P8-4)', () => {
  it('never references the user-owned overrides or the creation-owned source flag', () => {
    const normalized = normalizeForSync(baseAccountSet(), CTX);
    expect(normalized.accounts.length).toBeGreaterThan(0);
    for (const account of normalized.accounts) {
      const { updateExpression, names } = buildAccountFieldUpdate(account);
      for (const field of [...ACCOUNT_USER_OWNED_FIELDS, 'source']) {
        expect(Object.values(names)).not.toContain(field);
        expect(updateExpression).not.toContain(field);
      }
    }
  });

  it('locks the user-owned account field list to the P8-4 contract', () => {
    expect([...ACCOUNT_USER_OWNED_FIELDS]).toEqual(['typeOverride', 'isLiabilityOverride']);
  });

  it('REMOVEs removable optional fields the institution stopped sending, never holdingsSupported', () => {
    const normalized = normalizeForSync(baseAccountSet(), CTX);
    // ACT-credit-1 has no available-balance in the fixture; no item carries
    // holdingsSupported until applyHoldingsSupported runs.
    const credit = normalized.accounts.find((a) => a.simplefinAccountId === 'ACT-credit-1');
    expect(credit).toBeDefined();
    const { updateExpression } = buildAccountFieldUpdate(credit!);
    expect(updateExpression).toMatch(/REMOVE .*#availableBalanceMinor/);
    expect(updateExpression).toMatch(/REMOVE .*#availableBalanceRaw/);
    expect(updateExpression).not.toContain('holdingsSupported');
  });
});

describe('upsertSyncItems', () => {
  it('is idempotent: the same payload twice produces no duplicates', async () => {
    const ddb = new FakeDdb();
    const normalized = normalizeForSync(baseAccountSet(), CTX);

    const first = await upsertSyncItems(normalized, options(ddb));
    const second = await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));

    expect(first.unprocessedCount).toBe(0);
    expect(second.unprocessedCount).toBe(0);
    expect(first.txnsUpserted).toBe(3);
    expect(second.txnsUpserted).toBe(3);

    // Exactly one TXN# row per SimpleFIN txn id, one pointer each, two accounts.
    expect(ddb.listSks(PK, 'TXN#')).toHaveLength(3);
    expect(ddb.listSks(PK, 'TXNPTR#')).toHaveLength(3);
    expect(ddb.listSks(PK, 'ACCT#')).toHaveLength(2);

    // Second pass updated the existing rows in place: version bumped, not duplicated.
    const sk = txnSk('2026-06-04', 'TXN-posted-1');
    const row = ddb.getItem(PK, sk);
    expect(row).toBeDefined();
    expect(row?.version).toBe(2);
    expect(row?.amountRaw).toBe('-33.27');
    expect(row?.amountMinor).toBe(-3327);
    expect(row?.payeeLower).toBe('whole foods');
  });

  it('persists sync enrichment: institution, account type, isLiability, raw balances', async () => {
    const ddb = new FakeDdb();
    await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));

    const checking = ddb.getItem(PK, 'ACCT#ACT-checking-1');
    expect(checking?.institution).toBe('Example Bank');
    expect(checking?.accountType).toBe('other'); // unmapped -> other
    expect(checking?.isLiability).toBe(false);
    expect(checking?.balanceRaw).toBe('1234.56');
    expect(checking?.balanceMinor).toBe(123456);
    expect(checking?.availableBalanceRaw).toBe('1200.00');

    const credit = ddb.getItem(PK, 'ACCT#ACT-credit-1');
    expect(credit?.accountType).toBe('credit');
    expect(credit?.isLiability).toBe(true);
    expect(credit?.balanceMinor).toBe(-43210);
  });

  it('preserves P8-4 account overrides through a sync refresh (overrides are user-owned)', async () => {
    const ddb = new FakeDdb();
    await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));

    // Simulate PATCH /accounts/{accountId}: the user reclassifies checking.
    ddb.putItem({
      ...ddb.getItem(PK, 'ACCT#ACT-checking-1'),
      typeOverride: 'business',
      isLiabilityOverride: true,
    });

    // Next sync run arrives with a moved balance.
    const refreshed = baseAccountSet();
    refreshed.accounts[0]!.balance = '1500.00';
    await upsertSyncItems(normalizeForSync(refreshed, CTX), options(ddb));

    const row = ddb.getItem(PK, 'ACCT#ACT-checking-1');
    // User-owned overrides survive untouched...
    expect(row?.typeOverride).toBe('business');
    expect(row?.isLiabilityOverride).toBe(true);
    // ...while sync-owned fields refresh.
    expect(row?.balanceMinor).toBe(150000);
    expect(row?.balanceRaw).toBe('1500.00');
    expect(row?.accountType).toBe('other'); // synced type still sync-owned
  });

  it('preserves account overrides even when the PATCH lands mid-run', async () => {
    const ddb = new FakeDdb();
    await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));

    // The PATCH lands after the writer planned its writes but before any is
    // applied — the blind-overwrite shape that loses user data.
    let patched = false;
    ddb.beforeWrite = () => {
      if (patched) return;
      patched = true;
      ddb.putItem({
        ...ddb.getItem(PK, 'ACCT#ACT-credit-1'),
        isLiabilityOverride: false,
      });
    };

    await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));
    expect(patched).toBe(true);

    const row = ddb.getItem(PK, 'ACCT#ACT-credit-1');
    expect(row?.isLiabilityOverride).toBe(false);
    expect(row?.balanceMinor).toBe(-43210); // bank fields still refreshed
  });

  it('keeps holdingsSupported sticky: a fresh item without the flag leaves the stored value alone', async () => {
    const ddb = new FakeDdb();
    await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));

    // P7-3 stamped support at some point (normally via applyHoldingsSupported).
    ddb.putItem({ ...ddb.getItem(PK, 'ACCT#ACT-checking-1'), holdingsSupported: true });

    // This payload's items never went through applyHoldingsSupported.
    await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));
    expect(ddb.getItem(PK, 'ACCT#ACT-checking-1')?.holdingsSupported).toBe(true);
  });

  it('drops availableBalance from the stored item when the institution stops sending it', async () => {
    const ddb = new FakeDdb();
    await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));
    expect(ddb.getItem(PK, 'ACCT#ACT-checking-1')?.availableBalanceMinor).toBe(120000);

    const withoutAvailable = baseAccountSet();
    delete withoutAvailable.accounts[0]!['available-balance'];
    await upsertSyncItems(normalizeForSync(withoutAvailable, CTX), options(ddb));

    const row = ddb.getItem(PK, 'ACCT#ACT-checking-1');
    expect(row?.availableBalanceMinor).toBeUndefined();
    expect(row?.availableBalanceRaw).toBeUndefined();
    expect(row?.balanceMinor).toBe(123456); // rest of the row intact
  });

  it('preserves a PATCH that lands mid-run: existing rows get attribute-scoped updates, not blind Puts', async () => {
    const ddb = new FakeDdb();
    await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));

    const sk = txnSk('2026-06-04', 'TXN-posted-1');

    // Simulate a user PATCH racing the second sync run: it lands AFTER the
    // writer has loaded its pointers/plan but BEFORE any write is applied.
    // The old read-merge-overwrite design silently reverted this edit (and
    // collided on version); the attribute-scoped update must not touch it.
    let patched = false;
    ddb.beforeWrite = () => {
      if (patched) return;
      patched = true;
      ddb.putItem({
        ...ddb.getItem(PK, sk),
        categoryId: 'groceries',
        categorizedBy: 'user',
        userCategorized: true,
        lastEditedBy: 'sub-aaron',
        note: 'Weekly shop',
        noteLower: 'weekly shop',
        GSI2PK: gsi2Pk(HOUSEHOLD, 'groceries'),
        GSI2SK: gsi2Sk('2026-06-04', 'TXN-posted-1'),
        version: 7, // the PATCH's own atomic bump
      });
    };

    const result = await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));
    expect(result.unprocessedCount).toBe(0);
    expect(patched).toBe(true);
    expect(ddb.updateCalls).toBeGreaterThan(0);

    const row = ddb.getItem(PK, sk);
    // User-owned fields survive untouched.
    expect(row?.categoryId).toBe('groceries');
    expect(row?.userCategorized).toBe(true);
    expect(row?.categorizedBy).toBe('user');
    expect(row?.lastEditedBy).toBe('sub-aaron');
    expect(row?.note).toBe('Weekly shop');
    expect(row?.noteLower).toBe('weekly shop');
    expect(row?.GSI2PK).toBe(gsi2Pk(HOUSEHOLD, 'groceries'));
    expect(row?.GSI2SK).toBe(gsi2Sk('2026-06-04', 'TXN-posted-1'));
    // version bumps ON TOP of the PATCH's bump instead of colliding with it.
    expect(row?.version).toBe(8);
    // Bank fields still refreshed.
    expect(row?.amountMinor).toBe(-3327);
    expect(row?.payeeLower).toBe('whole foods');
  });

  it('keeps a transacted_at txn in its purchase-date bucket when it posts (no re-key)', async () => {
    // The bug fix: a June-7 purchase the bank clears June-9 must STAY in the
    // June-7 budget week. With transacted_at present the SK never moves -- posting
    // is an in-place update (pending flips, postedDate set), with no stale delete,
    // no pointer move, and the user's categorization staying in its 06-07 week.
    const ddb = new FakeDdb();
    await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));

    const sk = txnSk('2026-06-07', 'TXN-pending-1');
    expect(ddb.getItem(PK, sk)?.pending).toBe(true);

    // User categorizes it while pending; the spend-index keys to the 06-07 week.
    ddb.putItem({
      ...ddb.getItem(PK, sk),
      categoryId: 'coffee',
      userCategorized: true,
      GSI2PK: gsi2Pk(HOUSEHOLD, 'coffee'),
      GSI2SK: gsi2Sk('2026-06-07', 'TXN-pending-1'),
      version: 5,
    });

    const result = await upsertSyncItems(normalizeForSync(postedAccountSet(), CTX), options(ddb));
    expect(result.staleDeletes).toBe(0);
    expect(result.unprocessedCount).toBe(0);

    // Still one row at the SAME SK; pointer unmoved.
    const row = ddb.getItem(PK, sk);
    expect(row).toBeDefined();
    expect(
      ddb.listSks(PK, 'TXN#').filter((s) => s.endsWith('#TXN-pending-1')),
    ).toEqual([sk]);
    expect(ddb.getItem(PK, txnPointerSk('TXN-pending-1'))?.currentSk).toBe(sk);

    // Posted in place: pending cleared, true clearing date recorded, but the SK
    // and the spend-index stay in the 06-07 purchase week.
    expect(row?.pending).toBe(false);
    expect(row?.postedDate).toBe('2026-06-09');
    expect(row?.categoryId).toBe('coffee');
    expect(row?.GSI2SK).toBe(gsi2Sk('2026-06-07', 'TXN-pending-1'));
  });

  it('re-keys a no-transacted_at pending -> posted: deletes the stale SK, updates the pointer, preserves user fields', async () => {
    const ddb = new FakeDdb();
    await upsertSyncItems(normalizeForSync(noTxPendingAccountSet(), CTX), options(ddb));

    // No transacted_at -> the pending bucket falls back to the sync date (NOW).
    const pendingSk = txnSk('2026-06-09', 'TXN-nodate-1');
    expect(ddb.getItem(PK, pendingSk)).toBeDefined();
    expect(ddb.getItem(PK, pendingSk)?.pending).toBe(true);

    // Simulate a user PATCH between syncs: category + note + spend-index keys.
    ddb.putItem({
      ...ddb.getItem(PK, pendingSk),
      categoryId: 'coffee',
      categorizedBy: 'user',
      userCategorized: true,
      lastEditedBy: 'sub-aaron',
      note: 'Latte with Dami',
      noteLower: 'latte with dami',
      GSI2PK: gsi2Pk(HOUSEHOLD, 'coffee'),
      GSI2SK: gsi2Sk('2026-06-09', 'TXN-nodate-1'),
      version: 5,
    });

    // Next sync: the transaction posted on 2026-06-11 -> the SK bucket shifts.
    const result = await upsertSyncItems(normalizeForSync(noTxPostedAccountSet(), CTX), options(ddb));
    expect(result.staleDeletes).toBe(1);
    expect(result.unprocessedCount).toBe(0);

    // Old SK gone, new SK present, still exactly one row for the id.
    expect(ddb.getItem(PK, pendingSk)).toBeUndefined();
    const postedSk = txnSk('2026-06-11', 'TXN-nodate-1');
    const moved = ddb.getItem(PK, postedSk);
    expect(moved).toBeDefined();
    expect(
      ddb.listSks(PK, 'TXN#').filter((sk) => sk.endsWith('#TXN-nodate-1')),
    ).toEqual([postedSk]);

    // Pointer follows the move; the breadcrumb is cleared after the delete.
    const pointer = ddb.getItem(PK, txnPointerSk('TXN-nodate-1'));
    expect(pointer?.currentSk).toBe(postedSk);
    expect(pointer?.previousSk).toBeUndefined();

    // Bank fields fresh; user fields preserved; GSI2SK recomputed for the new date.
    expect(moved?.pending).toBe(false);
    expect(moved?.postedDate).toBe('2026-06-11');
    expect(moved?.categoryId).toBe('coffee');
    expect(moved?.userCategorized).toBe(true);
    expect(moved?.lastEditedBy).toBe('sub-aaron');
    expect(moved?.note).toBe('Latte with Dami');
    expect(moved?.noteLower).toBe('latte with dami');
    expect(moved?.GSI2PK).toBe(gsi2Pk(HOUSEHOLD, 'coffee'));
    expect(moved?.GSI2SK).toBe(gsi2Sk('2026-06-11', 'TXN-nodate-1'));
    expect(moved?.version).toBe(6);
    expect(moved?.amountRaw).toBe('-21.00');
  });

  it('repairs a lost stale delete on the next run via the previousSk breadcrumb', async () => {
    const ddb = new FakeDdb();
    await upsertSyncItems(normalizeForSync(noTxPendingAccountSet(), CTX), options(ddb));

    const pendingSk = txnSk('2026-06-09', 'TXN-nodate-1');
    const postedSk = txnSk('2026-06-11', 'TXN-nodate-1');

    // The pending->posted run loses the stale delete (throttle/crash). The run
    // must fail (cursor not advanced) rather than report success.
    ddb.failDeletes = 1;
    await expect(
      upsertSyncItems(normalizeForSync(noTxPostedAccountSet(), CTX), options(ddb)),
    ).rejects.toThrow(/injected delete failure/);

    // Mid-crash shape: duplicate rows, pointer already moved, breadcrumb set.
    expect(ddb.getItem(PK, pendingSk)).toBeDefined();
    expect(ddb.getItem(PK, postedSk)).toBeDefined();
    const pointer = ddb.getItem(PK, txnPointerSk('TXN-nodate-1'));
    expect(pointer?.currentSk).toBe(postedSk);
    expect(pointer?.previousSk).toBe(pendingSk);

    // Next run: pointer.currentSk equals the incoming SK (so the old
    // moved=false logic would never re-emit the delete), but the breadcrumb
    // still names the stale row and must be deleted anyway.
    const result = await upsertSyncItems(normalizeForSync(noTxPostedAccountSet(), CTX), options(ddb));
    expect(result.staleDeletes).toBe(1);
    expect(result.unprocessedCount).toBe(0);
    expect(ddb.getItem(PK, pendingSk)).toBeUndefined();
    expect(
      ddb.listSks(PK, 'TXN#').filter((sk) => sk.endsWith('#TXN-nodate-1')),
    ).toEqual([postedSk]);
    const repaired = ddb.getItem(PK, txnPointerSk('TXN-nodate-1'));
    expect(repaired?.previousSk).toBeUndefined();
    expect(repaired?.currentSk).toBe(postedSk);
  });

  it('recreates a row that vanished underneath its pointer instead of creating a partial item', async () => {
    const ddb = new FakeDdb();
    await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));

    const sk = txnSk('2026-06-06', 'TXN-credit-1');
    ddb.deleteItem(PK, sk);

    await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));
    const row = ddb.getItem(PK, sk);
    expect(row).toBeDefined();
    // A whole fresh item, not a bank-fields-only fragment.
    expect(row?.categoryId).toBeNull();
    expect(row?.userCategorized).toBe(false);
    expect(row?.version).toBe(1);
    expect(row?.amountMinor).toBe(-8999);
  });

  it('retries partial batch failures until UnprocessedItems drain', async () => {
    const ddb = new FakeDdb();
    // First BatchWrite call leaves 3 unprocessed, the retry pass leaves 1,
    // then everything drains.
    ddb.unprocessedPlan = [3, 1];

    const result = await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), options(ddb));

    expect(result.unprocessedCount).toBe(0);
    expect(ddb.batchWriteCalls).toBe(3);
    expect(ddb.listSks(PK, 'TXN#')).toHaveLength(3);
    expect(ddb.listSks(PK, 'TXNPTR#')).toHaveLength(3);
    expect(ddb.listSks(PK, 'ACCT#')).toHaveLength(2);
  });

  it('reports undrained items after exhausting retry passes', async () => {
    const ddb = new FakeDdb();
    ddb.failAllBatches = true;

    const result = await upsertSyncItems(normalizeForSync(baseAccountSet(), CTX), {
      ...options(ddb),
      maxBatchPasses: 3,
    });

    expect(result.unprocessedCount).toBeGreaterThan(0);
    expect(ddb.batchWriteCalls).toBe(3);
    expect(ddb.listSks(PK, 'TXN#')).toHaveLength(0);
  });
});
