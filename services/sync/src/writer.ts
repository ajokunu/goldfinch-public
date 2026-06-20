/**
 * Idempotent DynamoDB writer for the sync pipeline.
 *
 * Strategy (master plan part 10, decisions 1-2; revised after code review):
 *
 *   - Idempotency is STRUCTURAL: the stable SimpleFIN txn id lives in the SK
 *     (TXN#<yyyy-mm-dd>#<txnId>), so re-pulled rows land on the same key. A
 *     TXNPTR#<txnId> pointer records each transaction's current SK.
 *
 *   - Ownership is separated AT WRITE ALTITUDE. The sync Lambda owns bank
 *     fields (amounts, payee, pending, dates, GSI1 keys); the services/api
 *     PATCH owns user fields (categoryId, note/noteLower, isTransfer,
 *     userCategorized, categorizedBy, lastEditedBy, and the GSI2 spend-index
 *     keys that follow the category). EXISTING rows are therefore written
 *     with an attribute-scoped UpdateCommand that SETs only bank-owned
 *     attributes and never reads or writes user-owned ones - a PATCH landing
 *     at any point during a sync run can no longer be silently reverted by a
 *     blind whole-item overwrite. Only NEW rows (no pointer yet) are written
 *     whole via BatchWriteItem (cheap; nothing user-owned exists to stomp).
 *
 *   - ACCOUNTS get the same treatment (P8-4): ACCT# items are written with an
 *     attribute-scoped UpdateCommand that SETs only sync-owned attributes, so
 *     the USER-OWNED override fields (typeOverride, isLiabilityOverride - set
 *     only by PATCH /accounts) and the creation-owned `source` flag are
 *     untouchable BY CONSTRUCTION. UpdateItem creates the item when absent
 *     (a brand-new account has no user-owned attributes to lose), so one code
 *     path covers create and refresh with no existence read. There is no
 *     account analogue of the moved-row merge path: ACCT#<id> keys never
 *     re-key, so no whole-item account Put exists anywhere in sync.
 *
 *   - `version` semantics (kept coherent with services/api PATCH): version is
 *     a monotonic write counter, bumped atomically by every writer with
 *     `SET #version = if_not_exists(#version, :zero) + :one` - the exact
 *     expression PATCH uses. No writer SETs an absolute version over an
 *     existing row, so concurrent bumps serialize instead of colliding, and a
 *     PATCH carrying an optimistic-lock `version` gets a clean 409 when sync
 *     touched the row in between. Note: an in-place sync update bumps version
 *     even when no bank field changed; version means "row was written", not
 *     "row differs".
 *
 *   - pending -> posted re-key is a crash-safe, idempotent sequence of
 *     INDIVIDUAL commands (never split across a BatchWrite):
 *       (1) Put the NEW row (user fields merged from the stale row),
 *       (2) Put the pointer with currentSk = new SK and a `previousSk`
 *           breadcrumb naming the stale row,
 *       (3) DeleteCommand the stale row,
 *       (4) clear `previousSk`.
 *     pointer.currentSk is NEVER trusted as proof of a completed re-key; the
 *     `previousSk` breadcrumb is the staleness signal. Every run starts by
 *     deleting any lingering `previousSk` row and only then clears the
 *     breadcrumb, so a delete lost to a crash/throttle is repaired on the
 *     next run instead of leaving a permanent duplicate. Losing the new Put
 *     cannot orphan user data because the pointer only moves AFTER the new
 *     row exists.
 *     Residual race (accepted, documented): a PATCH that lands on the OLD row
 *     between the merge read in (1) and the stale delete in (3) is lost with
 *     the old row. The window is sub-second and exists only on the day a
 *     pending transaction posts.
 *
 *   - BatchWriteItem (accounts + brand-new rows) runs in chunks of 25 with an
 *     UnprocessedItems exponential-backoff-plus-jitter retry loop. Whatever
 *     remains undrained is reported so the handler refuses to advance the
 *     cursor.
 *
 * IAM note: the sync role has dynamodb:Query / PutItem / BatchWriteItem /
 * UpdateItem / DeleteItem - deliberately NOT GetItem / BatchGetItem - so all
 * reads here are Querys: one paginated Query over the TXNPTR# segment, then
 * exact-key Querys only for the stale rows of moved transactions.
 */

import {
  BatchWriteCommand,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { KEY_PREFIX, gsi2Sk, parseTxnSk, userPk } from '@goldfinch/shared/keys';
import type { TxnSk, UserPk } from '@goldfinch/shared/keys';
import type { Logger } from '@goldfinch/shared/logger';
import type { AccountItem, TransactionItem, TxnPointerItem } from '@goldfinch/shared/types';

import type {
  SyncAccountItem,
  SyncTransactionItem,
  SyncTxnPointerItem,
} from './types.js';

/** Minimal client surface so tests can inject an in-memory fake. */
export type DocClient = Pick<DynamoDBDocumentClient, 'send'>;

/**
 * Marshalled item shape handed to the DocumentClient. `any` (not `unknown`)
 * is deliberate and contained to this alias: the SDK's own item type is
 * Record<string, NativeAttributeValue>, which interfaces (no index signature)
 * cannot satisfy without a cast, and `unknown` is not assignable to the
 * NativeAttributeValue union. Every value placed here is one of our typed
 * entity items.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DdbItem = Record<string, any>;

export class SyncWriteIncompleteError extends Error {
  constructor(readonly unprocessedCount: number) {
    super(
      `${unprocessedCount} write request(s) remained unprocessed after all retry passes; ` +
        'cursor not advanced - the window will be re-pulled next run',
    );
    this.name = 'SyncWriteIncompleteError';
  }
}

export interface UpsertInput {
  accounts: SyncAccountItem[];
  transactions: SyncTransactionItem[];
  pointers: TxnPointerItem[];
}

export type SleepFn = (ms: number) => Promise<void>;

export interface UpsertOptions {
  docClient: DocClient;
  tableName: string;
  household: string;
  /** Total BatchWrite passes over unprocessed items (default 6). */
  maxBatchPasses?: number;
  /** Base backoff delay in ms (default 200; tests pass 0/no-op sleep). */
  baseDelayMs?: number;
  sleep?: SleepFn;
  /** Parallelism for per-item reads/updates/moves (default 8). */
  readConcurrency?: number;
  /**
   * Structured logger (P7-10): retry passes and fallback/repair paths log
   * with context instead of failing or degrading silently.
   */
  logger?: Logger;
}

export interface UpsertResult {
  accountsUpserted: number;
  txnsUpserted: number;
  pointersWritten: number;
  /**
   * Stale TXN# rows deleted: pending->posted moves completed this run plus
   * lingering `previousSk` rows repaired from a prior crashed/throttled run.
   */
  staleDeletes: number;
  /** Write requests still unprocessed after all retry passes (0 on success). */
  unprocessedCount: number;
}

type WriteRequest = { PutRequest: { Item: DdbItem } };

const BATCH_SIZE = 25;

/**
 * Bank-owned TXN attributes. These - and ONLY these, plus the atomic version
 * bump - are touched when sync updates an existing row. Required attributes
 * are always SET; optional ones are SET when present on the fresh item and
 * REMOVEd when absent (SimpleFIN stopped sending them). Everything else on
 * TransactionItem (categoryId, note/noteLower, isTransfer, userCategorized,
 * categorizedBy, lastEditedBy, createdAt, GSI2PK/GSI2SK) is user-owned or
 * creation-owned and must never appear here.
 */
const BANK_OWNED_REQUIRED = [
  'schemaVersion',
  'amountMinor',
  'amountRaw',
  'currency',
  'payee',
  'accountId',
  'pending',
  'postedDate',
  'simplefinTxnId',
  'GSI1PK',
  'GSI1SK',
  'updatedAt',
] as const satisfies readonly (keyof SyncTransactionItem)[];

const BANK_OWNED_OPTIONAL = [
  'payeeLower',
  'description',
  'memo',
  'transactedAt',
] as const satisfies readonly (keyof SyncTransactionItem)[];

/**
 * USER-OWNED ACCT attributes (P8-4): written only by PATCH /accounts, never
 * by sync. Exported so the writer tests (and any future account write path)
 * can assert by name that no sync expression ever references them. `source`
 * (P7-6 creation-owned) is excluded from the sync-owned lists for the same
 * reason but lives outside this list: it is not user-editable.
 */
export const ACCOUNT_USER_OWNED_FIELDS = [
  'typeOverride',
  'isLiabilityOverride',
] as const satisfies readonly (keyof AccountItem)[];

/**
 * Sync-owned ACCT attributes, always present on a normalized account and
 * always SET. Everything NOT in the three sync-owned lists below - notably
 * ACCOUNT_USER_OWNED_FIELDS and `source` - never appears in the account
 * update expression, so sync cannot set OR clear it.
 */
const ACCOUNT_SYNC_OWNED_REQUIRED = [
  'entityType',
  'schemaVersion',
  'name',
  'accountType',
  'institution',
  'balanceMinor',
  'currency',
  'balanceDate',
  'simplefinAccountId',
  'lastSyncedAt',
  'balanceRaw',
  'isLiability',
] as const satisfies readonly (keyof SyncAccountItem)[];

/** SET when present, REMOVEd when the institution stopped sending them. */
const ACCOUNT_SYNC_OWNED_OPTIONAL = [
  'availableBalanceMinor',
  'availableBalanceRaw',
  'simplefinOrgId',
] as const satisfies readonly (keyof SyncAccountItem)[];

/**
 * SET when present, NEVER REMOVEd: holdingsSupported is sticky-true per the
 * P7-3 contract ("ever returned a holdings array"), so an absent value on the
 * fresh item (a caller that skipped applyHoldingsSupported) must leave any
 * stored flag alone rather than wipe it.
 */
const ACCOUNT_SYNC_OWNED_STICKY = [
  'holdingsSupported',
] as const satisfies readonly (keyof SyncAccountItem)[];

const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function backoffDelay(baseDelayMs: number, attempt: number): number {
  const exp = baseDelayMs * 2 ** attempt;
  // Full jitter in [exp/2, exp].
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

function isConditionalCheckFailed(err: unknown): boolean {
  return err instanceof Error && err.name === 'ConditionalCheckFailedException';
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Load every TXNPTR# pointer item in the household partition (paginated Query). */
async function loadPointers(
  docClient: DocClient,
  tableName: string,
  pk: UserPk,
): Promise<Map<string, SyncTxnPointerItem>> {
  const map = new Map<string, SyncTxnPointerItem>();
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': KEY_PREFIX.txnPointer },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const raw of response.Items ?? []) {
      const pointer = raw as unknown as SyncTxnPointerItem;
      map.set(pointer.simplefinTxnId, pointer);
    }
    exclusiveStartKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey !== undefined);
  return map;
}

/** Exact-key read via Query (the role has no GetItem). */
async function readTransaction(
  docClient: DocClient,
  tableName: string,
  pk: UserPk,
  sk: TxnSk,
): Promise<TransactionItem | undefined> {
  const response = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: { ':pk': pk, ':sk': sk },
      Limit: 1,
    }),
  );
  const item = response.Items?.[0];
  return item === undefined ? undefined : (item as unknown as TransactionItem);
}

/**
 * Merge user-owned fields from the stale row into the freshly normalized one.
 * Used ONLY for pending->posted moves, where the row materializes at a new SK
 * and a whole-item Put is unavoidable. Bank-sourced fields stay fresh;
 * user-sourced fields are carried over; version continues from the stale row
 * (single-writer for the new SK at this instant: the client cannot PATCH a SK
 * it has not seen yet).
 */
export function mergeUserFields(
  fresh: SyncTransactionItem,
  existing: TransactionItem,
): SyncTransactionItem {
  const merged: SyncTransactionItem = {
    ...fresh,
    categoryId: existing.categoryId,
    categorizedBy: existing.categorizedBy,
    userCategorized: existing.userCategorized,
    lastEditedBy: existing.lastEditedBy,
    isTransfer: existing.isTransfer,
    version: existing.version + 1,
  };
  if (existing.createdAt !== undefined) {
    merged.createdAt = existing.createdAt;
  }
  if (existing.note !== undefined) {
    merged.note = existing.note;
    merged.noteLower = existing.noteLower ?? existing.note.toLowerCase();
  }
  // The sparse spend index follows the category. If the existing row was in
  // GSI2, keep it there - but recompute GSI2SK against the (shifted) SK date
  // so a pending->posted move never strands a stale index entry.
  if (existing.GSI2PK !== undefined) {
    merged.GSI2PK = existing.GSI2PK;
    merged.GSI2SK = gsi2Sk(parseTxnSk(fresh.SK).date, fresh.simplefinTxnId);
  }
  return merged;
}

export interface BankFieldUpdate {
  updateExpression: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
}

/**
 * Build the attribute-scoped UpdateCommand pieces for an existing row:
 * SET bank-owned fields + the atomic version bump, REMOVE absent optional
 * bank fields. User-owned attributes are never referenced, so a concurrent
 * PATCH can never be reverted by this expression.
 */
export function buildBankFieldUpdate(fresh: SyncTransactionItem): BankFieldUpdate {
  const names: Record<string, string> = { '#version': 'version' };
  const values: Record<string, unknown> = { ':zero': 0, ':one': 1 };
  const sets: string[] = ['#version = if_not_exists(#version, :zero) + :one'];
  const removes: string[] = [];

  for (const field of BANK_OWNED_REQUIRED) {
    const value = fresh[field];
    if (value === undefined) {
      continue; // defensive: required fields are always set by the normalizer
    }
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    sets.push(`#${field} = :${field}`);
  }
  for (const field of BANK_OWNED_OPTIONAL) {
    const value = fresh[field];
    names[`#${field}`] = field;
    if (value === undefined) {
      removes.push(`#${field}`);
    } else {
      values[`:${field}`] = value;
      sets.push(`#${field} = :${field}`);
    }
  }

  let updateExpression = `SET ${sets.join(', ')}`;
  if (removes.length > 0) {
    updateExpression += ` REMOVE ${removes.join(', ')}`;
  }
  return { updateExpression, names, values };
}

/**
 * Build the attribute-scoped UpdateCommand pieces for an ACCT# item (P8-4):
 * SET sync-owned fields, REMOVE absent removable optionals, never reference
 * anything else. No version counter - accounts carry none (PATCH /accounts
 * conditions on item existence, not a version). The user-owned override
 * fields and `source` are absent from every list, so a concurrent (or prior)
 * PATCH can never be reverted by this expression.
 */
export function buildAccountFieldUpdate(fresh: SyncAccountItem): BankFieldUpdate {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  const removes: string[] = [];

  for (const field of ACCOUNT_SYNC_OWNED_REQUIRED) {
    const value = fresh[field];
    if (value === undefined) {
      continue; // defensive: required fields are always set by the normalizer
    }
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    sets.push(`#${field} = :${field}`);
  }
  for (const field of ACCOUNT_SYNC_OWNED_OPTIONAL) {
    const value = fresh[field];
    names[`#${field}`] = field;
    if (value === undefined) {
      removes.push(`#${field}`);
    } else {
      values[`:${field}`] = value;
      sets.push(`#${field} = :${field}`);
    }
  }
  for (const field of ACCOUNT_SYNC_OWNED_STICKY) {
    const value = fresh[field];
    if (value === undefined) {
      continue; // sticky: absent on the fresh item leaves the stored flag alone
    }
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    sets.push(`#${field} = :${field}`);
  }

  let updateExpression = `SET ${sets.join(', ')}`;
  if (removes.length > 0) {
    updateExpression += ` REMOVE ${removes.join(', ')}`;
  }
  return { updateExpression, names, values };
}

/**
 * Create-or-refresh one ACCT# item via the attribute-scoped update (P8-4).
 * UpdateItem creates the item when absent - a brand-new account is exactly
 * its sync-owned attributes - and on an existing item touches ONLY the
 * sync-owned attributes, leaving typeOverride / isLiabilityOverride / source
 * untouched by construction. A failure here propagates and fails the run
 * (idempotent; the next scheduled run repairs).
 */
async function upsertAccount(
  docClient: DocClient,
  tableName: string,
  account: SyncAccountItem,
): Promise<void> {
  const { updateExpression, names, values } = buildAccountFieldUpdate(account);
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: account.PK, SK: account.SK },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/**
 * In-place refresh of an existing row (pointer SK == incoming SK): bank fields
 * only, atomic version bump, no read of the row at all - so there is no
 * read-merge-overwrite window for a PATCH to fall into. The condition guards
 * against the pointer being stale (row vanished): Update would otherwise
 * CREATE a partial item missing every user-owned attribute. On conditional
 * failure the row genuinely does not exist, so the fresh item is Put whole.
 */
async function updateExistingTransaction(
  docClient: DocClient,
  tableName: string,
  pk: UserPk,
  fresh: SyncTransactionItem,
  logger?: Logger,
): Promise<void> {
  const { updateExpression, names, values } = buildBankFieldUpdate(fresh);
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: pk, SK: fresh.SK },
        UpdateExpression: updateExpression,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  } catch (err) {
    if (!isConditionalCheckFailed(err)) {
      throw err;
    }
    // Row is gone despite the pointer: nothing user-owned exists to preserve.
    // P7-10: this fallback is an anomaly worth seeing in the logs.
    logger?.warn('transaction row missing despite pointer; recreating from fresh item', {
      sk: fresh.SK,
      simplefinTxnId: fresh.simplefinTxnId,
    });
    await docClient.send(
      new PutCommand({ TableName: tableName, Item: fresh as DdbItem }),
    );
  }
}

/** REMOVE the `previousSk` breadcrumb; a vanished pointer is treated as cleared. */
async function clearPreviousSk(
  docClient: DocClient,
  tableName: string,
  pk: UserPk,
  pointerSk: string,
  logger?: Logger,
): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: pk, SK: pointerSk },
        UpdateExpression: 'REMOVE #previousSk',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#previousSk': 'previousSk' },
      }),
    );
  } catch (err) {
    if (!isConditionalCheckFailed(err)) {
      throw err;
    }
    // Documented semantic (vanished pointer == cleared), but P7-10 says the
    // swallowed condition still gets a log line with context.
    logger?.info('pointer vanished while clearing previousSk breadcrumb; treating as cleared', {
      pointerSk,
    });
  }
}

/**
 * Repair pass: delete any stale row still named by a `previousSk` breadcrumb
 * (a prior run crashed between pointer update and stale delete), then clear
 * the breadcrumb. Runs before everything else so a re-moved transaction this
 * run starts from a consistent shape. Returns the number of rows deleted.
 */
async function repairDanglingMoves(
  docClient: DocClient,
  tableName: string,
  pk: UserPk,
  pointers: readonly SyncTxnPointerItem[],
  concurrency: number,
  logger?: Logger,
): Promise<number> {
  const dangling = pointers.filter((pointer) => pointer.previousSk !== undefined);
  let repaired = 0;
  await mapWithConcurrency(dangling, concurrency, async (pointer) => {
    const previousSk = pointer.previousSk as TxnSk;
    // Never delete the live row; previousSk === currentSk should be impossible
    // but a malformed breadcrumb must not destroy data.
    if (previousSk !== pointer.currentSk) {
      // A prior run crashed/throttled mid-move; the repair itself is routine,
      // but the fact a repair was needed should be visible (P7-10).
      logger?.warn('repairing dangling pending->posted move from a prior run', {
        pointerSk: pointer.SK,
        previousSk,
        currentSk: pointer.currentSk,
      });
      await docClient.send(
        new DeleteCommand({ TableName: tableName, Key: { PK: pk, SK: previousSk } }),
      );
      repaired += 1;
    } else {
      logger?.warn('malformed breadcrumb (previousSk equals currentSk); clearing without delete', {
        pointerSk: pointer.SK,
        previousSk,
      });
    }
    await clearPreviousSk(docClient, tableName, pk, pointer.SK, logger);
  });
  return repaired;
}

/**
 * Crash-safe pending->posted re-key (see module header for the invariant
 * analysis). Every step is idempotent; a crash anywhere leaves a shape the
 * next run repairs from what actually exists, not from pointer.currentSk.
 */
async function moveTransaction(
  docClient: DocClient,
  tableName: string,
  pk: UserPk,
  fresh: SyncTransactionItem,
  pointer: TxnPointerItem,
  staleSk: TxnSk,
  logger?: Logger,
): Promise<void> {
  // The stale row is the merge source for user-owned fields; the only read
  // retained in the writer besides the pointer scan.
  const existing = await readTransaction(docClient, tableName, pk, staleSk);
  const item = existing !== undefined ? mergeUserFields(fresh, existing) : fresh;

  // (1) New row first: a crash here leaves the pointer at the stale SK and the
  // next run simply redoes the whole move.
  await docClient.send(new PutCommand({ TableName: tableName, Item: item as DdbItem }));

  // (2) Move the pointer WITH the breadcrumb; from here on the stale row is
  // re-derivable even if (3) is lost.
  const moved: SyncTxnPointerItem = { ...pointer, currentSk: fresh.SK, previousSk: staleSk };
  await docClient.send(new PutCommand({ TableName: tableName, Item: moved as DdbItem }));

  // (3) Delete the stale row (idempotent; deleting a missing key is a no-op).
  await docClient.send(
    new DeleteCommand({ TableName: tableName, Key: { PK: pk, SK: staleSk } }),
  );

  // (4) Only after the delete succeeded: clear the breadcrumb.
  await clearPreviousSk(docClient, tableName, pk, pointer.SK, logger);
}

/**
 * Flush write requests in chunks of 25, looping on UnprocessedItems with
 * exponential backoff + jitter until drained or maxPasses is reached.
 * Returns the count of requests that never drained.
 */
async function flushBatches(
  requests: WriteRequest[],
  docClient: DocClient,
  tableName: string,
  maxPasses: number,
  baseDelayMs: number,
  sleep: SleepFn,
  logger?: Logger,
): Promise<number> {
  let queue = requests;
  for (let pass = 0; pass < maxPasses && queue.length > 0; pass += 1) {
    if (pass > 0) {
      await sleep(backoffDelay(baseDelayMs, pass - 1));
    }
    const leftover: WriteRequest[] = [];
    for (let offset = 0; offset < queue.length; offset += BATCH_SIZE) {
      const chunk = queue.slice(offset, offset + BATCH_SIZE);
      const response = await docClient.send(
        new BatchWriteCommand({ RequestItems: { [tableName]: chunk } }),
      );
      const unprocessed = response.UnprocessedItems?.[tableName];
      if (unprocessed !== undefined && unprocessed.length > 0) {
        leftover.push(...(unprocessed as WriteRequest[]));
      }
    }
    if (leftover.length > 0) {
      // P7-10: each throttled retry pass is logged, not silently absorbed.
      logger?.warn('batch write pass left unprocessed items; backing off to retry', {
        pass: pass + 1,
        maxPasses,
        unprocessed: leftover.length,
      });
    }
    queue = leftover;
  }
  return queue.length;
}

interface PlannedMove {
  fresh: SyncTransactionItem;
  pointer: TxnPointerItem;
  staleSk: TxnSk;
}

/**
 * Idempotently upsert one normalized sync payload. Safe to run any number of
 * times over overlapping windows: re-pulls update bank fields in place (user
 * edits untouched by construction), pending->posted moves are crash-safe
 * individual-command sequences, and incomplete moves from prior runs are
 * repaired via the pointer's `previousSk` breadcrumb.
 */
export async function upsertSyncItems(
  input: UpsertInput,
  options: UpsertOptions,
): Promise<UpsertResult> {
  const pk = userPk(options.household);
  const maxBatchPasses = options.maxBatchPasses ?? 6;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const sleep = options.sleep ?? defaultSleep;
  const concurrency = options.readConcurrency ?? 8;
  const { docClient, tableName, logger } = options;

  const existingPointers = await loadPointers(docClient, tableName, pk);

  // Phase 0: repair incomplete re-keys left by a crashed/throttled prior run.
  const repairedDeletes = await repairDanglingMoves(
    docClient,
    tableName,
    pk,
    [...existingPointers.values()],
    concurrency,
    logger,
  );

  const pointerByTxnId = new Map<string, TxnPointerItem>();
  for (const pointer of input.pointers) {
    pointerByTxnId.set(pointer.simplefinTxnId, pointer);
  }

  // Classify every incoming transaction by what its pointer says. Accounts
  // are NOT batched: each gets an attribute-scoped create-or-refresh Update
  // (P8-4) so the user-owned override fields can never be stomped.
  const batchPuts: DdbItem[] = [];
  const inPlace: SyncTransactionItem[] = [];
  const moves: PlannedMove[] = [];
  let pointersWritten = 0;

  for (const txn of input.transactions) {
    const existing = existingPointers.get(txn.simplefinTxnId);
    const pointer = pointerByTxnId.get(txn.simplefinTxnId);
    if (existing === undefined) {
      // Brand new: whole-item Put + pointer via BatchWrite (no user data at risk).
      batchPuts.push(txn);
      if (pointer !== undefined) {
        batchPuts.push(pointer);
        pointersWritten += 1;
      }
    } else if (existing.currentSk === txn.SK) {
      inPlace.push(txn);
    } else {
      // moveTransaction overrides currentSk/previousSk, so falling back to the
      // stored pointer item is safe if the payload somehow lacked one.
      moves.push({ fresh: txn, pointer: pointer ?? existing, staleSk: existing.currentSk });
      pointersWritten += 1;
    }
  }

  // Phase 1a: accounts via attribute-scoped create-or-refresh Updates (P8-4).
  // An Update failure throws and fails the run - stronger than the batched
  // unprocessed handling, and correct: the cursor must not advance over an
  // account whose balance write was lost.
  await mapWithConcurrency(input.accounts, concurrency, (account) =>
    upsertAccount(docClient, tableName, account),
  );

  // Phase 1b: brand-new rows/pointers via BatchWrite.
  const unprocessedCount = await flushBatches(
    batchPuts.map((item) => ({ PutRequest: { Item: item } })),
    docClient,
    tableName,
    maxBatchPasses,
    baseDelayMs,
    sleep,
    logger,
  );

  // Phase 2: attribute-scoped bank-field updates for unmoved existing rows.
  await mapWithConcurrency(inPlace, concurrency, (txn) =>
    updateExistingTransaction(docClient, tableName, pk, txn, logger),
  );

  // Phase 3: crash-safe pending->posted re-keys.
  await mapWithConcurrency(moves, concurrency, (move) =>
    moveTransaction(docClient, tableName, pk, move.fresh, move.pointer, move.staleSk, logger),
  );

  return {
    accountsUpserted: input.accounts.length,
    txnsUpserted: input.transactions.length,
    pointersWritten,
    staleDeletes: moves.length + repairedDeletes,
    unprocessedCount,
  };
}
