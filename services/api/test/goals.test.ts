import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  CreateGoalContributionResponse,
  ErrorEnvelope,
  GoalResponse,
  ListGoalsResponse,
} from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import {
  PK,
  SUB,
  conditionFailure,
  makeAccountItem,
  makeContributionItem,
  makeEvent,
  makeGoalItem,
  parseBody,
  setTestEnv,
} from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

describe('GET /goals', () => {
  it('computes manual progress from contributions and linked progress from the account', async () => {
    ddbMock.on(QueryCommand).callsFake((input: Record<string, unknown>) => {
      const values = input['ExpressionAttributeValues'] as Record<string, unknown>;
      if (values[':prefix'] === 'GOAL#') {
        return {
          Items: [
            makeGoalItem('g-manual'),
            makeGoalItem('g-linked', {
              fundingMode: 'linked-account',
              linkedAccountId: 'acct-1',
              targetMinor: 2_000_000,
            }),
          ],
        };
      }
      if (values[':prefix'] === 'CONTRIB#g-manual#') {
        return {
          Items: [
            makeContributionItem('g-manual', '2026-02-01T00:00:00.000Z', 250_000),
            makeContributionItem('g-manual', '2026-03-01T00:00:00.000Z', -50_000),
          ],
        };
      }
      return { Items: [] };
    });
    ddbMock
      .on(GetCommand, { Key: { PK, SK: 'ACCT#acct-1' } })
      .resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1', balanceMinor: 523_055 }) });

    const res = await handler(makeEvent({ routeKey: 'GET /goals' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody<ListGoalsResponse>(res);
    const manual = body.items.find((g) => g.goalId === 'g-manual')!;
    expect(manual.progressMinor).toBe(200_000);
    expect(manual.progress).toBe('2000.00');
    expect(manual.percentComplete).toBe(20);
    const linked = body.items.find((g) => g.goalId === 'g-linked')!;
    expect(linked.progressMinor).toBe(523_055);
    expect(linked.percentComplete).toBe(26);
  });

  it('reads a linked goal whose account disappeared as 0 progress (never a crash)', async () => {
    ddbMock.on(QueryCommand).callsFake((input: Record<string, unknown>) => {
      const values = input['ExpressionAttributeValues'] as Record<string, unknown>;
      return values[':prefix'] === 'GOAL#'
        ? {
            Items: [
              makeGoalItem('g-1', { fundingMode: 'linked-account', linkedAccountId: 'gone' }),
            ],
          }
        : { Items: [] };
    });
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const body = parseBody<ListGoalsResponse>(
      await handler(makeEvent({ routeKey: 'GET /goals' })),
    );
    expect(body.items[0]!.progressMinor).toBe(0);
  });
});

describe('POST /goals', () => {
  it('creates a manual goal with version 1 and zero progress', async () => {
    ddbMock.on(PutCommand).resolves({});
    const res = await handler(
      makeEvent({
        routeKey: 'POST /goals',
        body: { name: 'New car', target: '15000.00', fundingMode: 'manual' },
      }),
    );
    expect(res.statusCode).toBe(201);
    const body = parseBody<GoalResponse>(res);
    expect(body.targetMinor).toBe(1_500_000);
    expect(body.progressMinor).toBe(0);
    expect(body.version).toBe(1);
    const put = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put.ConditionExpression).toBe('attribute_not_exists(SK)');
    expect((put.Item as Record<string, unknown>)['fundingMode']).toBe('manual');
  });

  it('creates a linked-account goal, inheriting the account currency and balance progress', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: makeAccountItem({ SK: 'ACCT#acct-1', balanceMinor: 80_000, currency: 'USD' }),
    });
    ddbMock.on(PutCommand).resolves({});
    const res = await handler(
      makeEvent({
        routeKey: 'POST /goals',
        body: {
          name: 'House',
          target: '100000.00',
          fundingMode: 'linked-account',
          linkedAccountId: 'acct-1',
        },
      }),
    );
    expect(res.statusCode).toBe(201);
    const body = parseBody<GoalResponse>(res);
    expect(body.progressMinor).toBe(80_000);
    expect(body.percentComplete).toBe(0);
    expect(body.linkedAccountId).toBe('acct-1');
  });

  it.each([
    [{ name: 'x', target: '10.00', fundingMode: 'weird' }, 'fundingMode'],
    [{ name: 'x', target: '10.00', fundingMode: 'linked-account' }, 'linkedAccountId'],
    [{ name: 'x', target: '0.00', fundingMode: 'manual' }, 'target'],
    [{ name: 'x', target: '-5.00', fundingMode: 'manual' }, 'target'],
    [{ name: 'x', target: '10.00', fundingMode: 'manual', linkedAccountId: 'a' }, 'linkedAccountId'],
  ])('rejects invalid create bodies with 400 (%#)', async (body) => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(makeEvent({ routeKey: 'POST /goals', body }));
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('rejects a linked account that does not exist', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(
      makeEvent({
        routeKey: 'POST /goals',
        body: {
          name: 'x',
          target: '10.00',
          fundingMode: 'linked-account',
          linkedAccountId: 'ghost',
        },
      }),
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /goals/{goalId}', () => {
  function patchEvent(body: unknown) {
    return makeEvent({
      routeKey: 'PATCH /goals/{goalId}',
      pathParameters: { goalId: 'g-1' },
      body,
    });
  }

  it('updates with optimistic locking and returns refreshed progress', async () => {
    ddbMock
      .on(GetCommand, { Key: { PK, SK: 'GOAL#g-1' } })
      .resolves({ Item: makeGoalItem('g-1') });
    ddbMock.on(QueryCommand).resolves({
      Items: [makeContributionItem('g-1', '2026-02-01T00:00:00.000Z', 100_000)],
    });
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeGoalItem('g-1', { name: 'Renamed', version: 2 }),
    });
    const res = await handler(patchEvent({ name: 'Renamed', version: 1 }));
    expect(res.statusCode).toBe(200);
    const body = parseBody<GoalResponse>(res);
    expect(body.name).toBe('Renamed');
    expect(body.version).toBe(2);
    expect(body.progressMinor).toBe(100_000);
    const update = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.ConditionExpression).toContain('#version = :version');
  });

  it('409s on a version conflict', async () => {
    ddbMock
      .on(GetCommand, { Key: { PK, SK: 'GOAL#g-1' } })
      .resolves({ Item: makeGoalItem('g-1', { version: 5 }) });
    ddbMock.on(UpdateCommand).rejects(conditionFailure(true));
    const res = await handler(patchEvent({ name: 'x', version: 1 }));
    expect(res.statusCode).toBe(409);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VERSION_CONFLICT');
  });

  it('404s for a goal that does not exist', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(patchEvent({ name: 'x', version: 1 }));
    expect(res.statusCode).toBe(404);
  });

  it('rejects switching to linked-account without a linkedAccountId', async () => {
    ddbMock
      .on(GetCommand, { Key: { PK, SK: 'GOAL#g-1' } })
      .resolves({ Item: makeGoalItem('g-1') });
    const res = await handler(patchEvent({ fundingMode: 'linked-account', version: 1 }));
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /goals/{goalId}', () => {
  function deleteEvent() {
    return makeEvent({
      routeKey: 'DELETE /goals/{goalId}',
      pathParameters: { goalId: 'g-1' },
    });
  }

  it('deletes the goal and its contribution items, then 204s', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({
      Items: [
        makeContributionItem('g-1', '2026-02-01T00:00:00.000Z', 1),
        makeContributionItem('g-1', '2026-03-01T00:00:00.000Z', 2),
      ],
    });
    ddbMock.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });
    const res = await handler(deleteEvent());
    expect(res.statusCode).toBe(204);
    const batch = ddbMock.commandCalls(BatchWriteCommand)[0]!.args[0].input;
    expect(batch.RequestItems!['GoldFinch']).toHaveLength(2);
  });

  it('404s when the goal does not exist', async () => {
    ddbMock.on(DeleteCommand).rejects(conditionFailure(false));
    const res = await handler(deleteEvent());
    expect(res.statusCode).toBe(404);
    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(0);
  });

  it('fails loudly (500) when contribution deletes stay unprocessed past the retry budget', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    const key = { PK, SK: 'CONTRIB#g-1#2026-02-01T00:00:00.000Z' };
    ddbMock.on(QueryCommand).resolves({
      Items: [makeContributionItem('g-1', '2026-02-01T00:00:00.000Z', 1)],
    });
    ddbMock.on(BatchWriteCommand).resolves({
      UnprocessedItems: { GoldFinch: [{ DeleteRequest: { Key: key } }] },
    });
    const res = await handler(deleteEvent());
    expect(res.statusCode).toBe(500);
  });
});

describe('POST /goals/{goalId}/contributions', () => {
  function contribEvent(body: unknown) {
    return makeEvent({
      routeKey: 'POST /goals/{goalId}/contributions',
      pathParameters: { goalId: 'g-1' },
      body,
    });
  }

  it('writes the contribution, stamps the contributor, and returns refreshed progress', async () => {
    ddbMock
      .on(GetCommand, { Key: { PK, SK: 'GOAL#g-1' } })
      .resolves({ Item: makeGoalItem('g-1') });
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({
      Items: [makeContributionItem('g-1', '2026-02-01T00:00:00.000Z', 50_000)],
    });
    const res = await handler(
      makeEvent({
        routeKey: 'POST /goals/{goalId}/contributions',
        pathParameters: { goalId: 'g-1' },
        body: { amount: '500.00', contributedAt: '2026-02-01T00:00:00.000Z', note: 'bonus' },
      }),
    );
    expect(res.statusCode).toBe(201);
    const body = parseBody<CreateGoalContributionResponse>(res);
    expect(body.item.amountMinor).toBe(50_000);
    expect(body.item.createdBy).toBe(SUB);
    expect(body.item.note).toBe('bonus');
    expect(body.goal.progressMinor).toBe(50_000);
    const put = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect((put.Item as Record<string, unknown>)['SK']).toBe(
      'CONTRIB#g-1#2026-02-01T00:00:00.000Z',
    );
  });

  it('404s for an unknown goal', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(contribEvent({ amount: '10.00' }));
    expect(res.statusCode).toBe(404);
  });

  it('400s for a linked-account goal', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: makeGoalItem('g-1', { fundingMode: 'linked-account', linkedAccountId: 'a' }),
    });
    const res = await handler(contribEvent({ amount: '10.00' }));
    expect(res.statusCode).toBe(400);
  });

  it('400s for a zero amount and a malformed timestamp', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeGoalItem('g-1') });
    expect((await handler(contribEvent({ amount: '0.00' }))).statusCode).toBe(400);
    expect(
      (await handler(contribEvent({ amount: '5.00', contributedAt: 'yesterday' }))).statusCode,
    ).toBe(400);
  });

  it('409s when the same timestamp already has a contribution', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeGoalItem('g-1') });
    ddbMock.on(PutCommand).rejects(conditionFailure(false));
    const res = await handler(
      contribEvent({ amount: '5.00', contributedAt: '2026-02-01T00:00:00.000Z' }),
    );
    expect(res.statusCode).toBe(409);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('ALREADY_EXISTS');
  });
});
