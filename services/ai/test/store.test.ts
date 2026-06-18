/**
 * Store tests for applyCategory: the sparse-GSI2 spend-index rule must come
 * from the shared computeGsi2Keys helper — in particular, transfers never get
 * GSI2 keys even when assigned an EXPENSE category.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DynamoDBDocumentClient, UpdateCommandInput } from '@aws-sdk/lib-dynamodb';

import { createStore } from '../src/store.js';
import type { ApplyCategoryInput } from '../src/store.js';

const HOUSEHOLD = 'goldfinch-home';
const TXN_SK = 'TXN#2026-05-10#txn-1' as const;

function fakeClient(
  captured: UpdateCommandInput[],
  failWith?: Error,
): DynamoDBDocumentClient {
  return {
    send: async (command: { input: UpdateCommandInput }) => {
      captured.push(command.input);
      if (failWith !== undefined) {
        throw failWith;
      }
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
}

function baseInput(overrides: Partial<ApplyCategoryInput>): ApplyCategoryInput {
  return {
    txnSk: TXN_SK,
    categoryId: 'groceries',
    source: 'rule',
    categoryType: 'EXPENSE',
    isTransfer: false,
    now: '2026-05-11T00:00:00Z',
    ...overrides,
  };
}

describe('applyCategory GSI2 spend-index keys (shared computeGsi2Keys rule)', () => {
  it('sets GSI2 keys for a non-transfer EXPENSE assignment', async () => {
    const captured: UpdateCommandInput[] = [];
    const store = createStore({
      tableName: 'GoldFinch',
      household: HOUSEHOLD,
      client: fakeClient(captured),
    });
    const applied = await store.applyCategory(baseInput({}));
    assert.equal(applied, true);
    const input = captured[0]!;
    assert.ok(input.UpdateExpression!.includes('GSI2PK = :gsi2pk'));
    assert.ok(input.UpdateExpression!.includes('GSI2SK = :gsi2sk'));
    assert.equal(
      input.ExpressionAttributeValues![':gsi2pk'],
      `USER#${HOUSEHOLD}#CAT#groceries`,
    );
    assert.equal(input.ExpressionAttributeValues![':gsi2sk'], '2026-05-10#txn-1');
  });

  it('never sets GSI2 keys for a transfer, even with an EXPENSE category', async () => {
    // The budget-inflation case: a credit-card payment must not enter the
    // spend index regardless of the category it is filed under.
    const captured: UpdateCommandInput[] = [];
    const store = createStore({
      tableName: 'GoldFinch',
      household: HOUSEHOLD,
      client: fakeClient(captured),
    });
    const applied = await store.applyCategory(baseInput({ isTransfer: true }));
    assert.equal(applied, true);
    const input = captured[0]!;
    assert.equal(input.UpdateExpression!.includes('GSI2PK'), false);
    assert.equal(input.UpdateExpression!.includes('GSI2SK'), false);
    assert.equal(':gsi2pk' in input.ExpressionAttributeValues!, false);
    assert.equal(':gsi2sk' in input.ExpressionAttributeValues!, false);
  });

  it('never sets GSI2 keys for INCOME or TRANSFER categories', async () => {
    for (const categoryType of ['INCOME', 'TRANSFER'] as const) {
      const captured: UpdateCommandInput[] = [];
      const store = createStore({
        tableName: 'GoldFinch',
        household: HOUSEHOLD,
        client: fakeClient(captured),
      });
      await store.applyCategory(baseInput({ categoryType, categoryId: 'paycheck' }));
      assert.equal(captured[0]!.UpdateExpression!.includes('GSI2PK'), false);
    }
  });

  it('returns false when the conditional write is refused (user got there first)', async () => {
    const refusal = Object.assign(new Error('The conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    });
    const store = createStore({
      tableName: 'GoldFinch',
      household: HOUSEHOLD,
      client: fakeClient([], refusal),
    });
    assert.equal(await store.applyCategory(baseInput({})), false);
  });
});
