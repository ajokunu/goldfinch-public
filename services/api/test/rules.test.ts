import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  ApplyRuleResponse,
  ErrorEnvelope,
  ListRulesResponse,
  RuleResponse,
} from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import {
  PK,
  conditionFailure,
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

describe('GET /rules', () => {
  it('lists rules in evaluation order and excludes legacy CATEGORY_RULE items', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        makeRuleItem('r-contains', { matchType: 'contains', priority: 1 }),
        makeRuleItem('r-exact', { matchType: 'exact', priority: 100 }),
        // Legacy services/ai item sharing the RULE# namespace.
        {
          PK,
          SK: 'RULE#EXACT#WHOLE FOODS',
          entityType: 'CATEGORY_RULE',
          pattern: 'WHOLE FOODS',
        },
      ],
    });
    const res = await handler(makeEvent({ routeKey: 'GET /rules' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody<ListRulesResponse>(res);
    // exact beats contains regardless of priority values.
    expect(body.items.map((r) => r.ruleId)).toEqual(['r-exact', 'r-contains']);
  });
});

describe('POST /rules', () => {
  function createEvent(body: unknown) {
    return makeEvent({ routeKey: 'POST /rules', body });
  }

  it('creates a rule with a lowercased pattern, parsed bounds, and defaults', async () => {
    ddbMock
      .on(GetCommand)
      .resolves({ Item: makeCategoryItem('groceries', 'EXPENSE') });
    ddbMock.on(PutCommand).resolves({});
    const res = await handler(
      createEvent({
        matchType: 'contains',
        pattern: '  Whole FOODS  ',
        categoryId: 'groceries',
        amountMin: '10.00',
        amountMax: '200.00',
      }),
    );
    expect(res.statusCode).toBe(201);
    const body = parseBody<RuleResponse>(res);
    expect(body.pattern).toBe('whole foods');
    expect(body.amountMinMinor).toBe(1000);
    expect(body.amountMaxMinor).toBe(20000);
    expect(body.priority).toBe(100);
    expect(body.enabled).toBe(true);
    expect(body.version).toBe(1);
    const put = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put.ConditionExpression).toBe('attribute_not_exists(SK)');
    expect((put.Item as Record<string, unknown>)['SK']).toBe(`RULE#${body.ruleId}`);
  });

  it.each([
    [{ matchType: 'regex', pattern: 'x', categoryId: 'groceries' }],
    [{ matchType: 'exact', pattern: '   ', categoryId: 'groceries' }],
    [{ matchType: 'exact', pattern: 'x', categoryId: 'groceries', amountMin: '-1.00' }],
    [
      {
        matchType: 'exact',
        pattern: 'x',
        categoryId: 'groceries',
        amountMin: '20.00',
        amountMax: '10.00',
      },
    ],
  ])('rejects invalid rule bodies with 400 (%#)', async (body) => {
    ddbMock.on(GetCommand).resolves({ Item: makeCategoryItem('groceries', 'EXPENSE') });
    const res = await handler(createEvent(body));
    expect(res.statusCode).toBe(400);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('rejects an unknown or archived category with 400', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(
      createEvent({ matchType: 'exact', pattern: 'x', categoryId: 'ghost' }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.message).toContain('ghost');
  });
});

describe('PATCH /rules/{ruleId}', () => {
  function patchEvent(body: unknown) {
    return makeEvent({
      routeKey: 'PATCH /rules/{ruleId}',
      pathParameters: { ruleId: 'r-1' },
      body,
    });
  }

  it('updates fields and bumps the version', async () => {
    ddbMock
      .on(GetCommand, { Key: { PK, SK: 'RULE#r-1' } })
      .resolves({ Item: makeRuleItem('r-1') });
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeRuleItem('r-1', { pattern: 'trader joes', version: 2 }),
    });
    const res = await handler(patchEvent({ pattern: 'Trader Joes', version: 1 }));
    expect(res.statusCode).toBe(200);
    expect(parseBody<RuleResponse>(res).version).toBe(2);
    const update = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.ExpressionAttributeValues?.[':pattern']).toBe('trader joes');
  });

  it('clears a bound with an explicit null', async () => {
    ddbMock
      .on(GetCommand, { Key: { PK, SK: 'RULE#r-1' } })
      .resolves({ Item: makeRuleItem('r-1', { amountMinMinor: 1000 }) });
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeRuleItem('r-1', { amountMinMinor: null, version: 2 }),
    });
    const res = await handler(patchEvent({ amountMin: null, version: 1 }));
    expect(res.statusCode).toBe(200);
    const update = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.ExpressionAttributeValues?.[':amountMinMinor']).toBeNull();
  });

  it('validates the post-patch bound pairing against stored values', async () => {
    ddbMock
      .on(GetCommand, { Key: { PK, SK: 'RULE#r-1' } })
      .resolves({ Item: makeRuleItem('r-1', { amountMaxMinor: 500 }) });
    const res = await handler(patchEvent({ amountMin: '10.00', version: 1 }));
    expect(res.statusCode).toBe(400);
  });

  it('409s on version conflict and 404s when absent', async () => {
    ddbMock
      .on(GetCommand, { Key: { PK, SK: 'RULE#r-1' } })
      .resolves({ Item: makeRuleItem('r-1', { version: 3 }) });
    ddbMock.on(UpdateCommand).rejects(conditionFailure(true));
    expect((await handler(patchEvent({ enabled: false, version: 1 }))).statusCode).toBe(409);

    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect((await handler(patchEvent({ enabled: false, version: 1 }))).statusCode).toBe(404);
  });

  it('404s for a legacy CATEGORY_RULE item (never patches it)', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { PK, SK: 'RULE#r-1', entityType: 'CATEGORY_RULE' },
    });
    const res = await handler(patchEvent({ enabled: false, version: 1 }));
    expect(res.statusCode).toBe(404);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});

describe('DELETE /rules/{ruleId}', () => {
  it('204s on success, 404s when absent', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    const ok = await handler(
      makeEvent({ routeKey: 'DELETE /rules/{ruleId}', pathParameters: { ruleId: 'r-1' } }),
    );
    expect(ok.statusCode).toBe(204);

    ddbMock.on(DeleteCommand).rejects(conditionFailure(false));
    const missing = await handler(
      makeEvent({ routeKey: 'DELETE /rules/{ruleId}', pathParameters: { ruleId: 'r-1' } }),
    );
    expect(missing.statusCode).toBe(404);
  });
});

describe('POST /rules/{ruleId}/apply', () => {
  const ROUTE = 'POST /rules/{ruleId}/apply';

  function applyEvent(body?: unknown) {
    return makeEvent({ routeKey: ROUTE, pathParameters: { ruleId: 'r-1' }, body });
  }

  function mockRuleAndCategory(rule = makeRuleItem('r-1')): void {
    ddbMock.on(GetCommand, { Key: { PK, SK: 'RULE#r-1' } }).resolves({ Item: rule });
    ddbMock
      .on(GetCommand, { Key: { PK, SK: `CATEGORY#${rule.categoryId}` } })
      .resolves({ Item: makeCategoryItem(rule.categoryId, 'EXPENSE') });
  }

  it('recategorizes matching uncategorized rows, rewriting GSI2 via the shared rule', async () => {
    mockRuleAndCategory();
    ddbMock.on(QueryCommand).resolves({
      Items: [
        makeTxnItem({ SK: 'TXN#2026-06-01#t-match', payeeLower: 'whole foods #123' }),
        makeTxnItem({ SK: 'TXN#2026-06-02#t-nomatch', payeeLower: 'shell gas' }),
        makeTxnItem({
          SK: 'TXN#2026-06-03#t-categorized',
          payeeLower: 'whole foods',
          categoryId: 'dining',
        }),
        makeTxnItem({
          SK: 'TXN#2026-06-04#t-user',
          payeeLower: 'whole foods',
          userCategorized: true,
        }),
      ],
    });
    ddbMock.on(UpdateCommand).resolves({});

    const res = await handler(applyEvent({ from: '2026-06-01', to: '2026-06-30' }));
    expect(res.statusCode).toBe(200);
    expect(parseBody<ApplyRuleResponse>(res)).toEqual({
      ruleId: 'r-1',
      matchedCount: 1,
      updatedCount: 1,
    });

    const update = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.Key).toEqual({ PK, SK: 'TXN#2026-06-01#t-match' });
    expect(update.ExpressionAttributeValues?.[':categoryId']).toBe('groceries');
    expect(update.ExpressionAttributeValues?.[':rule']).toBe('rule');
    // Sparse GSI2: a non-transfer EXPENSE categorization SETs the keys.
    expect(update.ExpressionAttributeValues?.[':gsi2pk']).toBe(`${PK}#CAT#groceries`);
    expect(update.ExpressionAttributeValues?.[':gsi2sk']).toBe('2026-06-01#t-match');
    // userCategorized is guarded, never set by a rule.
    expect(update.UpdateExpression).not.toContain('#userCategorized =');
    expect(update.ConditionExpression).toContain('#categoryId = :null');
  });

  it('respects amount bounds (inclusive, on the magnitude)', async () => {
    mockRuleAndCategory(
      makeRuleItem('r-1', { amountMinMinor: 5000, amountMaxMinor: 6000 }),
    );
    ddbMock.on(QueryCommand).resolves({
      Items: [
        makeTxnItem({ SK: 'TXN#2026-06-01#t-in', payeeLower: 'whole foods', amountMinor: -5000 }),
        makeTxnItem({ SK: 'TXN#2026-06-02#t-out', payeeLower: 'whole foods', amountMinor: -4999 }),
      ],
    });
    ddbMock.on(UpdateCommand).resolves({});
    const body = parseBody<ApplyRuleResponse>(
      await handler(applyEvent({ from: '2026-06-01', to: '2026-06-30' })),
    );
    expect(body.matchedCount).toBe(1);
    expect(body.updatedCount).toBe(1);
  });

  it('counts (not stomps) rows that changed concurrently', async () => {
    mockRuleAndCategory();
    ddbMock.on(QueryCommand).resolves({
      Items: [makeTxnItem({ SK: 'TXN#2026-06-01#t-1', payeeLower: 'whole foods' })],
    });
    ddbMock.on(UpdateCommand).rejects(conditionFailure(true));
    const body = parseBody<ApplyRuleResponse>(
      await handler(applyEvent({ from: '2026-06-01', to: '2026-06-30' })),
    );
    expect(body).toEqual({ ruleId: 'r-1', matchedCount: 1, updatedCount: 0 });
  });

  it('works with no body (default retroactive window)', async () => {
    mockRuleAndCategory();
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(applyEvent());
    expect(res.statusCode).toBe(200);
    expect(parseBody<ApplyRuleResponse>(res).matchedCount).toBe(0);
  });

  it('404s for an unknown rule and 400s for a disabled one', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect((await handler(applyEvent())).statusCode).toBe(404);

    ddbMock.reset();
    setTestEnv();
    mockRuleAndCategory(makeRuleItem('r-1', { enabled: false }));
    const res = await handler(applyEvent());
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.message).toContain('disabled');
  });

  it('rejects from after to with 400', async () => {
    mockRuleAndCategory();
    const res = await handler(applyEvent({ from: '2026-06-30', to: '2026-06-01' }));
    expect(res.statusCode).toBe(400);
  });
});
