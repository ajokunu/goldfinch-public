/**
 * Cross-workspace contract-drift suite (master plan part 18).
 *
 * One in-memory single table is shared by BOTH real implementations:
 *
 *   SimpleFIN fixture payload
 *     -> @goldfinch/sync normalizeForSync + upsertSyncItems   (real writer)
 *     -> FakeGoldFinchTable                                    (one store)
 *     -> @goldfinch/api handler via API Gateway JWT events     (real routes)
 *
 * Every key is independently re-derived here through the @goldfinch/shared
 * key builders, so if ANY workspace drifts from the shared contract (key
 * shapes, claim names, DTO money pairs, GSI sparseness, pointer SK scheme),
 * a read on this suite fails. The narrative is sequential by design: later
 * tests build on the state earlier tests created, mirroring two real sync
 * days with a user categorization in between (the pending->posted date-shift
 * scenario that is the dominant idempotency risk, plan risk R8).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type BatchWriteCommandInput,
  type DeleteCommandInput,
  type GetCommandInput,
  type PutCommandInput,
  type QueryCommandInput,
  type UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { handler } from '@goldfinch/api';
import { normalizeForSync } from '@goldfinch/sync/dist/normalize.js';
import { upsertSyncItems } from '@goldfinch/sync/dist/writer.js';
import { HOUSEHOLD_ID } from '@goldfinch/shared/constants';
import {
  acctSk,
  gsi2Pk,
  gsi2Sk,
  txnPointerSk,
  txnSk,
  userPk,
  KEY_PREFIX,
} from '@goldfinch/shared/keys';
import type {
  AccountDto,
  BudgetDto,
  CashflowResponse,
  CategoryDto,
  ErrorEnvelope,
  ListAccountsResponse,
  ListBudgetsResponse,
  ListTransactionsResponse,
  PatchTransactionCategoryResponse,
  SummaryResponse,
  TransactionItem,
  TxnPointerItem,
} from '@goldfinch/shared/types';
import type { SimpleFinAccountSet } from '@goldfinch/shared/simplefin';
import {
  FakeGoldFinchTable,
  FIXTURE_ACCOUNT_TYPES,
  FIXTURE_CHECKING_ID,
  FIXTURE_CREDIT_ID,
  FIXTURE_DATES,
  FIXTURE_TXN_COFFEE,
  FIXTURE_TXN_CREDIT_GAS,
  FIXTURE_TXN_GROCERIES,
  FIXTURE_TXN_PAYCHECK,
  makeApiGatewayEvent,
  makeAnonymousEvent,
  makeHouseholdPayloadDayOne,
  makeHouseholdPayloadDayTwo,
  setApiTestEnv,
  TEST_NOW_ISO,
  TEST_SUB_ALEX,
  TEST_TABLE_NAME,
  type ApiEventInput,
} from '../src/index.js';

const PK = userPk(HOUSEHOLD_ID);
const table = new FakeGoldFinchTable(TEST_TABLE_NAME);
const ddbMock = mockClient(DynamoDBDocumentClient);

beforeAll(() => {
  setApiTestEnv(TEST_TABLE_NAME);
  // Route the API Lambda's module-scope DocumentClient into the same fake
  // table the sync writer writes to (the writer takes an injected client).
  ddbMock.on(GetCommand).callsFake(async (input) => table.get(input as GetCommandInput));
  ddbMock.on(QueryCommand).callsFake(async (input) => table.query(input as QueryCommandInput));
  ddbMock.on(PutCommand).callsFake(async (input) => table.put(input as PutCommandInput));
  ddbMock.on(UpdateCommand).callsFake(async (input) => table.update(input as UpdateCommandInput));
  ddbMock.on(DeleteCommand).callsFake(async (input) => table.delete(input as DeleteCommandInput));
  ddbMock
    .on(BatchWriteCommand)
    .callsFake(async (input) => table.batchWrite(input as BatchWriteCommandInput));
});

afterAll(() => {
  ddbMock.restore();
});

async function runSync(payload: SimpleFinAccountSet) {
  const normalized = normalizeForSync(payload, {
    household: HOUSEHOLD_ID,
    now: new Date(TEST_NOW_ISO),
    accountTypes: FIXTURE_ACCOUNT_TYPES,
  });
  expect(normalized.errlist).toHaveLength(0);
  return upsertSyncItems(
    {
      accounts: normalized.accounts,
      transactions: normalized.transactions,
      pointers: normalized.pointers,
    },
    {
      docClient: table.asDocClient(),
      tableName: TEST_TABLE_NAME,
      household: HOUSEHOLD_ID,
      baseDelayMs: 0,
      sleep: async () => {},
    },
  );
}

async function invoke<T>(input: ApiEventInput): Promise<{ status: number; body: T }> {
  const res = await handler(makeApiGatewayEvent(input));
  return {
    status: res.statusCode ?? 0,
    body: JSON.parse(res.body ?? 'null') as T,
  };
}

const JUNE = { from: '2026-06-01', to: '2026-06-30' };

/** Set during the categorization tests; consumed by the re-sync tests. */
let coffeeCategoryId = '';
let coffeeVersionAfterPatch = 0;

describe('day one: sync writer persists at the key-builder keys', () => {
  it('upserts two accounts, four transactions, and four pointers', async () => {
    const result = await runSync(makeHouseholdPayloadDayOne());
    expect(result).toMatchObject({
      accountsUpserted: 2,
      txnsUpserted: 4,
      pointersWritten: 4,
      staleDeletes: 0,
      unprocessedCount: 0,
    });
  });

  it('lands every row exactly where the shared key builders predict', () => {
    const expected: Array<[string, string]> = [
      [FIXTURE_TXN_GROCERIES, FIXTURE_DATES.groceries],
      [FIXTURE_TXN_PAYCHECK, FIXTURE_DATES.paycheck],
      [FIXTURE_TXN_COFFEE, FIXTURE_DATES.coffeePending],
      [FIXTURE_TXN_CREDIT_GAS, FIXTURE_DATES.creditGas],
    ];
    for (const [txnId, date] of expected) {
      const row = table.getStored(PK, txnSk(date, txnId));
      expect(row, `transaction ${txnId} at ${txnSk(date, txnId)}`).toBeDefined();
      const pointer = table.getStored(PK, txnPointerSk(txnId)) as
        | TxnPointerItem
        | undefined;
      expect(pointer?.currentSk).toBe(txnSk(date, txnId));
    }
    const checking = table.getStored(PK, acctSk(FIXTURE_CHECKING_ID));
    expect(checking?.['accountType']).toBe('checking');
    expect(checking?.['balanceMinor']).toBe(523_055);
    const credit = table.getStored(PK, acctSk(FIXTURE_CREDIT_ID));
    expect(credit?.['accountType']).toBe('credit');
    expect(credit?.['balanceMinor']).toBe(-50_000);
  });

  it('is idempotent: re-running the identical payload adds no rows', async () => {
    const before = table.countByPrefix(PK, KEY_PREFIX.transaction);
    const result = await runSync(makeHouseholdPayloadDayOne());
    expect(result.staleDeletes).toBe(0);
    expect(result.unprocessedCount).toBe(0);
    expect(table.countByPrefix(PK, KEY_PREFIX.transaction)).toBe(before);
    expect(table.countByPrefix(PK, KEY_PREFIX.txnPointer)).toBe(4);
  });
});

describe('day one: api routes read what the writer wrote', () => {
  it('GET /accounts returns both accounts with paired money fields', async () => {
    const { status, body } = await invoke<ListAccountsResponse>({
      routeKey: 'GET /accounts',
    });
    expect(status).toBe(200);
    expect(body.items).toHaveLength(2);
    const checking = body.items.find((a) => a.accountId === FIXTURE_CHECKING_ID);
    expect(checking).toMatchObject({
      name: 'Everyday Checking',
      accountType: 'checking',
      balance: '5230.55',
      balanceMinor: 523_055,
      currency: 'USD',
      isLiability: false,
    });
    const creditCard = body.items.find((a) => a.accountId === FIXTURE_CREDIT_ID);
    expect(creditCard).toMatchObject({
      accountType: 'credit',
      balance: '-500.00',
      balanceMinor: -50_000,
      isLiability: true,
    });
  });

  it('GET /accounts/{accountId} fetches one account by the ACCT# key', async () => {
    const { status, body } = await invoke<AccountDto>({
      routeKey: 'GET /accounts/{accountId}',
      pathParameters: { accountId: FIXTURE_CHECKING_ID },
    });
    expect(status).toBe(200);
    expect(body.accountId).toBe(FIXTURE_CHECKING_ID);
    expect(body.balanceMinor).toBe(523_055);
  });

  it('GET /summary computes net worth = assets - liabilities', async () => {
    const { status, body } = await invoke<SummaryResponse>({
      routeKey: 'GET /summary',
    });
    expect(status).toBe(200);
    expect(body.assetsTotalMinor).toBe(523_055);
    expect(body.liabilitiesTotalMinor).toBe(50_000);
    expect(body.netWorthMinor).toBe(473_055);
    expect(body.netWorth).toBe('4730.55');
  });

  it('GET /transactions returns all four rows newest-first with money pairs', async () => {
    const { status, body } = await invoke<ListTransactionsResponse>({
      routeKey: 'GET /transactions',
      query: JUNE,
    });
    expect(status).toBe(200);
    expect(body.items).toHaveLength(4);
    const dates = body.items.map((t) => t.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    const groceries = body.items.find((t) => t.txnId === FIXTURE_TXN_GROCERIES);
    expect(groceries).toMatchObject({
      date: FIXTURE_DATES.groceries,
      amount: '-42.15',
      amountMinor: -4_215,
      accountId: FIXTURE_CHECKING_ID,
      pending: false,
      categoryId: null,
    });
  });

  it('GET /accounts/{accountId}/transactions serves the GSI1 per-account view', async () => {
    const checking = await invoke<ListTransactionsResponse>({
      routeKey: 'GET /accounts/{accountId}/transactions',
      pathParameters: { accountId: FIXTURE_CHECKING_ID },
      query: JUNE,
    });
    expect(checking.status).toBe(200);
    expect(checking.body.items).toHaveLength(3);
    expect(
      checking.body.items.every((t) => t.accountId === FIXTURE_CHECKING_ID),
    ).toBe(true);

    const credit = await invoke<ListTransactionsResponse>({
      routeKey: 'GET /accounts/{accountId}/transactions',
      pathParameters: { accountId: FIXTURE_CREDIT_ID },
      query: JUNE,
    });
    expect(credit.body.items.map((t) => t.txnId)).toEqual([FIXTURE_TXN_CREDIT_GAS]);
  });

  it('filters: pendingOnly and q text search', async () => {
    const pending = await invoke<ListTransactionsResponse>({
      routeKey: 'GET /transactions',
      query: { ...JUNE, pendingOnly: 'true' },
    });
    expect(pending.body.items.map((t) => t.txnId)).toEqual([FIXTURE_TXN_COFFEE]);
    expect(pending.body.items[0]?.pending).toBe(true);

    const search = await invoke<ListTransactionsResponse>({
      routeKey: 'GET /transactions',
      query: { ...JUNE, q: 'whole foods' },
    });
    expect(search.body.items.map((t) => t.txnId)).toEqual([FIXTURE_TXN_GROCERIES]);
  });

  it('paginates via opaque cursors with no duplicates or omissions', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const { status, body } = await invoke<ListTransactionsResponse>({
        routeKey: 'GET /transactions',
        query: { ...JUNE, limit: '2', ...(cursor !== undefined ? { cursor } : {}) },
      });
      expect(status).toBe(200);
      seen.push(...body.items.map((t) => t.txnId));
      cursor = body.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 10);
    expect(pages).toBeLessThan(10);
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
  });

  it('rejects malformed cursors with 400 BAD_CURSOR', async () => {
    const { status, body } = await invoke<ErrorEnvelope>({
      routeKey: 'GET /transactions',
      query: { ...JUNE, cursor: '%%not-a-cursor%%' },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_CURSOR');
  });

  it('returns 401 UNAUTHORIZED when the household claim is absent', async () => {
    const res = await handler(makeAnonymousEvent('GET /accounts'));
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body ?? '{}') as ErrorEnvelope;
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('isolates tenancy: a different household claim sees nothing', async () => {
    const { status, body } = await invoke<ListAccountsResponse>({
      routeKey: 'GET /accounts',
      household: 'intruder-home',
    });
    expect(status).toBe(200);
    expect(body.items).toHaveLength(0);
  });
});

describe('user categorization through the api (GSI2 spend index)', () => {
  it('POST /categories creates the category at CATEGORY#<slug>', async () => {
    const { status, body } = await invoke<CategoryDto>({
      routeKey: 'POST /categories',
      body: { name: 'Coffee', type: 'EXPENSE' },
    });
    expect(status).toBe(201);
    expect(body.categoryId.length).toBeGreaterThan(0);
    coffeeCategoryId = body.categoryId;
    expect(
      table.getStored(PK, `${KEY_PREFIX.category}${coffeeCategoryId}`),
    ).toBeDefined();
  });

  it('PATCH /transactions/{txnId} categorizes the pending coffee row and sets GSI2 keys', async () => {
    const { status, body } = await invoke<PatchTransactionCategoryResponse>({
      routeKey: 'PATCH /transactions/{txnId}',
      pathParameters: { txnId: FIXTURE_TXN_COFFEE },
      body: {
        date: FIXTURE_DATES.coffeePending,
        categoryId: coffeeCategoryId,
        note: 'Morning espresso',
      },
    });
    expect(status).toBe(200);
    expect(body.item.categoryId).toBe(coffeeCategoryId);
    expect(body.item.userCategorized).toBe(true);
    expect(body.item.categorizedBy).toBe('user');
    coffeeVersionAfterPatch = body.item.version;

    const stored = table.getStored(
      PK,
      txnSk(FIXTURE_DATES.coffeePending, FIXTURE_TXN_COFFEE),
    ) as Partial<TransactionItem>;
    expect(stored.GSI2PK).toBe(gsi2Pk(HOUSEHOLD_ID, coffeeCategoryId));
    expect(stored.GSI2SK).toBe(
      gsi2Sk(FIXTURE_DATES.coffeePending, FIXTURE_TXN_COFFEE),
    );
    expect(stored.lastEditedBy).toBe(TEST_SUB_ALEX);
    expect(stored.note).toBe('Morning espresso');
  });

  it('PATCH against a wrong date (key miss) yields 404, stale version yields 409', async () => {
    const wrongDate = await invoke<ErrorEnvelope>({
      routeKey: 'PATCH /transactions/{txnId}',
      pathParameters: { txnId: FIXTURE_TXN_COFFEE },
      body: { date: '2026-06-01', categoryId: coffeeCategoryId },
    });
    expect(wrongDate.status).toBe(404);
    expect(wrongDate.body.error.code).toBe('NOT_FOUND');

    const stale = await invoke<ErrorEnvelope>({
      routeKey: 'PATCH /transactions/{txnId}',
      pathParameters: { txnId: FIXTURE_TXN_COFFEE },
      body: {
        date: FIXTURE_DATES.coffeePending,
        categoryId: coffeeCategoryId,
        version: 999,
      },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('PATCH with an unknown category is rejected (must exist at CATEGORY#)', async () => {
    const { status, body } = await invoke<ErrorEnvelope>({
      routeKey: 'PATCH /transactions/{txnId}',
      pathParameters: { txnId: FIXTURE_TXN_COFFEE },
      body: { date: FIXTURE_DATES.coffeePending, categoryId: 'no-such-category' },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('day two: posting keeps the transacted-date bucket, user edits intact', () => {
  it('keeps the coffee row in its transacted-date bucket when it posts (no re-key)', async () => {
    const result = await runSync(makeHouseholdPayloadDayTwo());
    expect(result.txnsUpserted).toBe(4);
    // The coffee txn carries transacted_at, so its SK bucket is the purchase
    // date and STAYS there when it posts -- no re-key, no stale delete. (Only a
    // txn lacking transacted_at shifts buckets pending->posted.)
    expect(result.staleDeletes).toBe(0);
    expect(result.unprocessedCount).toBe(0);

    // Exactly one row per SimpleFIN txn id - the dominant correctness invariant.
    expect(table.countByPrefix(PK, KEY_PREFIX.transaction)).toBe(4);
    // coffeePosted is the bank CLEARING date, not the SK bucket; the row stays
    // in the transacted-date (coffeePending) bucket.
    expect(
      table.getStored(PK, txnSk(FIXTURE_DATES.coffeePosted, FIXTURE_TXN_COFFEE)),
    ).toBeUndefined();
    const row = table.getStored(
      PK,
      txnSk(FIXTURE_DATES.coffeePending, FIXTURE_TXN_COFFEE),
    ) as Partial<TransactionItem>;
    expect(row).toBeDefined();

    // Bank-sourced fields refreshed in place (settled amount differs, posted).
    expect(row.amountMinor).toBe(-710);
    expect(row.pending).toBe(false);

    // User-owned fields merged through, version bumped past the PATCH value.
    expect(row.categoryId).toBe(coffeeCategoryId);
    expect(row.userCategorized).toBe(true);
    expect(row.note).toBe('Morning espresso');
    expect(row.version ?? 0).toBeGreaterThan(coffeeVersionAfterPatch);

    // GSI2SK stays at the transacted-date bucket (no re-key) via the builder.
    expect(row.GSI2PK).toBe(gsi2Pk(HOUSEHOLD_ID, coffeeCategoryId));
    expect(row.GSI2SK).toBe(gsi2Sk(FIXTURE_DATES.coffeePending, FIXTURE_TXN_COFFEE));

    // Pointer unchanged - the row never moved.
    const pointer = table.getStored(PK, txnPointerSk(FIXTURE_TXN_COFFEE)) as
      | TxnPointerItem
      | undefined;
    expect(pointer?.currentSk).toBe(
      txnSk(FIXTURE_DATES.coffeePending, FIXTURE_TXN_COFFEE),
    );
  });

  it('GET /transactions still lists exactly four unique transactions', async () => {
    const { body } = await invoke<ListTransactionsResponse>({
      routeKey: 'GET /transactions',
      query: JUNE,
    });
    expect(body.items).toHaveLength(4);
    expect(new Set(body.items.map((t) => t.txnId)).size).toBe(4);
    const coffee = body.items.find((t) => t.txnId === FIXTURE_TXN_COFFEE);
    expect(coffee).toMatchObject({
      // Stays in the transacted-date bucket after posting (no re-key).
      date: FIXTURE_DATES.coffeePending,
      amount: '-7.10',
      amountMinor: -710,
      categoryId: coffeeCategoryId,
      pending: false,
    });
  });

  it('GET /cashflow?month=2026-06 aggregates posted actuals with exact minor units', async () => {
    const { status, body } = await invoke<CashflowResponse>({
      routeKey: 'GET /cashflow',
      query: { month: '2026-06' },
    });
    expect(status).toBe(200);
    expect(body.months).toHaveLength(1);
    expect(body.months[0]?.month).toBe('2026-06');
    // income: paycheck 2500.00; expense: 42.15 + 7.10 + 38.40 = 87.65
    expect(body.totals.incomeMinor).toBe(250_000);
    expect(body.totals.expenseMinor).toBe(8_765);
    expect(body.totals.netMinor).toBe(241_235);
    expect(body.totals.net).toBe('2412.35');
  });
});

describe('budgets over the GSI2 spend index', () => {
  it('POST /budgets creates the budget with paired decimal/minor limits', async () => {
    const { status, body } = await invoke<BudgetDto>({
      routeKey: 'POST /budgets',
      body: { categoryId: coffeeCategoryId, limit: '50.00' },
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      categoryId: coffeeCategoryId,
      limit: '50.00',
      limitMinor: 5_000,
      version: 1,
    });
    expect(typeof body.spentMinor).toBe('number');
  });

  it('GET /budgets joins the category name onto the budget row', async () => {
    const { body } = await invoke<ListBudgetsResponse>({ routeKey: 'GET /budgets' });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      categoryId: coffeeCategoryId,
      categoryName: 'Coffee',
      limitMinor: 5_000,
    });
  });

  it('PATCH /budgets/{categoryId} enforces optimistic locking', async () => {
    const ok = await invoke<BudgetDto>({
      routeKey: 'PATCH /budgets/{categoryId}',
      pathParameters: { categoryId: coffeeCategoryId },
      body: { limit: '75.00', version: 1 },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.limitMinor).toBe(7_500);
    expect(ok.body.version).toBeGreaterThan(1);

    const conflict = await invoke<ErrorEnvelope>({
      routeKey: 'PATCH /budgets/{categoryId}',
      pathParameters: { categoryId: coffeeCategoryId },
      body: { limit: '80.00', version: 1 },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('DELETE /budgets/{categoryId} returns 204 then 404', async () => {
    const first = await handler(
      makeApiGatewayEvent({
        routeKey: 'DELETE /budgets/{categoryId}',
        pathParameters: { categoryId: coffeeCategoryId },
      }),
    );
    expect(first.statusCode).toBe(204);

    const second = await invoke<ErrorEnvelope>({
      routeKey: 'DELETE /budgets/{categoryId}',
      pathParameters: { categoryId: coffeeCategoryId },
    });
    expect(second.status).toBe(404);
    expect(second.body.error.code).toBe('NOT_FOUND');
  });
});
