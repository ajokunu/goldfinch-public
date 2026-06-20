/**
 * Server-side max-length validation for free-text fields (security hardening).
 *
 * Every free-text field a client can send is capped server-side from the shared
 * MAX_TEXT_LENGTHS contract: over the bound is a 400 VALIDATION_ERROR; exactly
 * at the bound is accepted. Exercised through the real handler so each route's
 * wiring is covered, not just the validator in isolation. The bounds are read
 * from the shared constant (never re-typed here) so a contract change can never
 * leave the test asserting a stale number.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { MAX_TEXT_LENGTHS } from '@goldfinch/shared/constants';
import type { ErrorEnvelope } from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import {
  PK,
  makeAccountItem,
  makeCategoryItem,
  makeEvent,
  makeRuleItem,
  makeTxnItem,
  parseBody,
  setTestEnv,
} from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

/** A string of exactly n single-byte characters. */
function chars(n: number): string {
  return 'a'.repeat(n);
}

function expectValidationError(res: { statusCode?: number; body?: string }): void {
  expect(res.statusCode).toBe(400);
  const body = parseBody<ErrorEnvelope>(res);
  expect(body.error.code).toBe('VALIDATION_ERROR');
}

describe('free-text max-length validation', () => {
  describe('POST /categories name (categoryName)', () => {
    const max = MAX_TEXT_LENGTHS.categoryName;

    it(`accepts a name at the ${max}-character limit (201)`, async () => {
      ddbMock.on(PutCommand).resolves({});
      const res = await handler(
        makeEvent({
          routeKey: 'POST /categories',
          body: { name: chars(max), type: 'EXPENSE' },
        }),
      );
      expect(res.statusCode).toBe(201);
    });

    it('rejects a name one character over the limit (400) before writing', async () => {
      const res = await handler(
        makeEvent({
          routeKey: 'POST /categories',
          body: { name: chars(max + 1), type: 'EXPENSE' },
        }),
      );
      expectValidationError(res);
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it('measures the TRIMMED name, so surrounding whitespace does not push it over', async () => {
      ddbMock.on(PutCommand).resolves({});
      const res = await handler(
        makeEvent({
          routeKey: 'POST /categories',
          body: { name: `   ${chars(max)}   `, type: 'EXPENSE' },
        }),
      );
      expect(res.statusCode).toBe(201);
    });
  });

  describe('PATCH /categories/{categoryId} name (categoryName)', () => {
    const max = MAX_TEXT_LENGTHS.categoryName;

    it(`accepts a name at the ${max}-character limit (200)`, async () => {
      ddbMock
        .on(UpdateCommand)
        .resolves({ Attributes: makeCategoryItem('groceries', 'EXPENSE', { name: chars(max) }) });
      const res = await handler(
        makeEvent({
          routeKey: 'PATCH /categories/{categoryId}',
          pathParameters: { categoryId: 'groceries' },
          body: { name: chars(max) },
        }),
      );
      expect(res.statusCode).toBe(200);
    });

    it('rejects a name over the limit (400) before writing', async () => {
      const res = await handler(
        makeEvent({
          routeKey: 'PATCH /categories/{categoryId}',
          pathParameters: { categoryId: 'groceries' },
          body: { name: chars(max + 1) },
        }),
      );
      expectValidationError(res);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });
  });

  describe('PATCH /transactions/{txnId} note (transactionNote)', () => {
    const max = MAX_TEXT_LENGTHS.transactionNote;
    const TXN_SK = 'TXN#2026-05-10#txn-1';

    function patchEvent(body: unknown) {
      return makeEvent({
        routeKey: 'PATCH /transactions/{txnId}',
        pathParameters: { txnId: 'txn-1' },
        body,
      });
    }

    function mockGets(): void {
      ddbMock
        .on(GetCommand, { Key: { PK, SK: 'CATEGORY#groceries' } })
        .resolves({ Item: makeCategoryItem('groceries', 'EXPENSE') });
      ddbMock.on(GetCommand, { Key: { PK, SK: TXN_SK } }).resolves({
        Item: makeTxnItem({ SK: TXN_SK }),
      });
    }

    it(`accepts a note at the ${max}-character limit (200)`, async () => {
      mockGets();
      ddbMock.on(UpdateCommand).resolves({
        Attributes: makeTxnItem({ SK: TXN_SK, categoryId: 'groceries', note: chars(max) }),
      });
      const res = await handler(
        patchEvent({ date: '2026-05-10', categoryId: 'groceries', note: chars(max) }),
      );
      expect(res.statusCode).toBe(200);
    });

    it('rejects a note over the limit (400) before any read or write', async () => {
      const res = await handler(
        patchEvent({ date: '2026-05-10', categoryId: 'groceries', note: chars(max + 1) }),
      );
      expectValidationError(res);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });
  });

  describe('POST /import/transactions payee + note', () => {
    const ROUTE = 'POST /import/transactions';
    const IMPORT_ID = 'len-import';

    function mockAccount(): void {
      ddbMock
        .on(GetCommand, { Key: { PK, SK: 'ACCT#acct-1' } })
        .resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    }

    function importEvent(rows: unknown[]) {
      return makeEvent({
        routeKey: ROUTE,
        body: { importId: IMPORT_ID, accountId: 'acct-1', rows },
      });
    }

    it(`accepts a payee at the ${MAX_TEXT_LENGTHS.importPayee}-character limit (200)`, async () => {
      mockAccount();
      ddbMock.on(TransactWriteCommand).resolves({});
      const res = await handler(
        importEvent([
          { date: '2026-06-01', amount: '-1.00', payee: chars(MAX_TEXT_LENGTHS.importPayee) },
        ]),
      );
      expect(res.statusCode).toBe(200);
    });

    it('rejects a payee over the limit with the offending row index (400)', async () => {
      mockAccount();
      const res = await handler(
        importEvent([
          { date: '2026-06-01', amount: '-1.00', payee: 'ok' },
          {
            date: '2026-06-01',
            amount: '-2.00',
            payee: chars(MAX_TEXT_LENGTHS.importPayee + 1),
          },
        ]),
      );
      expectValidationError(res);
      expect(parseBody<ErrorEnvelope>(res).error.details).toMatchObject({ row: 1 });
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });

    it(`accepts a note at the ${MAX_TEXT_LENGTHS.transactionNote}-character limit (200)`, async () => {
      mockAccount();
      ddbMock.on(TransactWriteCommand).resolves({});
      const res = await handler(
        importEvent([
          {
            date: '2026-06-01',
            amount: '-1.00',
            payee: 'Coffee',
            note: chars(MAX_TEXT_LENGTHS.transactionNote),
          },
        ]),
      );
      expect(res.statusCode).toBe(200);
    });

    it('rejects a note over the limit with the offending row index (400)', async () => {
      mockAccount();
      const res = await handler(
        importEvent([
          {
            date: '2026-06-01',
            amount: '-1.00',
            payee: 'Coffee',
            note: chars(MAX_TEXT_LENGTHS.transactionNote + 1),
          },
        ]),
      );
      expectValidationError(res);
      expect(parseBody<ErrorEnvelope>(res).error.details).toMatchObject({ row: 0 });
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    });
  });

  describe('POST /rules pattern (rulePattern)', () => {
    const max = MAX_TEXT_LENGTHS.rulePattern;

    function createEvent(body: unknown) {
      return makeEvent({ routeKey: 'POST /rules', body });
    }

    it(`accepts a pattern at the ${max}-character limit (201)`, async () => {
      ddbMock
        .on(GetCommand)
        .resolves({ Item: makeCategoryItem('groceries', 'EXPENSE') });
      ddbMock.on(PutCommand).resolves({});
      const res = await handler(
        createEvent({ matchType: 'contains', pattern: chars(max), categoryId: 'groceries' }),
      );
      expect(res.statusCode).toBe(201);
    });

    it('rejects a pattern over the limit (400) before writing', async () => {
      const res = await handler(
        createEvent({
          matchType: 'contains',
          pattern: chars(max + 1),
          categoryId: 'groceries',
        }),
      );
      expectValidationError(res);
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it('measures the TRIMMED pattern (the stored, normalized value)', async () => {
      ddbMock
        .on(GetCommand)
        .resolves({ Item: makeCategoryItem('groceries', 'EXPENSE') });
      ddbMock.on(PutCommand).resolves({});
      const res = await handler(
        createEvent({
          matchType: 'contains',
          pattern: `  ${chars(max)}  `,
          categoryId: 'groceries',
        }),
      );
      expect(res.statusCode).toBe(201);
    });
  });

  describe('PATCH /rules/{ruleId} pattern (rulePattern)', () => {
    const max = MAX_TEXT_LENGTHS.rulePattern;

    it('rejects a patched pattern over the limit (400)', async () => {
      ddbMock
        .on(GetCommand, { Key: { PK, SK: 'RULE#r-1' } })
        .resolves({ Item: makeRuleItem('r-1') });
      const res = await handler(
        makeEvent({
          routeKey: 'PATCH /rules/{ruleId}',
          pathParameters: { ruleId: 'r-1' },
          body: { version: 1, pattern: chars(max + 1) },
        }),
      );
      expectValidationError(res);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });
  });

  describe('POST /accounts name + institution', () => {
    function createEvent(body: Record<string, unknown>) {
      return makeEvent({
        routeKey: 'POST /accounts',
        body: { accountType: 'checking', currency: 'USD', ...body },
      });
    }

    it(`accepts a name at the ${MAX_TEXT_LENGTHS.accountName}-character limit (201)`, async () => {
      ddbMock.on(PutCommand).resolves({});
      const res = await handler(createEvent({ name: chars(MAX_TEXT_LENGTHS.accountName) }));
      expect(res.statusCode).toBe(201);
    });

    it('rejects a name over the limit (400) before writing', async () => {
      const res = await handler(createEvent({ name: chars(MAX_TEXT_LENGTHS.accountName + 1) }));
      expectValidationError(res);
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it('rejects an institution over the limit (400) before writing', async () => {
      const res = await handler(
        createEvent({
          name: 'Checking',
          institution: chars(MAX_TEXT_LENGTHS.accountInstitution + 1),
        }),
      );
      expectValidationError(res);
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it(`accepts an institution at the ${MAX_TEXT_LENGTHS.accountInstitution}-character limit (201)`, async () => {
      ddbMock.on(PutCommand).resolves({});
      const res = await handler(
        createEvent({
          name: 'Checking',
          institution: chars(MAX_TEXT_LENGTHS.accountInstitution),
        }),
      );
      expect(res.statusCode).toBe(201);
    });
  });
});
