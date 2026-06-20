import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  ErrorEnvelope,
  HoldingDto,
  ListHoldingsResponse,
} from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import {
  PK,
  makeAccountItem,
  makeEvent,
  makeHoldingBasisItem,
  makeHoldingItem,
  parseBody,
  setTestEnv,
} from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

const LIST_ROUTE = 'GET /accounts/{accountId}/holdings';
const SET_ROUTE = 'POST /accounts/{accountId}/holdings/{symbol}/cost-basis';

function listEvent(accountId = 'acct-1') {
  return makeEvent({ routeKey: LIST_ROUTE, pathParameters: { accountId } });
}

function setEvent(symbol: string, body: unknown, accountId = 'acct-1') {
  return makeEvent({
    routeKey: SET_ROUTE,
    pathParameters: { accountId, symbol },
    body,
  });
}

/**
 * The GET path issues two QueryCommands (the HOLDING# prefix then the
 * HOLDINGBASIS# prefix). Resolve each by its `:prefix` so a test can stage the
 * holdings and the basis rows independently.
 */
function stageQueries(holdings: unknown[], basis: unknown[]): void {
  ddbMock
    .on(QueryCommand, {
      ExpressionAttributeValues: { ':pk': PK, ':prefix': 'HOLDING#acct-1#' },
    })
    .resolves({ Items: holdings });
  ddbMock
    .on(QueryCommand, {
      ExpressionAttributeValues: { ':pk': PK, ':prefix': 'HOLDINGBASIS#acct-1#' },
    })
    .resolves({ Items: basis });
}

describe('GET /accounts/{accountId}/holdings', () => {
  it('sorts by market value DESCENDING with the explicit support flag', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: makeAccountItem({
        SK: 'ACCT#acct-1',
        accountType: 'investment',
        holdingsSupported: true,
      }),
    });
    stageQueries(
      [
        makeHoldingItem('acct-1', 'h-small', { symbol: 'BND', marketValueMinor: 100_000 }),
        makeHoldingItem('acct-1', 'h-big', { symbol: 'VTI', marketValueMinor: 900_000 }),
        makeHoldingItem('acct-1', 'h-mid', { symbol: 'VXUS', marketValueMinor: 500_000 }),
      ],
      [],
    );
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    expect(body.holdingsSupported).toBe(true);
    expect(body.items.map((h) => h.holdingId)).toEqual(['h-big', 'h-mid', 'h-small']);
  });

  it('reports holdingsSupported false (the no-silent-blank state) from the account flag', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: makeAccountItem({
        SK: 'ACCT#acct-1',
        accountType: 'investment',
        holdingsSupported: false,
      }),
    });
    stageQueries([], []);
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    expect(body).toEqual({ items: [], holdingsSupported: false });
  });

  it('falls back to row presence when the pre-Phase-7 account has no flag', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    stageQueries([makeHoldingItem('acct-1', 'h-1')], []);
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    expect(body.holdingsSupported).toBe(true);
    expect(body.items).toHaveLength(1);
  });

  it('404s for an unknown account', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(listEvent('nope'));
    expect(res.statusCode).toBe(404);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('NOT_FOUND');
  });

  it('queries the holding prefix for exactly this account', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    stageQueries([], []);
    await handler(listEvent());
    const prefixes = ddbMock
      .commandCalls(QueryCommand)
      .map((c) => (c.args[0].input.ExpressionAttributeValues as Record<string, unknown>)[':prefix']);
    expect(prefixes).toContain('HOLDING#acct-1#');
    expect(prefixes).toContain('HOLDINGBASIS#acct-1#');
  });

  it('always computes current price per share (BigInt-exact)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    // 350000 minor / 12.5 shares = 28000 minor = $280.00 per share.
    stageQueries([makeHoldingItem('acct-1', 'h-1', { shares: '12.5' })], []);
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    const h = body.items[0]!;
    expect(h.currentPriceMinor).toBe(28_000);
    expect(h.currentPrice).toBe('280.00');
  });

  it('omits current price when shares is zero (no divide-by-zero)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    stageQueries([makeHoldingItem('acct-1', 'h-1', { shares: '0' })], []);
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    const h = body.items[0]!;
    expect(h.currentPrice).toBeUndefined();
    expect(h.currentPriceMinor).toBeUndefined();
  });

  it('attaches a manual basis with costBasisSource "manual" and signed gain/percent', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    // market 350000, manual cost 300000 -> gain +50000 (+16%).
    stageQueries(
      [makeHoldingItem('acct-1', 'h-1', { symbol: 'VTI', marketValueMinor: 350_000 })],
      [makeHoldingBasisItem('acct-1', 'VTI', 300_000)],
    );
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    const h = body.items[0]!;
    expect(h.costBasisMinor).toBe(300_000);
    expect(h.costBasisSource).toBe('manual');
    expect(h.gainMinor).toBe(50_000);
    expect(h.gain).toBe('500.00');
    expect(h.percentReturn).toBe(16);
  });

  it('reports a negative gain/percent for a loss (truncated toward zero)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    // market 350000, manual cost 700000 -> gain -350000 (-50%).
    stageQueries(
      [makeHoldingItem('acct-1', 'h-1', { symbol: 'VTI', marketValueMinor: 350_000 })],
      [makeHoldingBasisItem('acct-1', 'VTI', 700_000)],
    );
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    const h = body.items[0]!;
    expect(h.gainMinor).toBe(-350_000);
    expect(h.percentReturn).toBe(-50);
  });

  it('uses the feed cost basis (non-zero) with costBasisSource "feed"', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    stageQueries(
      [
        makeHoldingItem('acct-1', 'h-1', {
          symbol: 'VTI',
          marketValueMinor: 350_000,
          costBasisMinor: 200_000,
        }),
      ],
      [],
    );
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    const h = body.items[0]!;
    expect(h.costBasisMinor).toBe(200_000);
    expect(h.costBasisSource).toBe('feed');
    expect(h.gainMinor).toBe(150_000);
  });

  it('prefers the manual basis over a feed basis', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    stageQueries(
      [
        makeHoldingItem('acct-1', 'h-1', {
          symbol: 'VTI',
          marketValueMinor: 350_000,
          costBasisMinor: 200_000,
        }),
      ],
      [makeHoldingBasisItem('acct-1', 'VTI', 300_000)],
    );
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    const h = body.items[0]!;
    expect(h.costBasisMinor).toBe(300_000);
    expect(h.costBasisSource).toBe('manual');
  });

  it('ignores a manual basis whose currency does not match the holding', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    stageQueries(
      [makeHoldingItem('acct-1', 'h-1', { symbol: 'VTI', currency: 'USD' })],
      [makeHoldingBasisItem('acct-1', 'VTI', 300_000, { currency: 'EUR' })],
    );
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    const h = body.items[0]!;
    expect(h.costBasisMinor).toBeUndefined();
    expect(h.costBasisSource).toBeUndefined();
    expect(h.gainMinor).toBeUndefined();
    expect(h.percentReturn).toBeUndefined();
  });

  it('emits no gain/percent when no effective basis exists', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    // feed cost basis 0 == unavailable, no manual basis -> no effective basis.
    stageQueries(
      [makeHoldingItem('acct-1', 'h-1', { symbol: 'VTI', costBasisMinor: 0 })],
      [],
    );
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    const h = body.items[0]!;
    expect(h.costBasisMinor).toBeUndefined();
    expect(h.gain).toBeUndefined();
    expect(h.percentReturn).toBeUndefined();
  });

  it('silently ignores an orphan basis with no matching held symbol', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeAccountItem({ SK: 'ACCT#acct-1' }) });
    stageQueries(
      [makeHoldingItem('acct-1', 'h-1', { symbol: 'VTI' })],
      [makeHoldingBasisItem('acct-1', 'SOLD', 300_000)],
    );
    const body = parseBody<ListHoldingsResponse>(await handler(listEvent()));
    const h = body.items[0]!;
    expect(body.items).toHaveLength(1);
    expect(h.costBasisMinor).toBeUndefined();
  });
});

describe('POST /accounts/{accountId}/holdings/{symbol}/cost-basis', () => {
  function stageSetHoldings(holdings: unknown[]): void {
    ddbMock
      .on(QueryCommand, {
        ExpressionAttributeValues: { ':pk': PK, ':prefix': 'HOLDING#acct-1#' },
      })
      .resolves({ Items: holdings });
  }

  it('sets the manual cost basis (parsed against the holding currency)', async () => {
    stageSetHoldings([
      makeHoldingItem('acct-1', 'h-1', { symbol: 'VTI', marketValueMinor: 350_000 }),
    ]);
    ddbMock.on(GetCommand).resolves({ Item: undefined }); // no existing basis
    const res = await handler(setEvent('VTI', { amount: '3000.00' }));
    expect(res.statusCode).toBe(200);
    const dto = parseBody<HoldingDto>(res);
    expect(dto.costBasisMinor).toBe(300_000);
    expect(dto.costBasisSource).toBe('manual');
    expect(dto.gainMinor).toBe(50_000);
    const put = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put.Item).toMatchObject({
      SK: 'HOLDINGBASIS#acct-1#VTI',
      entityType: 'HOLDING_BASIS',
      costBasisMinor: 300_000,
      currency: 'USD',
      createdBy: 'test-sub',
      version: 1,
    });
  });

  it('bumps the version and preserves createdBy/createdAt on an existing basis', async () => {
    stageSetHoldings([makeHoldingItem('acct-1', 'h-1', { symbol: 'VTI' })]);
    ddbMock.on(GetCommand).resolves({
      Item: makeHoldingBasisItem('acct-1', 'VTI', 100_000, {
        createdBy: 'other-sub',
        createdAt: '2026-01-01T00:00:00.000Z',
        version: 3,
      }),
    });
    const res = await handler(setEvent('VTI', { amount: '5000' }));
    expect(res.statusCode).toBe(200);
    const put = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put.Item).toMatchObject({
      costBasisMinor: 500_000,
      createdBy: 'other-sub',
      createdAt: '2026-01-01T00:00:00.000Z',
      version: 4,
    });
  });

  it('clears the basis via an explicit null amount (Delete, 204)', async () => {
    const res = await handler(setEvent('VTI', { amount: null }));
    expect(res.statusCode).toBe(204);
    const del = ddbMock.commandCalls(DeleteCommand)[0]!.args[0].input;
    expect(del.Key).toEqual({ PK, SK: 'HOLDINGBASIS#acct-1#VTI' });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('clears the basis via an empty/whitespace amount (Delete, 204)', async () => {
    const res = await handler(setEvent('VTI', { amount: '   ' }));
    expect(res.statusCode).toBe(204);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('rejects a symbol containing "#" with 400 VALIDATION_ERROR', async () => {
    const res = await handler(setEvent('BAD#SYM', { amount: '100' }));
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    // Guard runs before any write.
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it('rejects a negative amount with 400 VALIDATION_ERROR', async () => {
    stageSetHoldings([makeHoldingItem('acct-1', 'h-1', { symbol: 'VTI' })]);
    const res = await handler(setEvent('VTI', { amount: '-10.00' }));
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('404s when the symbol is not held in the account', async () => {
    stageSetHoldings([makeHoldingItem('acct-1', 'h-1', { symbol: 'OTHER' })]);
    const res = await handler(setEvent('VTI', { amount: '100.00' }));
    expect(res.statusCode).toBe(404);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('NOT_FOUND');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});
