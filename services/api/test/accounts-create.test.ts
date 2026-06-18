import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { CreateAccountResponse, ErrorEnvelope } from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import { conditionFailure, makeEvent, parseBody, setTestEnv } from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

function createEvent(body: unknown) {
  return makeEvent({ routeKey: 'POST /accounts', body });
}

const GOOD_BODY = {
  name: 'Cash wallet',
  accountType: 'other',
  currency: 'USD',
  openingBalance: '120.50',
};

describe('POST /accounts (manual accounts, P7-6)', () => {
  it('creates a manual account with the synthetic SimpleFIN id', async () => {
    ddbMock.on(PutCommand).resolves({});
    const res = await handler(createEvent(GOOD_BODY));
    expect(res.statusCode).toBe(201);
    const body = parseBody<CreateAccountResponse>(res);
    expect(body.name).toBe('Cash wallet');
    expect(body.source).toBe('manual');
    expect(body.balanceMinor).toBe(12_050);
    expect(body.balance).toBe('120.50');
    expect(body.holdingsSupported).toBe(false);
    expect(body.isLiability).toBe(false);

    const put = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    const item = put.Item as Record<string, unknown>;
    expect(item['SK']).toBe(`ACCT#${body.accountId}`);
    // Compile-compat contract: simplefinAccountId stays required; manual
    // writers set 'manual:<accountId>' so it can never match a bridge id.
    expect(item['simplefinAccountId']).toBe(`manual:${body.accountId}`);
    expect(item['source']).toBe('manual');
    expect(put.ConditionExpression).toBe('attribute_not_exists(SK)');
  });

  it('defaults institution to "Manual" and the opening balance to zero', async () => {
    ddbMock.on(PutCommand).resolves({});
    const res = await handler(
      createEvent({ name: 'Savings jar', accountType: 'savings', currency: 'USD' }),
    );
    const body = parseBody<CreateAccountResponse>(res);
    expect(body.institution).toBe('Manual');
    expect(body.balanceMinor).toBe(0);
  });

  it('classifies manual liability accounts', async () => {
    ddbMock.on(PutCommand).resolves({});
    const res = await handler(
      createEvent({ name: 'Car loan', accountType: 'loan', currency: 'USD' }),
    );
    expect(parseBody<CreateAccountResponse>(res).isLiability).toBe(true);
  });

  it.each([
    [{ ...GOOD_BODY, accountType: 'crypto' }],
    [{ ...GOOD_BODY, currency: 'us dollars' }],
    [{ ...GOOD_BODY, currency: 'usd' }],
    [{ ...GOOD_BODY, openingBalance: 'a lot' }],
    [{ accountType: 'other', currency: 'USD' }],
  ])('rejects invalid bodies with 400 (%#)', async (body) => {
    const res = await handler(createEvent(body));
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('maps an id collision to 409 ALREADY_EXISTS', async () => {
    ddbMock.on(PutCommand).rejects(conditionFailure(false));
    const res = await handler(createEvent(GOOD_BODY));
    expect(res.statusCode).toBe(409);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('ALREADY_EXISTS');
  });

  it('401s without the household claim', async () => {
    const res = await handler(
      makeEvent({ routeKey: 'POST /accounts', body: GOOD_BODY, claims: { sub: 's' } }),
    );
    expect(res.statusCode).toBe(401);
  });
});
