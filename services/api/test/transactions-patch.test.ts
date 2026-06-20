import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type {
  CategoryItem,
  ErrorEnvelope,
  PatchTransactionCategoryResponse,
  TransactionItem,
} from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import {
  HOUSEHOLD,
  PK,
  SUB,
  makeCategoryItem,
  makeEvent,
  makeTxnItem,
  parseBody,
  setTestEnv,
} from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

const ROUTE = 'PATCH /transactions/{txnId}';
const TXN_SK = 'TXN#2026-05-10#txn-1';

function patchEvent(body: unknown) {
  return makeEvent({ routeKey: ROUTE, pathParameters: { txnId: 'txn-1' }, body });
}

/** PATCH now reads BOTH the category and the existing transaction up front. */
function mockGets(
  category: CategoryItem | undefined,
  categoryId: string,
  txn: TransactionItem | undefined,
): void {
  ddbMock
    .on(GetCommand, { Key: { PK, SK: `CATEGORY#${categoryId}` } })
    .resolves({ Item: category });
  ddbMock.on(GetCommand, { Key: { PK, SK: TXN_SK } }).resolves({ Item: txn });
}

function conditionFailure(withItem: boolean): ConditionalCheckFailedException {
  const err = new ConditionalCheckFailedException({
    message: 'The conditional request failed',
    $metadata: {},
  });
  if (withItem) {
    Object.assign(err, { Item: { PK: { S: PK }, SK: { S: TXN_SK } } });
  }
  return err;
}

describe('PATCH /transactions/{txnId}', () => {
  it('atomically rewrites categoryId + GSI2 keys and sets the override flags', async () => {
    mockGets(
      makeCategoryItem('groceries', 'EXPENSE'),
      'groceries',
      makeTxnItem({ SK: TXN_SK }),
    );
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeTxnItem({
        SK: TXN_SK,
        categoryId: 'groceries',
        userCategorized: true,
        categorizedBy: 'user',
        version: 2,
        GSI2PK: `USER#${HOUSEHOLD}#CAT#groceries`,
        GSI2SK: '2026-05-10#txn-1',
      }),
    });

    const res = await handler(
      patchEvent({ date: '2026-05-10', categoryId: 'groceries', note: 'Weekly Run' }),
    );
    expect(res.statusCode).toBe(200);

    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.Key).toEqual({ PK, SK: TXN_SK });
    expect(input.ConditionExpression).toBe('attribute_exists(PK)');
    expect(input.UpdateExpression).toContain('#gsi2pk = :gsi2pk');
    expect(input.UpdateExpression).toContain('#gsi2sk = :gsi2sk');
    expect(input.UpdateExpression).not.toContain('REMOVE');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':categoryId': 'groceries',
      ':gsi2pk': `USER#${HOUSEHOLD}#CAT#groceries`,
      ':gsi2sk': '2026-05-10#txn-1',
      ':true': true,
      ':user': 'user',
      ':sub': SUB,
      ':note': 'Weekly Run',
      ':noteLower': 'weekly run',
    });
    expect(input.UpdateExpression).toContain(
      '#version = if_not_exists(#version, :zero) + :one',
    );

    const body = parseBody<PatchTransactionCategoryResponse>(res);
    expect(body.item.categoryId).toBe('groceries');
    expect(body.item.userCategorized).toBe(true);
    expect(body.item.version).toBe(2);
  });

  it('REMOVEs the GSI2 keys when assigning a non-expense category (sparse spend index)', async () => {
    mockGets(
      makeCategoryItem('transfer', 'TRANSFER'),
      'transfer',
      makeTxnItem({ SK: TXN_SK }),
    );
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeTxnItem({ SK: TXN_SK, categoryId: 'transfer' }),
    });
    const res = await handler(patchEvent({ date: '2026-05-10', categoryId: 'transfer' }));
    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).toContain('REMOVE #gsi2pk, #gsi2sk');
    expect(input.ExpressionAttributeValues).not.toHaveProperty(':gsi2pk');
  });

  it('stamps isTransfer=true when a TRANSFER category is assigned to a non-transfer row', async () => {
    // The transfers-in-spend fix: a genuine transfer stored with isTransfer=false
    // (e.g. "Withdrawal to Savings") must become isTransfer=true once filed under
    // a TRANSFER category, so every spend consumer excludes it reliably.
    mockGets(
      makeCategoryItem('transfer', 'TRANSFER'),
      'transfer',
      makeTxnItem({ SK: TXN_SK, isTransfer: false }),
    );
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeTxnItem({ SK: TXN_SK, categoryId: 'transfer', isTransfer: true }),
    });
    const res = await handler(patchEvent({ date: '2026-05-10', categoryId: 'transfer' }));
    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).toContain('#isTransfer = :isTransfer');
    expect(input.ExpressionAttributeValues![':isTransfer']).toBe(true);
    expect(input.UpdateExpression).toContain('REMOVE #gsi2pk, #gsi2sk');
  });

  it('sets isTransfer=false when an EXPENSE category is assigned to a non-transfer row', async () => {
    mockGets(
      makeCategoryItem('groceries', 'EXPENSE'),
      'groceries',
      makeTxnItem({ SK: TXN_SK, isTransfer: false }),
    );
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeTxnItem({ SK: TXN_SK, categoryId: 'groceries' }),
    });
    const res = await handler(patchEvent({ date: '2026-05-10', categoryId: 'groceries' }));
    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.ExpressionAttributeValues![':isTransfer']).toBe(false);
    // Non-transfer EXPENSE -> still enters the spend index.
    expect(input.UpdateExpression).toContain('#gsi2pk = :gsi2pk');
  });

  it('REMOVEs the GSI2 keys when the transaction is a transfer even for an EXPENSE category', async () => {
    // The budget-inflation bug: a credit-card payment (isTransfer) PATCHed
    // into an EXPENSE category must NOT enter the GSI2 spend index.
    mockGets(
      makeCategoryItem('groceries', 'EXPENSE'),
      'groceries',
      makeTxnItem({ SK: TXN_SK, isTransfer: true }),
    );
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeTxnItem({
        SK: TXN_SK,
        categoryId: 'groceries',
        isTransfer: true,
        userCategorized: true,
      }),
    });
    const res = await handler(
      patchEvent({ date: '2026-05-10', categoryId: 'groceries' }),
    );
    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).toContain('REMOVE #gsi2pk, #gsi2sk');
    expect(input.UpdateExpression).not.toContain('#gsi2pk = :gsi2pk');
    expect(input.ExpressionAttributeValues).not.toHaveProperty(':gsi2pk');
    expect(input.ExpressionAttributeValues).not.toHaveProperty(':gsi2sk');
  });

  it('note-only edit: updates the note WITHOUT a category, leaving category/GSI2/userCategorized untouched', async () => {
    // The reported bug: adding a note to an UNcategorized transaction. No
    // categoryId is sent; the server must not require one, must not read the
    // category, and must not touch the spend index or the categorized flags.
    ddbMock.on(GetCommand, { Key: { PK, SK: TXN_SK } }).resolves({
      Item: makeTxnItem({ SK: TXN_SK, categoryId: null }),
    });
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeTxnItem({ SK: TXN_SK, categoryId: null, note: 'Reimbursable' }),
    });

    const res = await handler(
      patchEvent({ date: '2026-05-10', note: 'Reimbursable' }),
    );
    expect(res.statusCode).toBe(200);

    // No category GET was issued (note-only path).
    expect(
      ddbMock
        .commandCalls(GetCommand)
        .filter((c) => String(c.args[0].input.Key?.SK).startsWith('CATEGORY#')),
    ).toHaveLength(0);

    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).toContain('#note = :note');
    expect(input.UpdateExpression).not.toContain('#categoryId');
    expect(input.UpdateExpression).not.toContain('#userCategorized');
    expect(input.UpdateExpression).not.toContain('#gsi2pk');
    expect(input.UpdateExpression).not.toContain('REMOVE');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':note': 'Reimbursable',
      ':noteLower': 'reimbursable',
      ':sub': SUB,
    });
    expect(input.ExpressionAttributeValues).not.toHaveProperty(':categoryId');
    expect(input.ExpressionAttributeValues).not.toHaveProperty(':true');
  });

  it('note-only edit clears the note (empty string -> REMOVE note/noteLower)', async () => {
    ddbMock.on(GetCommand, { Key: { PK, SK: TXN_SK } }).resolves({
      Item: makeTxnItem({ SK: TXN_SK, note: 'old' }),
    });
    ddbMock.on(UpdateCommand).resolves({ Attributes: makeTxnItem({ SK: TXN_SK }) });

    const res = await handler(patchEvent({ date: '2026-05-10', note: '' }));
    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).toContain('REMOVE #note, #noteLower');
    expect(input.ExpressionAttributeValues).not.toHaveProperty(':note');
  });

  it('rejects an empty PATCH (neither categoryId nor note) with 400, no write', async () => {
    const res = await handler(patchEvent({ date: '2026-05-10' }));
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('category + note together still works (category path carries the note)', async () => {
    mockGets(makeCategoryItem('groceries', 'EXPENSE'), 'groceries', makeTxnItem({ SK: TXN_SK }));
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeTxnItem({ SK: TXN_SK, categoryId: 'groceries', note: 'Costco run' }),
    });
    const res = await handler(
      patchEvent({ date: '2026-05-10', categoryId: 'groceries', note: 'Costco run' }),
    );
    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).toContain('#categoryId = :categoryId');
    expect(input.UpdateExpression).toContain('#note = :note');
  });

  it('note-only edit returns 404 when the transaction does not exist (no write)', async () => {
    ddbMock.on(GetCommand, { Key: { PK, SK: TXN_SK } }).resolves({ Item: undefined });
    const res = await handler(patchEvent({ date: '2026-05-10', note: 'x' }));
    expect(res.statusCode).toBe(404);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('NOT_FOUND');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('note-only edit honors the optimistic lock (stale version -> 409, no write)', async () => {
    ddbMock.on(GetCommand, { Key: { PK, SK: TXN_SK } }).resolves({
      Item: makeTxnItem({ SK: TXN_SK, version: 5 }),
    });
    const res = await handler(patchEvent({ date: '2026-05-10', note: 'x', version: 3 }));
    expect(res.statusCode).toBe(409);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VERSION_CONFLICT');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('rejects an unknown category with 400 VALIDATION_ERROR before writing', async () => {
    mockGets(undefined, 'nope', makeTxnItem({ SK: TXN_SK }));
    const res = await handler(patchEvent({ date: '2026-05-10', categoryId: 'nope' }));
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('rejects a missing date with 400', async () => {
    const res = await handler(patchEvent({ categoryId: 'groceries' }));
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when the transaction does not exist (GetItem misses, no write)', async () => {
    mockGets(makeCategoryItem('groceries', 'EXPENSE'), 'groceries', undefined);
    const res = await handler(patchEvent({ date: '2026-05-10', categoryId: 'groceries' }));
    expect(res.statusCode).toBe(404);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('NOT_FOUND');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('returns 404 when the transaction vanishes between read and write (condition failed, no item)', async () => {
    mockGets(
      makeCategoryItem('groceries', 'EXPENSE'),
      'groceries',
      makeTxnItem({ SK: TXN_SK }),
    );
    ddbMock.on(UpdateCommand).rejects(conditionFailure(false));
    const res = await handler(patchEvent({ date: '2026-05-10', categoryId: 'groceries' }));
    expect(res.statusCode).toBe(404);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('NOT_FOUND');
  });

  it('returns 409 VERSION_CONFLICT from the read when the supplied version is stale (no write)', async () => {
    mockGets(
      makeCategoryItem('groceries', 'EXPENSE'),
      'groceries',
      makeTxnItem({ SK: TXN_SK, version: 5 }),
    );
    const res = await handler(
      patchEvent({ date: '2026-05-10', categoryId: 'groceries', version: 3 }),
    );
    expect(res.statusCode).toBe(409);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VERSION_CONFLICT');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('returns 409 VERSION_CONFLICT when a concurrent edit wins between read and write', async () => {
    mockGets(
      makeCategoryItem('groceries', 'EXPENSE'),
      'groceries',
      makeTxnItem({ SK: TXN_SK, version: 3 }),
    );
    ddbMock.on(UpdateCommand).rejects(conditionFailure(true));
    const res = await handler(
      patchEvent({ date: '2026-05-10', categoryId: 'groceries', version: 3 }),
    );
    expect(res.statusCode).toBe(409);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VERSION_CONFLICT');
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.ConditionExpression).toBe(
      'attribute_exists(PK) AND #version = :expectedVersion',
    );
  });
});
