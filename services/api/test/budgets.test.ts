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
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type {
  BudgetPeriod,
  BudgetResponse,
  ErrorEnvelope,
  ListBudgetsResponse,
} from '@goldfinch/shared/types';
import { gsiDateRangeBounds } from '@goldfinch/shared/keys';
import { periodWindow } from '@goldfinch/shared/periodWindow';
import { handler } from '../src/handler.js';
import {
  HOUSEHOLD,
  PK,
  makeBudgetItem,
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

function conditionFailure(withItem: boolean): ConditionalCheckFailedException {
  const err = new ConditionalCheckFailedException({
    message: 'The conditional request failed',
    $metadata: {},
  });
  if (withItem) Object.assign(err, { Item: { PK: { S: PK } } });
  return err;
}

/** Routes Query calls: base-table prefix queries vs GSI2 spend queries. */
function mockQueries(spendRows: Array<{ amountMinor: number }>): void {
  ddbMock.on(QueryCommand).callsFake((input: Record<string, unknown>) => {
    if (input['IndexName'] === 'GSI2') {
      return { Items: spendRows };
    }
    const values = input['ExpressionAttributeValues'] as Record<string, unknown>;
    const prefix = values[':prefix'];
    if (prefix === 'BUDGET#') {
      return { Items: [makeBudgetItem('groceries', 50000)] };
    }
    if (prefix === 'CATEGORY#') {
      return { Items: [makeCategoryItem('groceries', 'EXPENSE', { name: 'Groceries' })] };
    }
    return { Items: [] };
  });
}

describe('GET /budgets', () => {
  it('computes spent from GSI2 (negated expense sum) and remaining from the limit', async () => {
    mockQueries([{ amountMinor: -2500 }, { amountMinor: -1000 }]);
    const res = await handler(makeEvent({ routeKey: 'GET /budgets' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody<ListBudgetsResponse>(res);
    expect(body.items).toHaveLength(1);
    const budget = body.items[0]!;
    expect(budget.categoryId).toBe('groceries');
    expect(budget.categoryName).toBe('Groceries');
    expect(budget.limit).toBe('500.00');
    expect(budget.spentMinor).toBe(3500);
    expect(budget.spent).toBe('35.00');
    expect(budget.remainingMinor).toBe(46500);
    expect(budget.remaining).toBe('465.00');

    const gsi2Call = ddbMock
      .commandCalls(QueryCommand)
      .find((call) => call.args[0].input.IndexName === 'GSI2')!;
    expect(gsi2Call.args[0].input.ExpressionAttributeValues).toMatchObject({
      ':pk': `USER#${HOUSEHOLD}#CAT#groceries`,
    });
  });
});

// ---------------------------------------------------------------------------
// P11-3: each budget sums GSI2 over periodWindow(budget.period) instead of the
// hardcoded current month. The DDB mock cannot range-filter rows the way
// DynamoDB does, so the proof that the route narrows to the right window is the
// GSI2 query's date BETWEEN bounds (:start/:end) plus the DTO periodFrom/To —
// both must equal periodWindow(period) (the shared single source of truth).
// ---------------------------------------------------------------------------

/**
 * Mock a single budget of `period` (or no period attr when `period` is
 * undefined, the pre-Phase-11 back-compat case) plus its spend rows, and run
 * GET /budgets. Returns the response, the parsed budget DTO, and the GSI2
 * query's date-range bounds so a test can assert the window.
 */
async function getSingleBudget(
  period: BudgetPeriod | undefined,
  spendRows: Array<{ amountMinor: number }>,
): Promise<{
  budget: ListBudgetsResponse['items'][number];
  bounds: { start: string; end: string };
}> {
  const overrides: Record<string, unknown> = {};
  if (period === undefined) {
    // Strip the helper's default 'monthly' to model a budget stored with no
    // period attribute at all.
    overrides['period'] = undefined;
  } else {
    overrides['period'] = period;
  }
  ddbMock.on(QueryCommand).callsFake((input: Record<string, unknown>) => {
    if (input['IndexName'] === 'GSI2') {
      return { Items: spendRows };
    }
    const values = input['ExpressionAttributeValues'] as Record<string, unknown>;
    if (values[':prefix'] === 'BUDGET#') {
      const item = makeBudgetItem('groceries', 50000, overrides);
      if (period === undefined) {
        delete (item as Record<string, unknown>)['period'];
      }
      return { Items: [item] };
    }
    if (values[':prefix'] === 'CATEGORY#') {
      return { Items: [makeCategoryItem('groceries', 'EXPENSE', { name: 'Groceries' })] };
    }
    return { Items: [] };
  });

  const res = await handler(makeEvent({ routeKey: 'GET /budgets' }));
  expect(res.statusCode).toBe(200);
  const body = parseBody<ListBudgetsResponse>(res);
  const gsi2Input = ddbMock
    .commandCalls(QueryCommand)
    .find((call) => call.args[0].input.IndexName === 'GSI2')!.args[0].input;
  const values = gsi2Input.ExpressionAttributeValues as Record<string, string>;
  return {
    budget: body.items[0]!,
    bounds: { start: values[':start']!, end: values[':end']! },
  };
}

describe('GET /budgets — per-period spend window (P11-3)', () => {
  it('weekly sums only this-week rows: GSI2 range + DTO window are this calendar week', async () => {
    const expected = periodWindow('weekly', new Date(), 'America/New_York');
    const expectedBounds = gsiDateRangeBounds(expected.from, expected.to);
    const { budget, bounds } = await getSingleBudget('weekly', [
      { amountMinor: -1200 },
      { amountMinor: -800 },
    ]);
    expect(budget.period).toBe('weekly');
    expect(budget.periodFrom).toBe(expected.from);
    expect(budget.periodTo).toBe(expected.to);
    // The GSI2 query is constrained to the week, so DynamoDB returns only
    // this-week rows; the route sums exactly what it queried.
    expect(bounds.start).toBe(expectedBounds.start);
    expect(bounds.end).toBe(expectedBounds.end);
    expect(budget.spentMinor).toBe(2000);
  });

  it('yearly sums the whole year: GSI2 range + DTO window are Jan 1 .. Dec 31', async () => {
    const expected = periodWindow('yearly', new Date(), 'America/New_York');
    const expectedBounds = gsiDateRangeBounds(expected.from, expected.to);
    const { budget, bounds } = await getSingleBudget('yearly', [{ amountMinor: -9000 }]);
    expect(budget.period).toBe('yearly');
    expect(budget.periodFrom).toBe(expected.from);
    expect(budget.periodTo).toBe(expected.to);
    expect(expected.from.endsWith('-01-01')).toBe(true);
    expect(expected.to.endsWith('-12-31')).toBe(true);
    expect(bounds.start).toBe(expectedBounds.start);
    expect(bounds.end).toBe(expectedBounds.end);
    expect(budget.spentMinor).toBe(9000);
  });

  it('monthly is unchanged: GSI2 range + DTO window are this calendar month', async () => {
    const expected = periodWindow('monthly', new Date(), 'America/New_York');
    const expectedBounds = gsiDateRangeBounds(expected.from, expected.to);
    const { budget, bounds } = await getSingleBudget('monthly', [{ amountMinor: -3500 }]);
    expect(budget.period).toBe('monthly');
    expect(budget.periodFrom).toBe(expected.from);
    expect(budget.periodTo).toBe(expected.to);
    expect(expected.from.endsWith('-01')).toBe(true);
    expect(bounds.start).toBe(expectedBounds.start);
    expect(bounds.end).toBe(expectedBounds.end);
    expect(budget.spentMinor).toBe(3500);
  });

  it('a budget stored with no period defaults to monthly (pre-Phase-11 back-compat)', async () => {
    const expected = periodWindow('monthly', new Date(), 'America/New_York');
    const expectedBounds = gsiDateRangeBounds(expected.from, expected.to);
    const { budget, bounds } = await getSingleBudget(undefined, [{ amountMinor: -3500 }]);
    expect(budget.period).toBe('monthly');
    expect(budget.periodFrom).toBe(expected.from);
    expect(budget.periodTo).toBe(expected.to);
    // Same window as an explicit monthly budget, so the index range matches too.
    expect(bounds.start).toBe(expectedBounds.start);
    expect(bounds.end).toBe(expectedBounds.end);
    expect(budget.spentMinor).toBe(3500);
  });
});

describe('POST /budgets', () => {
  it('creates the budget with a decimal-string limit and returns 201', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeCategoryItem('groceries', 'EXPENSE') });
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(
      makeEvent({
        routeKey: 'POST /budgets',
        body: { categoryId: 'groceries', limit: '500.00', rollover: true },
      }),
    );
    expect(res.statusCode).toBe(201);
    const putInput = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(putInput.ConditionExpression).toBe('attribute_not_exists(SK)');
    expect(putInput.Item).toMatchObject({
      PK,
      SK: 'BUDGET#groceries',
      limitMinor: 50000,
      rollover: true,
      version: 1,
    });
    const body = parseBody<BudgetResponse>(res);
    expect(body.limitMinor).toBe(50000);
    expect(body.version).toBe(1);
  });

  it('returns 409 ALREADY_EXISTS when the category already has a budget', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeCategoryItem('groceries', 'EXPENSE') });
    ddbMock.on(PutCommand).rejects(conditionFailure(false));
    const res = await handler(
      makeEvent({
        routeKey: 'POST /budgets',
        body: { categoryId: 'groceries', limit: '500.00' },
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('ALREADY_EXISTS');
  });

  it('rejects an unknown category with 400', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(
      makeEvent({ routeKey: 'POST /budgets', body: { categoryId: 'nope', limit: '1.00' } }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('persists an explicit weekly period and echoes its window in the DTO (P11-3)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeCategoryItem('coffee', 'EXPENSE') });
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(
      makeEvent({
        routeKey: 'POST /budgets',
        body: { categoryId: 'coffee', limit: '45.00', period: 'weekly' },
      }),
    );
    expect(res.statusCode).toBe(201);
    const putInput = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(putInput.Item).toMatchObject({ SK: 'BUDGET#coffee', period: 'weekly' });
    const expected = periodWindow('weekly', new Date(), 'America/New_York');
    const body = parseBody<BudgetResponse>(res);
    expect(body.period).toBe('weekly');
    expect(body.periodFrom).toBe(expected.from);
    expect(body.periodTo).toBe(expected.to);
  });

  it('defaults an absent period to monthly (existing clients unchanged, P11-3)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeCategoryItem('groceries', 'EXPENSE') });
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(
      makeEvent({
        routeKey: 'POST /budgets',
        body: { categoryId: 'groceries', limit: '500.00' },
      }),
    );
    expect(res.statusCode).toBe(201);
    const putInput = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    expect(putInput.Item).toMatchObject({ period: 'monthly' });
    expect(parseBody<BudgetResponse>(res).period).toBe('monthly');
  });

  it('rejects an unknown period with 400 before writing (P11-3)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: makeCategoryItem('groceries', 'EXPENSE') });
    const res = await handler(
      makeEvent({
        routeKey: 'POST /budgets',
        body: { categoryId: 'groceries', limit: '500.00', period: 'daily' },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});

describe('PUT/PATCH /budgets/{categoryId}', () => {
  it.each(['PUT /budgets/{categoryId}', 'PATCH /budgets/{categoryId}'])(
    '%s applies a version-conditional update',
    async (routeKey) => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: makeBudgetItem('groceries', 60000, { version: 3 }),
      });
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      ddbMock.on(GetCommand).resolves({
        Item: makeCategoryItem('groceries', 'EXPENSE', { name: 'Groceries' }),
      });
      const res = await handler(
        makeEvent({
          routeKey,
          pathParameters: { categoryId: 'groceries' },
          body: { limit: '600.00', version: 2 },
        }),
      );
      expect(res.statusCode).toBe(200);
      const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
      expect(input.ConditionExpression).toBe('attribute_exists(PK) AND #version = :version');
      expect(input.ExpressionAttributeValues).toMatchObject({
        ':version': 2,
        ':nextVersion': 3,
        ':limitMinor': 60000,
      });
      const body = parseBody<BudgetResponse>(res);
      expect(body.version).toBe(3);
    },
  );

  it('returns 409 VERSION_CONFLICT on a version mismatch', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailure(true));
    const res = await handler(
      makeEvent({
        routeKey: 'PATCH /budgets/{categoryId}',
        pathParameters: { categoryId: 'groceries' },
        body: { limit: '600.00', version: 1 },
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VERSION_CONFLICT');
  });

  it('returns 404 when the budget does not exist', async () => {
    ddbMock.on(UpdateCommand).rejects(conditionFailure(false));
    const res = await handler(
      makeEvent({
        routeKey: 'PATCH /budgets/{categoryId}',
        pathParameters: { categoryId: 'groceries' },
        body: { rollover: true, version: 1 },
      }),
    );
    expect(res.statusCode).toBe(404);
  });

  it('requires the version field', async () => {
    const res = await handler(
      makeEvent({
        routeKey: 'PATCH /budgets/{categoryId}',
        pathParameters: { categoryId: 'groceries' },
        body: { limit: '600.00' },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it('persists a period change and the DTO window follows the new period (P11-3)', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: makeBudgetItem('coffee', 45000, { version: 2, period: 'weekly' }),
    });
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(GetCommand).resolves({
      Item: makeCategoryItem('coffee', 'EXPENSE', { name: 'Coffee' }),
    });
    const res = await handler(
      makeEvent({
        routeKey: 'PATCH /budgets/{categoryId}',
        pathParameters: { categoryId: 'coffee' },
        body: { period: 'weekly', version: 1 },
      }),
    );
    expect(res.statusCode).toBe(200);
    const input = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).toContain('#period = :period');
    expect(input.ExpressionAttributeNames).toMatchObject({ '#period': 'period' });
    expect(input.ExpressionAttributeValues).toMatchObject({ ':period': 'weekly' });
    const expected = periodWindow('weekly', new Date(), 'America/New_York');
    const body = parseBody<BudgetResponse>(res);
    expect(body.period).toBe('weekly');
    expect(body.periodFrom).toBe(expected.from);
    expect(body.periodTo).toBe(expected.to);
  });

  it('rejects an unknown period with 400 before writing (P11-3)', async () => {
    const res = await handler(
      makeEvent({
        routeKey: 'PATCH /budgets/{categoryId}',
        pathParameters: { categoryId: 'groceries' },
        body: { period: 'fortnightly', version: 1 },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});

describe('DELETE /budgets/{categoryId}', () => {
  it('deletes and returns 204', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    const res = await handler(
      makeEvent({
        routeKey: 'DELETE /budgets/{categoryId}',
        pathParameters: { categoryId: 'groceries' },
      }),
    );
    expect(res.statusCode).toBe(204);
    expect(res.body).toBeUndefined();
  });

  it('returns 404 when absent', async () => {
    ddbMock.on(DeleteCommand).rejects(conditionFailure(false));
    const res = await handler(
      makeEvent({
        routeKey: 'DELETE /budgets/{categoryId}',
        pathParameters: { categoryId: 'groceries' },
      }),
    );
    expect(res.statusCode).toBe(404);
  });
});
