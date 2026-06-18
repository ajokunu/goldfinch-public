import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  ErrorEnvelope,
  ListRecurringResponse,
  PatchRecurringResponse,
} from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import {
  PK,
  conditionFailure,
  makeEvent,
  makeRecurringItem,
  parseBody,
  setTestEnv,
} from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

describe('GET /recurring', () => {
  it('lists series sorted by nextExpectedDate and maps the money pair', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        makeRecurringItem('s-late', { nextExpectedDate: '2026-07-01', payee: 'Hulu' }),
        makeRecurringItem('s-soon', { nextExpectedDate: '2026-06-12' }),
      ],
    });
    const res = await handler(makeEvent({ routeKey: 'GET /recurring' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody<ListRecurringResponse>(res);
    expect(body.items.map((s) => s.seriesId)).toEqual(['s-soon', 's-late']);
    const soon = body.items[0]!;
    expect(soon.avgAmount).toBe('-15.99');
    expect(soon.avgAmountMinor).toBe(-1599);
    expect(soon.status).toBe('detected');
  });

  it('excludes foreign entity types that share no prefix semantics', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        makeRecurringItem('s-1'),
        { PK, SK: 'RECURRING#zzz', entityType: 'SOMETHING_ELSE' },
      ],
    });
    const res = await handler(makeEvent({ routeKey: 'GET /recurring' }));
    const body = parseBody<ListRecurringResponse>(res);
    expect(body.items).toHaveLength(1);
  });

  it('401s without the household claim', async () => {
    const res = await handler(
      makeEvent({ routeKey: 'GET /recurring', claims: { sub: 'someone' } }),
    );
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /recurring/{seriesId}', () => {
  function patchEvent(body: unknown) {
    return makeEvent({
      routeKey: 'PATCH /recurring/{seriesId}',
      pathParameters: { seriesId: 's-1' },
      body,
    });
  }

  it.each(['confirmed', 'ignored'] as const)('records the %s review action', async (status) => {
    ddbMock
      .on(UpdateCommand)
      .resolves({ Attributes: makeRecurringItem('s-1', { status }) });
    const res = await handler(patchEvent({ status }));
    expect(res.statusCode).toBe(200);
    expect(parseBody<PatchRecurringResponse>(res).item.status).toBe(status);
    const update = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.Key).toEqual({ PK, SK: 'RECURRING#s-1' });
    expect(update.ConditionExpression).toContain('attribute_exists');
  });

  it('rejects a status outside confirmed/ignored with 400', async () => {
    const res = await handler(patchEvent({ status: 'detected' }));
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('404s when the series does not exist', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailure(false));
    const res = await handler(patchEvent({ status: 'confirmed' }));
    expect(res.statusCode).toBe(404);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('NOT_FOUND');
  });
});
