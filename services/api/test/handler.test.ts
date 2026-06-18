import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ErrorEnvelope, HealthResponse } from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import { makeEvent, parseBody, setTestEnv } from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

describe('handler routing and guards', () => {
  it('returns 404 with the error envelope for an unknown route', async () => {
    const res = await handler(makeEvent({ routeKey: 'GET /nope' }));
    expect(res.statusCode).toBe(404);
    const body = parseBody<ErrorEnvelope>(res);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('GET /nope');
  });

  it('returns 401 UNAUTHORIZED when the household claim is missing', async () => {
    const res = await handler(
      makeEvent({ routeKey: 'GET /accounts', claims: { sub: 'someone' } }),
    );
    expect(res.statusCode).toBe(401);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('UNAUTHORIZED');
  });

  it('serves GET /health', async () => {
    const res = await handler(makeEvent({ routeKey: 'GET /health' }));
    expect(res.statusCode).toBe(200);
    expect(parseBody<HealthResponse>(res)).toEqual({ ok: true });
  });

  it('maps unhandled errors to a generic 500 INTERNAL_ERROR', async () => {
    ddbMock.on(QueryCommand).rejects(new Error('boom'));
    const res = await handler(makeEvent({ routeKey: 'GET /accounts' }));
    expect(res.statusCode).toBe(500);
    const body = parseBody<ErrorEnvelope>(res);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('boom');
  });

  it('never sets CORS headers (the HTTP API owns CORS)', async () => {
    const res = await handler(makeEvent({ routeKey: 'GET /health' }));
    expect(Object.keys(res.headers ?? {})).not.toContain('access-control-allow-origin');
  });
});
