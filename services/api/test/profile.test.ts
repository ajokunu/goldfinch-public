/**
 * GET /profile, PATCH /profile — the per-user display-name contract.
 *
 * The load-bearing assertions: identity comes ONLY from the JWT claims (the
 * item key is PROFILE#<sub> for the calling user; no client input can pick a
 * different item), validation enforces the shared trimmed 1-40 bounds, and
 * the upsert is version-conditional (create requires absence, update requires
 * the read version; 409 VERSION_CONFLICT otherwise).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { PROFILE_DISPLAY_NAME_MAX_LENGTH } from '@goldfinch/shared/constants';
import type {
  ErrorEnvelope,
  GetProfileResponse,
  PatchProfileResponse,
} from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import {
  HOUSEHOLD,
  PK,
  SUB,
  conditionFailure,
  makeEvent,
  makeProfileItem,
  parseBody,
  setTestEnv,
} from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);
const PROFILE_KEY = { PK, SK: `PROFILE#${SUB}` };

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

describe('GET /profile', () => {
  it('returns the stored display name from the CALLER-keyed PROFILE item', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeProfileItem(SUB, { displayName: 'Dami' }) });

    const res = await handler(makeEvent({ routeKey: 'GET /profile' }));

    expect(res.statusCode).toBe(200);
    expect(parseBody<GetProfileResponse>(res)).toEqual({ displayName: 'Dami' });
    // The sub comes from the JWT claims, never from client input.
    const get = ddbMock.commandCalls(GetCommand)[0]!.args[0].input;
    expect(get.Key).toEqual(PROFILE_KEY);
  });

  it('includes the email claim when the access token carries one', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeProfileItem(SUB) });

    const res = await handler(
      makeEvent({
        routeKey: 'GET /profile',
        claims: {
          household: HOUSEHOLD,
          sub: SUB,
          scope: 'goldfinch/api',
          email: 'wpffkejd@example.com',
        },
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(parseBody<GetProfileResponse>(res)).toEqual({
      displayName: 'Aaron',
      email: 'wpffkejd@example.com',
    });
  });

  it('omits email entirely when the token has no email claim', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeProfileItem(SUB) });
    const res = await handler(makeEvent({ routeKey: 'GET /profile' }));
    expect(parseBody<Record<string, unknown>>(res)).not.toHaveProperty('email');
  });

  it('404s when the caller has no profile item yet', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(makeEvent({ routeKey: 'GET /profile' }));
    expect(res.statusCode).toBe(404);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('NOT_FOUND');
  });

  it('401s without the household claim', async () => {
    const res = await handler(
      makeEvent({ routeKey: 'GET /profile', claims: { sub: SUB } }),
    );
    expect(res.statusCode).toBe(401);
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
  });

  it('401s without the sub claim', async () => {
    const res = await handler(
      makeEvent({ routeKey: 'GET /profile', claims: { household: HOUSEHOLD } }),
    );
    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /profile', () => {
  function patchEvent(body: unknown) {
    return makeEvent({ routeKey: 'PATCH /profile', body });
  }

  it('self-provisions the profile (version 1) on the first save, trimmed', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});

    const res = await handler(patchEvent({ displayName: '  Dami  ' }));

    expect(res.statusCode).toBe(200);
    expect(parseBody<PatchProfileResponse>(res)).toEqual({ displayName: 'Dami' });
    const put = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put.ConditionExpression).toBe('attribute_not_exists(SK)');
    expect(put.Item).toMatchObject({
      ...PROFILE_KEY,
      entityType: 'USER',
      cognitoSub: SUB,
      householdId: HOUSEHOLD,
      displayName: 'Dami',
      version: 1,
    });
  });

  it('updates an existing profile conditionally on the version it read', async () => {
    ddbMock
      .on(GetCommand)
      .resolves({ Item: makeProfileItem(SUB, { displayName: 'Aaron', version: 3 }) });
    ddbMock
      .on(UpdateCommand)
      .resolves({ Attributes: makeProfileItem(SUB, { displayName: 'Dami', version: 4 }) });

    const res = await handler(patchEvent({ displayName: 'Dami' }));

    expect(res.statusCode).toBe(200);
    expect(parseBody<PatchProfileResponse>(res)).toEqual({ displayName: 'Dami' });
    const update = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.Key).toEqual(PROFILE_KEY);
    expect(update.ConditionExpression).toBe(
      'attribute_exists(PK) AND #version = :version',
    );
    expect(update.ExpressionAttributeValues).toMatchObject({
      ':version': 3,
      ':nextVersion': 4,
      ':displayName': 'Dami',
    });
    // Only displayName/updatedAt/version are touched — notification
    // preferences and other profile attributes survive the write.
    expect(update.UpdateExpression).toBe(
      'SET #displayName = :displayName, #updatedAt = :updatedAt, #version = :nextVersion',
    );
  });

  it('handles pre-feature items without a version (conditions on its absence)', async () => {
    const legacy = makeProfileItem(SUB, { displayName: 'Aaron' });
    delete (legacy as Partial<typeof legacy>).version;
    ddbMock.on(GetCommand).resolves({ Item: legacy });
    ddbMock
      .on(UpdateCommand)
      .resolves({ Attributes: makeProfileItem(SUB, { displayName: 'Dami', version: 1 }) });

    const res = await handler(patchEvent({ displayName: 'Dami' }));

    expect(res.statusCode).toBe(200);
    const update = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.ConditionExpression).toBe(
      'attribute_exists(PK) AND attribute_not_exists(#version)',
    );
    expect(update.ExpressionAttributeValues).toMatchObject({ ':nextVersion': 1 });
    expect(update.ExpressionAttributeValues).not.toHaveProperty(':version');
  });

  it('409s VERSION_CONFLICT when the conditional update loses a race', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeProfileItem(SUB, { version: 3 }) });
    ddbMock.on(UpdateCommand).rejects(conditionFailure(true));

    const res = await handler(patchEvent({ displayName: 'Dami' }));

    expect(res.statusCode).toBe(409);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VERSION_CONFLICT');
  });

  it('409s when a concurrent first save already created the item', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).rejects(conditionFailure(true));

    const res = await handler(patchEvent({ displayName: 'Dami' }));

    expect(res.statusCode).toBe(409);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VERSION_CONFLICT');
  });

  it.each([
    ['missing', {}],
    ['null', { displayName: null }],
    ['non-string', { displayName: 42 }],
    ['empty', { displayName: '' }],
    ['whitespace-only', { displayName: '   ' }],
    ['too long', { displayName: 'x'.repeat(PROFILE_DISPLAY_NAME_MAX_LENGTH + 1) }],
  ])('rejects a %s displayName with 400 and writes nothing', async (_label, body) => {
    const res = await handler(patchEvent(body));
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('accepts a name of exactly the max length', async () => {
    const max = 'x'.repeat(PROFILE_DISPLAY_NAME_MAX_LENGTH);
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(PutCommand).resolves({});

    const res = await handler(patchEvent({ displayName: max }));

    expect(res.statusCode).toBe(200);
    expect(parseBody<PatchProfileResponse>(res).displayName).toBe(max);
  });

  it('401s without the household claim and never reads the table', async () => {
    const res = await handler(
      makeEvent({
        routeKey: 'PATCH /profile',
        body: { displayName: 'Dami' },
        claims: { sub: SUB },
      }),
    );
    expect(res.statusCode).toBe(401);
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
  });
});
