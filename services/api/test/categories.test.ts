import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type {
  ArchiveCategoryResponse,
  CategoryDto,
  ErrorEnvelope,
  ListCategoriesResponse,
} from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import {
  PK,
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

describe('GET /categories', () => {
  it('lists categories sorted by sortOrder then name', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        makeCategoryItem('zeta', 'EXPENSE', { sortOrder: 10, name: 'Zeta' }),
        makeCategoryItem('alpha', 'EXPENSE', { sortOrder: 10, name: 'Alpha' }),
        makeCategoryItem('first', 'INCOME', { sortOrder: 1, name: 'First' }),
      ],
    });
    const res = await handler(makeEvent({ routeKey: 'GET /categories' }));
    const body = parseBody<ListCategoriesResponse>(res);
    expect(body.items.map((category) => category.categoryId)).toEqual([
      'first',
      'alpha',
      'zeta',
    ]);
  });
});

describe('POST /categories', () => {
  it('derives the slug id server-side and writes with a uniqueness condition', async () => {
    ddbMock.on(PutCommand).resolves({});
    const res = await handler(
      makeEvent({
        routeKey: 'POST /categories',
        body: { name: 'Coffee  Shops!', type: 'EXPENSE' },
      }),
    );
    expect(res.statusCode).toBe(201);
    const input = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(input.ConditionExpression).toBe('attribute_not_exists(SK)');
    expect(input.Item).toMatchObject({
      PK,
      SK: 'CATEGORY#coffee-shops',
      categoryId: 'coffee-shops',
      name: 'Coffee  Shops!',
      type: 'EXPENSE',
      archived: false,
      isDefault: false,
    });
    const body = parseBody<CategoryDto>(res);
    expect(body.categoryId).toBe('coffee-shops');
  });

  it('returns 409 ALREADY_EXISTS for a duplicate slug', async () => {
    ddbMock.on(PutCommand).rejects(
      new ConditionalCheckFailedException({
        message: 'The conditional request failed',
        $metadata: {},
      }),
    );
    const res = await handler(
      makeEvent({
        routeKey: 'POST /categories',
        body: { name: 'Groceries', type: 'EXPENSE' },
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('ALREADY_EXISTS');
  });

  it('rejects an invalid category type', async () => {
    const res = await handler(
      makeEvent({
        routeKey: 'POST /categories',
        body: { name: 'Misc', type: 'WHATEVER' },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('persists a valid iconKey + color and returns them in the DTO (P10-1)', async () => {
    ddbMock.on(PutCommand).resolves({});
    const res = await handler(
      makeEvent({
        routeKey: 'POST /categories',
        body: { name: 'Coffee', type: 'EXPENSE', iconKey: 'coffee', color: 'c3' },
      }),
    );
    expect(res.statusCode).toBe(201);
    const input = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(input.Item).toMatchObject({ iconKey: 'coffee', color: 'c3' });
    const body = parseBody<CategoryDto>(res);
    expect(body.iconKey).toBe('coffee');
    expect(body.color).toBe('c3');
  });

  it('omits iconKey + color from the item when absent (preserves auto behavior)', async () => {
    ddbMock.on(PutCommand).resolves({});
    const res = await handler(
      makeEvent({
        routeKey: 'POST /categories',
        body: { name: 'Plain', type: 'EXPENSE' },
      }),
    );
    expect(res.statusCode).toBe(201);
    const input = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(input.Item).not.toHaveProperty('iconKey');
    expect(input.Item).not.toHaveProperty('color');
    const body = parseBody<CategoryDto>(res);
    expect(body.iconKey).toBeUndefined();
    expect(body.color).toBeUndefined();
  });

  it('rejects an unknown iconKey with 400 listing the valid keys (P10-1)', async () => {
    const res = await handler(
      makeEvent({
        routeKey: 'POST /categories',
        body: { name: 'Bad Icon', type: 'EXPENSE', iconKey: 'not-a-glyph' },
      }),
    );
    expect(res.statusCode).toBe(400);
    const envelope = parseBody<ErrorEnvelope>(res);
    expect(envelope.error.code).toBe('VALIDATION_ERROR');
    expect((envelope.error.details?.valid as string[]).includes('coffee')).toBe(true);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('rejects an unknown color key with 400 listing the valid keys (P10-1)', async () => {
    const res = await handler(
      makeEvent({
        routeKey: 'POST /categories',
        body: { name: 'Bad Color', type: 'EXPENSE', color: '#ff0000' },
      }),
    );
    expect(res.statusCode).toBe(400);
    const envelope = parseBody<ErrorEnvelope>(res);
    expect(envelope.error.code).toBe('VALIDATION_ERROR');
    expect((envelope.error.details?.valid as string[]).includes('c1')).toBe(true);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});

describe('PATCH /categories/{categoryId}', () => {
  it('updates the provided fields and returns the DTO', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeCategoryItem('groceries', 'EXPENSE', {
        name: 'Food',
        sortOrder: 5,
      }),
    });
    const res = await handler(
      makeEvent({
        routeKey: 'PATCH /categories/{categoryId}',
        pathParameters: { categoryId: 'groceries' },
        body: { name: 'Food', sortOrder: 5 },
      }),
    );
    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.Key).toEqual({ PK, SK: 'CATEGORY#groceries' });
    expect(input.UpdateExpression).toContain('#name = :name');
    expect(parseBody<CategoryDto>(res).name).toBe('Food');
  });

  it('rejects an empty patch body with 400', async () => {
    const res = await handler(
      makeEvent({
        routeKey: 'PATCH /categories/{categoryId}',
        pathParameters: { categoryId: 'groceries' },
        body: {},
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('updates iconKey + color and returns them in the DTO (P10-1)', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeCategoryItem('groceries', 'EXPENSE', {
        iconKey: 'basket',
        color: 'c5',
      }),
    });
    const res = await handler(
      makeEvent({
        routeKey: 'PATCH /categories/{categoryId}',
        pathParameters: { categoryId: 'groceries' },
        body: { iconKey: 'basket', color: 'c5' },
      }),
    );
    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).toContain('#iconKey = :iconKey');
    expect(input.UpdateExpression).toContain('#color = :color');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':iconKey': 'basket',
      ':color': 'c5',
    });
    const body = parseBody<CategoryDto>(res);
    expect(body.iconKey).toBe('basket');
    expect(body.color).toBe('c5');
  });

  it('rejects an unknown iconKey with 400 and never writes (P10-1)', async () => {
    const res = await handler(
      makeEvent({
        routeKey: 'PATCH /categories/{categoryId}',
        pathParameters: { categoryId: 'groceries' },
        body: { iconKey: 'totally-fake' },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('rejects an unknown color key with 400 and never writes (P10-1)', async () => {
    const res = await handler(
      makeEvent({
        routeKey: 'PATCH /categories/{categoryId}',
        pathParameters: { categoryId: 'groceries' },
        body: { color: 'rgb(0,0,0)' },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('leaves iconKey + color untouched when absent (no write of those fields)', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeCategoryItem('groceries', 'EXPENSE', { name: 'Food' }),
    });
    const res = await handler(
      makeEvent({
        routeKey: 'PATCH /categories/{categoryId}',
        pathParameters: { categoryId: 'groceries' },
        body: { name: 'Food' },
      }),
    );
    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).not.toContain('#iconKey');
    expect(input.UpdateExpression).not.toContain('#color');
  });
});

describe('DELETE /categories/{categoryId}', () => {
  it('soft deletes via UpdateItem (archived: true), never a hard delete', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    const res = await handler(
      makeEvent({
        routeKey: 'DELETE /categories/{categoryId}',
        pathParameters: { categoryId: 'groceries' },
      }),
    );
    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).toContain('#archived = :true');
    expect(parseBody<ArchiveCategoryResponse>(res)).toEqual({
      categoryId: 'groceries',
      archived: true,
    });
  });

  it('returns 404 when the category does not exist', async () => {
    ddbMock.on(UpdateCommand).rejects(
      new ConditionalCheckFailedException({
        message: 'The conditional request failed',
        $metadata: {},
      }),
    );
    const res = await handler(
      makeEvent({
        routeKey: 'DELETE /categories/{categoryId}',
        pathParameters: { categoryId: 'nope' },
      }),
    );
    expect(res.statusCode).toBe(404);
  });
});
