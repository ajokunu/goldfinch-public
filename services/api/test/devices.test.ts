import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ErrorEnvelope, RegisterPushTokenResponse } from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import { PK, SUB, makeEvent, parseBody, setTestEnv } from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

describe('POST /devices/push-token', () => {
  function registerEvent(body: unknown) {
    return makeEvent({ routeKey: 'POST /devices/push-token', body });
  }

  const GOOD_BODY = {
    deviceId: 'device-1',
    expoPushToken: 'ExponentPushToken[abc123]',
    platform: 'ios',
  };

  it('upserts the PUSHTOKEN# item, clearing disabledAt and preserving createdAt', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    const res = await handler(registerEvent(GOOD_BODY));
    expect(res.statusCode).toBe(200);
    expect(parseBody<RegisterPushTokenResponse>(res)).toEqual({ deviceId: 'device-1' });

    const update = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.Key).toEqual({ PK, SK: 'PUSHTOKEN#device-1' });
    expect(update.UpdateExpression).toContain('#disabledAt = :null');
    expect(update.UpdateExpression).toContain('#createdAt = if_not_exists(#createdAt, :now)');
    expect(update.ExpressionAttributeValues).toMatchObject({
      ':entityType': 'PUSH_TOKEN',
      ':expoPushToken': 'ExponentPushToken[abc123]',
      ':platform': 'ios',
      ':ownerSub': SUB,
      ':null': null,
    });
  });

  it.each([
    [{ ...GOOD_BODY, platform: 'windows' }],
    [{ ...GOOD_BODY, platform: undefined }],
    [{ ...GOOD_BODY, deviceId: '' }],
    [{ deviceId: 'd', platform: 'ios' }],
  ])('rejects malformed registrations with 400 (%#)', async (body) => {
    const res = await handler(registerEvent(body));
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('401s without the household claim', async () => {
    const res = await handler(
      makeEvent({
        routeKey: 'POST /devices/push-token',
        body: GOOD_BODY,
        claims: { sub: 's' },
      }),
    );
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /devices/push-token/{deviceId}', () => {
  it('deletes the registration and 204s (idempotent: no 404)', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    const res = await handler(
      makeEvent({
        routeKey: 'DELETE /devices/push-token/{deviceId}',
        pathParameters: { deviceId: 'device-1' },
      }),
    );
    expect(res.statusCode).toBe(204);
    const del = ddbMock.commandCalls(DeleteCommand)[0]!.args[0].input;
    expect(del.Key).toEqual({ PK, SK: 'PUSHTOKEN#device-1' });
    expect(del.ConditionExpression).toBeUndefined();
  });
});
