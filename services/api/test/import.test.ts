import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { rowHash } from '@goldfinch/shared/csv';
import type { ErrorEnvelope, ImportTransactionsResponse } from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import {
  PK,
  SUB,
  makeAccountItem,
  makeCategoryItem,
  makeEvent,
  parseBody,
  setTestEnv,
} from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

const ROUTE = 'POST /import/transactions';
const IMPORT_ID = 'b3b1f7a2-import';

function importEvent(body: unknown) {
  return makeEvent({ routeKey: ROUTE, body });
}

function mockAccount(overrides: Record<string, unknown> = {}): void {
  ddbMock
    .on(GetCommand, { Key: { PK, SK: 'ACCT#acct-1' } })
    .resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1', ...overrides }) });
}

/** A TransactionCanceledException whose only failure is the pointer condition. */
function pointerExists(): Error {
  return Object.assign(new Error('Transaction cancelled'), {
    name: 'TransactionCanceledException',
    CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
  });
}

const ROW = { date: '2026-06-01', amount: '-42.15', payee: 'Whole Foods Market' };

describe('POST /import/transactions', () => {
  it('creates rows via pointer-conditional transactions with the synthetic txn id', async () => {
    mockAccount();
    ddbMock.on(TransactWriteCommand).resolves({});
    const res = await handler(
      importEvent({ importId: IMPORT_ID, accountId: 'acct-1', rows: [ROW] }),
    );
    expect(res.statusCode).toBe(200);
    expect(parseBody<ImportTransactionsResponse>(res)).toEqual({
      importId: IMPORT_ID,
      received: 1,
      created: 1,
      duplicates: 0,
    });

    const hash = rowHash({ date: ROW.date, amountMinor: -4215, payee: ROW.payee });
    const txnId = `import:${IMPORT_ID}:${hash}`;
    const tx = ddbMock.commandCalls(TransactWriteCommand)[0]!.args[0].input;
    const [pointerPut, txnPut] = tx.TransactItems!;
    const pointer = pointerPut!.Put!.Item as Record<string, unknown>;
    // TXNPTR#<txnId> IS the importTxnPointerSk — same machinery as sync.
    expect(pointer['SK']).toBe(`TXNPTR#${txnId}`);
    expect(pointer['entityType']).toBe('IMPORT_TXN_POINTER');
    expect(pointer['currentSk']).toBe(`TXN#2026-06-01#${txnId}`);
    expect(pointerPut!.Put!.ConditionExpression).toBe('attribute_not_exists(SK)');

    const txn = txnPut!.Put!.Item as Record<string, unknown>;
    expect(txn['SK']).toBe(`TXN#2026-06-01#${txnId}`);
    expect(txn['simplefinTxnId']).toBe(txnId);
    expect(txn['source']).toBe('import');
    expect(txn['importId']).toBe(IMPORT_ID);
    expect(txn['amountMinor']).toBe(-4215);
    expect(txn['payeeLower']).toBe('whole foods market');
    expect(txn['pending']).toBe(false);
    expect(txn['categoryId']).toBeNull();
    expect(txn['userCategorized']).toBe(false);
    expect(txn['lastEditedBy']).toBe(SUB);
    expect(txn['GSI1PK']).toBe(`${PK}#ACCT#acct-1`);
    expect(txn['GSI2PK']).toBeUndefined();
  });

  it('reports duplicates per row when the pointer already exists (idempotent retry)', async () => {
    mockAccount();
    let call = 0;
    ddbMock.on(TransactWriteCommand).callsFake(() => {
      call += 1;
      if (call === 1) throw pointerExists();
      return {};
    });
    const res = await handler(
      importEvent({
        importId: IMPORT_ID,
        accountId: 'acct-1',
        rows: [ROW, { ...ROW, amount: '-9.99' }],
      }),
    );
    const body = parseBody<ImportTransactionsResponse>(res);
    expect(body).toEqual({ importId: IMPORT_ID, received: 2, created: 1, duplicates: 1 });
  });

  it('gives identical rows distinct occurrence-based hashes (both created, none dropped)', async () => {
    mockAccount();
    ddbMock.on(TransactWriteCommand).resolves({});
    const res = await handler(
      importEvent({ importId: IMPORT_ID, accountId: 'acct-1', rows: [ROW, { ...ROW }] }),
    );
    expect(parseBody<ImportTransactionsResponse>(res).created).toBe(2);
    const calls = ddbMock.commandCalls(TransactWriteCommand);
    const skOf = (i: number) =>
      (calls[i]!.args[0].input.TransactItems![0]!.Put!.Item as Record<string, unknown>)['SK'];
    expect(skOf(0)).not.toBe(skOf(1));
  });

  it('rejects an explicit occurrence that disagrees with the request row order', async () => {
    mockAccount();
    const res = await handler(
      importEvent({
        importId: IMPORT_ID,
        accountId: 'acct-1',
        rows: [ROW, { ...ROW, occurrence: 0 }],
      }),
    );
    expect(res.statusCode).toBe(400);
    const body = parseBody<ErrorEnvelope>(res);
    expect(body.error.details).toEqual({ row: 1 });
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it('writes GSI2 keys and the user-categorized flags for category-mapped rows', async () => {
    mockAccount();
    ddbMock
      .on(GetCommand, { Key: { PK, SK: 'CATEGORY#groceries' } })
      .resolves({ Item: makeCategoryItem('groceries', 'EXPENSE') });
    ddbMock.on(TransactWriteCommand).resolves({});
    await handler(
      importEvent({
        importId: IMPORT_ID,
        accountId: 'acct-1',
        rows: [{ ...ROW, categoryId: 'groceries' }],
      }),
    );
    const tx = ddbMock.commandCalls(TransactWriteCommand)[0]!.args[0].input;
    const txn = tx.TransactItems![1]!.Put!.Item as Record<string, unknown>;
    expect(txn['categoryId']).toBe('groceries');
    expect(txn['userCategorized']).toBe(true);
    expect(txn['categorizedBy']).toBe('user');
    expect(txn['GSI2PK']).toBe(`${PK}#CAT#groceries`);
  });

  it('keeps INCOME-typed category rows out of the GSI2 spend index', async () => {
    mockAccount();
    ddbMock
      .on(GetCommand, { Key: { PK, SK: 'CATEGORY#salary' } })
      .resolves({ Item: makeCategoryItem('salary', 'INCOME') });
    ddbMock.on(TransactWriteCommand).resolves({});
    await handler(
      importEvent({
        importId: IMPORT_ID,
        accountId: 'acct-1',
        rows: [{ ...ROW, amount: '2500.00', categoryId: 'salary' }],
      }),
    );
    const tx = ddbMock.commandCalls(TransactWriteCommand)[0]!.args[0].input;
    const txn = tx.TransactItems![1]!.Put!.Item as Record<string, unknown>;
    expect(txn['GSI2PK']).toBeUndefined();
  });

  it('rejects unknown categories before writing anything', async () => {
    mockAccount();
    ddbMock.on(GetCommand, { Key: { PK, SK: 'CATEGORY#ghost' } }).resolves({ Item: undefined });
    const res = await handler(
      importEvent({
        importId: IMPORT_ID,
        accountId: 'acct-1',
        rows: [{ ...ROW, categoryId: 'ghost' }],
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it('bumps a manual account balance by the created delta only', async () => {
    mockAccount({ source: 'manual', simplefinAccountId: 'manual:acct-1' });
    let call = 0;
    ddbMock.on(TransactWriteCommand).callsFake(() => {
      call += 1;
      if (call === 2) throw pointerExists(); // second row is a duplicate
      return {};
    });
    ddbMock.on(UpdateCommand).resolves({});
    const res = await handler(
      importEvent({
        importId: IMPORT_ID,
        accountId: 'acct-1',
        rows: [ROW, { ...ROW, amount: '-10.00' }],
      }),
    );
    expect(res.statusCode).toBe(200);
    const update = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.Key).toEqual({ PK, SK: 'ACCT#acct-1' });
    expect(update.UpdateExpression).toContain('ADD #balanceMinor :delta');
    expect(update.ExpressionAttributeValues?.[':delta']).toBe(-4215);
  });

  it('never touches a SimpleFIN-synced account balance', async () => {
    mockAccount(); // default: no source attribute == 'simplefin'
    ddbMock.on(TransactWriteCommand).resolves({});
    await handler(importEvent({ importId: IMPORT_ID, accountId: 'acct-1', rows: [ROW] }));
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('404s for an unknown account', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(
      importEvent({ importId: IMPORT_ID, accountId: 'acct-1', rows: [ROW] }),
    );
    expect(res.statusCode).toBe(404);
  });

  it.each([
    [{ accountId: 'acct-1', rows: [ROW] }],
    [{ importId: 'has:colon', accountId: 'acct-1', rows: [ROW] }],
    [{ importId: 'has#hash', accountId: 'acct-1', rows: [ROW] }],
    [{ importId: IMPORT_ID, accountId: 'acct-1', rows: [] }],
    [{ importId: IMPORT_ID, accountId: 'acct-1', rows: 'nope' }],
  ])('rejects malformed batch envelopes with 400 (%#)', async (body) => {
    mockAccount();
    const res = await handler(importEvent(body));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it('rejects a batch over the row cap', async () => {
    mockAccount();
    const rows = Array.from({ length: 501 }, (_, i) => ({
      ...ROW,
      date: '2026-06-01',
      amount: `-${i + 1}.00`,
    }));
    const res = await handler(
      importEvent({ importId: IMPORT_ID, accountId: 'acct-1', rows }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.message).toContain('500');
  });

  it('rejects a bad row with its index and writes nothing', async () => {
    mockAccount();
    const res = await handler(
      importEvent({
        importId: IMPORT_ID,
        accountId: 'acct-1',
        rows: [ROW, { date: '06/01/2026', amount: '-1.00', payee: 'x' }],
      }),
    );
    expect(res.statusCode).toBe(400);
    const body = parseBody<ErrorEnvelope>(res);
    expect(body.error.details).toEqual({ row: 1 });
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it.each([
    [{ ...ROW, amount: 'lots' }],
    [{ ...ROW, payee: '   ' }],
    [{ ...ROW, occurrence: -1 }],
    [{ ...ROW, occurrence: 1.5 }],
    ['not-an-object'],
  ])('rejects invalid row shapes with 400 (%#)', async (row) => {
    mockAccount();
    const res = await handler(
      importEvent({ importId: IMPORT_ID, accountId: 'acct-1', rows: [row] }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.details).toEqual({ row: 0 });
  });
});
