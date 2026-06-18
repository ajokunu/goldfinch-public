/**
 * Self-tests for the in-memory table fake: a fake that silently diverges from
 * DynamoDB semantics would let the contract-drift suite pass on lies, so the
 * highest-risk behaviors (condition failures, limit-before-filter, pagination
 * keys, batch validation, sparse GSIs) are pinned here.
 */

import { describe, expect, it } from 'vitest';
import {
  BatchWriteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { userPk, txnSk, gsi1Pk, gsi1Sk } from '@goldfinch/shared/keys';
import { HOUSEHOLD_ID } from '@goldfinch/shared/constants';
import {
  FakeGoldFinchTable,
  makeAccountItem,
  makeCategoryItem,
  makeTransactionItem,
  TEST_TABLE_NAME,
} from '../src/index.js';

const PK = userPk(HOUSEHOLD_ID);

function freshTable(): FakeGoldFinchTable {
  return new FakeGoldFinchTable(TEST_TABLE_NAME);
}

describe('get / put / delete with conditions', () => {
  it('round-trips an item and clones on read', () => {
    const table = freshTable();
    const account = makeAccountItem();
    table.put({ TableName: TEST_TABLE_NAME, Item: { ...account } });
    const read = table.get({
      TableName: TEST_TABLE_NAME,
      Key: { PK: account.PK, SK: account.SK },
    });
    expect(read.Item).toEqual({ ...account });
    (read.Item as Record<string, unknown>)['name'] = 'mutated';
    expect(table.getStored(account.PK, account.SK)?.['name']).toBe(
      account.name,
    );
  });

  it('attribute_not_exists(SK) put fails on conflict with the DDB error name', () => {
    const table = freshTable();
    const category = makeCategoryItem();
    table.seed({ ...category });
    let caught: unknown;
    try {
      table.put({
        TableName: TEST_TABLE_NAME,
        Item: { ...category },
        ConditionExpression: 'attribute_not_exists(SK)',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('ConditionalCheckFailedException');
    // No ReturnValuesOnConditionCheckFailure -> no Item attached.
    expect((caught as { Item?: unknown }).Item).toBeUndefined();
  });

  it('attaches Item on condition failure only with ALL_OLD and an existing row', () => {
    const table = freshTable();
    const txn = makeTransactionItem({ version: 3 });
    table.seed({ ...txn });
    let caught: { Item?: unknown } | undefined;
    try {
      table.update({
        TableName: TEST_TABLE_NAME,
        Key: { PK: txn.PK, SK: txn.SK },
        UpdateExpression: 'SET #v = :v',
        ConditionExpression: 'attribute_exists(PK) AND #v = :expected',
        ExpressionAttributeNames: { '#v': 'version' },
        ExpressionAttributeValues: { ':v': 9, ':expected': 99 },
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      });
    } catch (err) {
      caught = err as { Item?: unknown };
    }
    expect(caught?.Item).toBeDefined();

    // Missing row: same condition, ALL_OLD, but no Item to attach (-> 404 path).
    let missing: { Item?: unknown } | undefined;
    try {
      table.update({
        TableName: TEST_TABLE_NAME,
        Key: { PK, SK: txnSk('2026-01-01', 'nope') },
        UpdateExpression: 'SET #v = :v',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#v': 'version' },
        ExpressionAttributeValues: { ':v': 1 },
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      });
    } catch (err) {
      missing = err as { Item?: unknown };
    }
    expect(missing).toBeDefined();
    expect(missing?.Item).toBeUndefined();
  });

  it('applies SET with if_not_exists arithmetic and REMOVE, returning ALL_NEW', () => {
    const table = freshTable();
    const txn = makeTransactionItem({ categoryId: 'groceries' });
    table.seed({ ...txn });
    const res = table.update({
      TableName: TEST_TABLE_NAME,
      Key: { PK: txn.PK, SK: txn.SK },
      UpdateExpression:
        'SET #version = if_not_exists(#version, :zero) + :one REMOVE #gsi2pk, #gsi2sk',
      ExpressionAttributeNames: {
        '#version': 'version',
        '#gsi2pk': 'GSI2PK',
        '#gsi2sk': 'GSI2SK',
      },
      ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
      ReturnValues: 'ALL_NEW',
    });
    expect(res.Attributes?.['version']).toBe(txn.version + 1);
    expect(res.Attributes).not.toHaveProperty('GSI2PK');
    expect(res.Attributes).not.toHaveProperty('GSI2SK');
  });

  it('delete with attribute_exists(PK) fails for a missing row', () => {
    const table = freshTable();
    expect(() =>
      table.delete({
        TableName: TEST_TABLE_NAME,
        Key: { PK, SK: 'BUDGET#nope' },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    ).toThrowError(expect.objectContaining({ name: 'ConditionalCheckFailedException' }));
  });

  it('rejects commands aimed at the wrong table name', () => {
    const table = freshTable();
    expect(() =>
      table.get({ TableName: 'SomeOtherTable', Key: { PK, SK: 'SYNC#STATE' } }),
    ).toThrowError(/SomeOtherTable/);
  });
});

describe('query semantics', () => {
  function seedTxns(table: FakeGoldFinchTable): void {
    table.seed(
      { ...makeTransactionItem({ txnId: 't1', date: '2026-06-01', payee: 'Alpha' }) },
      { ...makeTransactionItem({ txnId: 't2', date: '2026-06-02', payee: 'Beta' }) },
      { ...makeTransactionItem({ txnId: 't3', date: '2026-06-03', payee: 'Gamma' }) },
    );
  }

  it('BETWEEN on SK with ScanIndexForward=false returns newest first', () => {
    const table = freshTable();
    seedTxns(table);
    const res = table.query({
      TableName: TEST_TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': PK,
        ':start': 'TXN#2026-06-01',
        ':end': 'TXN#2026-06-03~',
      },
      ScanIndexForward: false,
    });
    expect(res.Items.map((item) => item['SK'])).toEqual([
      txnSk('2026-06-03', 't3'),
      txnSk('2026-06-02', 't2'),
      txnSk('2026-06-01', 't1'),
    ]);
  });

  it('applies Limit before FilterExpression and still reports LastEvaluatedKey', () => {
    const table = freshTable();
    seedTxns(table);
    // Filter matches only t3, but the 2-item scan window covers t1/t2 (asc).
    const res = table.query({
      TableName: TEST_TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: 'contains(#payeeLower, :q)',
      ExpressionAttributeNames: { '#payeeLower': 'payeeLower' },
      ExpressionAttributeValues: { ':pk': PK, ':prefix': 'TXN#', ':q': 'gamma' },
      Limit: 2,
    });
    expect(res.Items).toHaveLength(0);
    expect(res.ScannedCount).toBe(2);
    expect(res.LastEvaluatedKey).toBeDefined();
  });

  it('paginates with ExclusiveStartKey until LastEvaluatedKey is absent', () => {
    const table = freshTable();
    seedTxns(table);
    const collected: string[] = [];
    let esk: Record<string, unknown> | undefined;
    let pages = 0;
    do {
      const res = table.query({
        TableName: TEST_TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': PK, ':prefix': 'TXN#' },
        Limit: 2,
        ExclusiveStartKey: esk,
        ScanIndexForward: false,
      });
      collected.push(...res.Items.map((item) => String(item['SK'])));
      esk = res.LastEvaluatedKey;
      pages += 1;
    } while (esk !== undefined && pages < 10);
    expect(pages).toBeLessThan(10);
    expect(collected).toHaveLength(3);
    expect(new Set(collected).size).toBe(3);
  });

  it('GSI1 queries are sparse and keyed by the gsi1 builders', () => {
    const table = freshTable();
    seedTxns(table);
    // An item without GSI1 keys must be invisible to the index.
    table.seed({ PK, SK: 'TXN#2026-06-04#ghost', amountMinor: -1 });
    const res = table.query({
      TableName: TEST_TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': gsi1Pk(HOUSEHOLD_ID, 'acct-checking'),
        ':start': '2026-06-01',
        ':end': '2026-06-30~',
      },
    });
    expect(res.Items).toHaveLength(3);
    expect(res.Items[0]?.['GSI1SK']).toBe(gsi1Sk('2026-06-01', 't1'));
  });

  it('rejects a key condition whose attributes do not match the target index', () => {
    const table = freshTable();
    expect(() =>
      table.query({
        TableName: TEST_TABLE_NAME,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'whatever' },
      }),
    ).toThrowError(/GSI1PK/);
  });
});

describe('batch write and command dispatch', () => {
  it('applies puts and deletes via the send() command interface', async () => {
    const table = freshTable();
    const txn = makeTransactionItem({ txnId: 'b1', date: '2026-06-01' });
    await table.send(
      new BatchWriteCommand({
        RequestItems: {
          [TEST_TABLE_NAME]: [{ PutRequest: { Item: { ...txn } } }],
        },
      }),
    );
    const res = (await table.send(
      new QueryCommand({
        TableName: TEST_TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: { ':pk': PK, ':sk': txn.SK },
      }),
    )) as { Items: unknown[] };
    expect(res.Items).toHaveLength(1);
    await table.send(
      new BatchWriteCommand({
        RequestItems: {
          [TEST_TABLE_NAME]: [
            { DeleteRequest: { Key: { PK, SK: txn.SK } } },
          ],
        },
      }),
    );
    expect(table.getStored(PK, txn.SK)).toBeUndefined();
  });

  it('rejects two operations on one key in a single batch (DDB rule)', () => {
    const table = freshTable();
    const txn = makeTransactionItem({ txnId: 'dup', date: '2026-06-01' });
    expect(() =>
      table.batchWrite({
        RequestItems: {
          [TEST_TABLE_NAME]: [
            { PutRequest: { Item: { ...txn } } },
            { DeleteRequest: { Key: { PK: txn.PK, SK: txn.SK } } },
          ],
        },
      }),
    ).toThrowError(/two operations/);
  });

  it('rejects oversized batches', () => {
    const table = freshTable();
    const requests = Array.from({ length: 26 }, (_, i) => ({
      PutRequest: {
        Item: { ...makeTransactionItem({ txnId: `t${i}`, date: '2026-06-01' }) },
      },
    }));
    expect(() =>
      table.batchWrite({ RequestItems: { [TEST_TABLE_NAME]: requests } }),
    ).toThrowError(/1-25/);
  });

  it('isolates partitions (tenancy boundary)', () => {
    const table = freshTable();
    table.seed({ ...makeAccountItem() });
    const res = table.query({
      TableName: TEST_TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': userPk('other-household'),
        ':prefix': 'ACCT#',
      },
    });
    expect(res.Items).toHaveLength(0);
  });
});
