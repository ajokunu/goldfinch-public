/**
 * PATCH /accounts/{accountId} (P8-4, ops/PHASE8-DECISIONS.md).
 *
 * Covers: validation via the shared isAccountTypeId guard, identity from the
 * JWT only, attribute_exists 404 (both before and during the write),
 * version-conditional 409, the USER-OWNED override writes, effective values
 * in the response, and the liability flip reclassifying GET /summary.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ACCOUNT_TYPE_IDS } from '@goldfinch/shared/accountTypes';
import type {
  ErrorEnvelope,
  PatchAccountResponse,
  SummaryResponse,
} from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import {
  PK,
  conditionFailure,
  makeAccountItem,
  makeEvent,
  parseBody,
  setTestEnv,
} from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

const ROUTE = 'PATCH /accounts/{accountId}';

function patchEvent(body: unknown, accountId = 'a1') {
  return makeEvent({ routeKey: ROUTE, pathParameters: { accountId }, body });
}

describe('PATCH /accounts/{accountId} validation', () => {
  it('rejects a body with neither accountType nor isLiability (400, no reads or writes)', async () => {
    const res = await handler(patchEvent({}));
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('rejects an accountType outside the shared AccountTypeId union with the full allowed list', async () => {
    // 'credit' is the SYNCED legacy value — the user-facing id is
    // 'credit-card'; the guard must reject the legacy spelling.
    const res = await handler(patchEvent({ accountType: 'credit' }));
    expect(res.statusCode).toBe(400);
    const envelope = parseBody<ErrorEnvelope>(res);
    expect(envelope.error.code).toBe('VALIDATION_ERROR');
    for (const id of ACCOUNT_TYPE_IDS) {
      expect(envelope.error.message).toContain(id);
    }
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('rejects a non-boolean isLiability with 400 VALIDATION_ERROR', async () => {
    const res = await handler(patchEvent({ isLiability: 'true' }));
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('derives identity from the JWT only: a token without the household claim is 401', async () => {
    const event = makeEvent({
      routeKey: ROUTE,
      pathParameters: { accountId: 'a1' },
      body: { accountType: 'savings' },
      claims: { sub: 'test-sub' },
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(401);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('UNAUTHORIZED');
    expect(ddbMock.calls()).toHaveLength(0);
  });
});

describe('PATCH /accounts/{accountId} not-found and version conflicts', () => {
  it('returns 404 NOT_FOUND when the account does not exist (no write attempted)', async () => {
    ddbMock.on(GetCommand).resolves({});
    const res = await handler(patchEvent({ accountType: 'savings' }, 'ghost'));
    expect(res.statusCode).toBe(404);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('NOT_FOUND');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('returns 404 when the account is deleted between the read and the conditional write', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#a1' }) });
    ddbMock.on(UpdateCommand).rejects(conditionFailure(false));
    const res = await handler(patchEvent({ accountType: 'savings' }));
    expect(res.statusCode).toBe(404);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('NOT_FOUND');
  });

  it('returns 409 VERSION_CONFLICT when a concurrent write moved the version', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#a1' }) });
    ddbMock.on(UpdateCommand).rejects(conditionFailure(true));
    const res = await handler(patchEvent({ isLiability: true }));
    expect(res.statusCode).toBe(409);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VERSION_CONFLICT');
  });
});

describe('PATCH /accounts/{accountId} writes', () => {
  it('writes typeOverride version-conditionally and returns the effective values', async () => {
    const current = makeAccountItem({ SK: 'ACCT#a1', accountType: 'checking' });
    ddbMock.on(GetCommand).resolves({ Item: current });
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        ...makeAccountItem({ SK: 'ACCT#a1', typeOverride: 'credit-card' }),
        version: 1,
      },
    });

    const res = await handler(patchEvent({ accountType: 'credit-card' }));
    expect(res.statusCode).toBe(200);

    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.Key).toEqual({ PK, SK: 'ACCT#a1' });
    // First versioned write: conditions on the counter still being absent.
    expect(input.ConditionExpression).toBe(
      'attribute_exists(SK) AND attribute_not_exists(#version)',
    );
    expect(input.UpdateExpression).toContain('#typeOverride = :typeOverride');
    expect(input.UpdateExpression).not.toContain('isLiabilityOverride');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':typeOverride': 'credit-card',
      ':nextVersion': 1,
    });
    expect(input.ReturnValuesOnConditionCheckFailure).toBe('ALL_OLD');

    // Effective values: override wins, liability follows the new type default.
    const body = parseBody<PatchAccountResponse>(res);
    expect(body.accountTypeId).toBe('credit-card');
    expect(body.isLiability).toBe(true);
    // Legacy synced field is untouched by the override.
    expect(body.accountType).toBe('checking');
  });

  it('conditions on the stored version when the item already carries one', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { ...makeAccountItem({ SK: 'ACCT#a1' }), version: 3 },
    });
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        ...makeAccountItem({ SK: 'ACCT#a1', isLiabilityOverride: true }),
        version: 4,
      },
    });

    const res = await handler(patchEvent({ isLiability: true }));
    expect(res.statusCode).toBe(200);

    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.ConditionExpression).toBe('attribute_exists(SK) AND #version = :version');
    expect(input.ExpressionAttributeValues).toMatchObject({
      ':version': 3,
      ':nextVersion': 4,
      ':isLiabilityOverride': true,
    });
    expect(input.UpdateExpression).toContain('#isLiabilityOverride = :isLiabilityOverride');
    expect(input.UpdateExpression).not.toContain('typeOverride');
  });

  it('accepts both fields at once and reports both effective values', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#a1' }) });
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        ...makeAccountItem({
          SK: 'ACCT#a1',
          typeOverride: 'loan',
          isLiabilityOverride: false,
        }),
        version: 1,
      },
    });

    const res = await handler(patchEvent({ accountType: 'loan', isLiability: false }));
    expect(res.statusCode).toBe(200);
    const body = parseBody<PatchAccountResponse>(res);
    expect(body.accountTypeId).toBe('loan');
    // The explicit liability override beats the loan type's liability default.
    expect(body.isLiability).toBe(false);
  });
});

describe('liability flip reclassifies the summary (P8-4 documented behavior)', () => {
  it('counts the flipped account as a liability in GET /summary right after the PATCH', async () => {
    const flipped = {
      ...makeAccountItem({
        SK: 'ACCT#a1',
        accountType: 'checking',
        balanceMinor: 100_000,
        isLiabilityOverride: true,
      }),
      version: 1,
    };
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#a1' }) });
    ddbMock.on(UpdateCommand).resolves({ Attributes: flipped });
    ddbMock.on(QueryCommand).resolves({ Items: [flipped] });

    const patchRes = await handler(patchEvent({ isLiability: true }));
    expect(patchRes.statusCode).toBe(200);
    expect(parseBody<PatchAccountResponse>(patchRes).isLiability).toBe(true);

    const summaryRes = await handler(makeEvent({ routeKey: 'GET /summary' }));
    const summary = parseBody<SummaryResponse>(summaryRes);
    expect(summary.assetsTotalMinor).toBe(0);
    expect(summary.liabilitiesTotalMinor).toBe(100_000);
    expect(summary.netWorthMinor).toBe(-100_000);
  });
});
