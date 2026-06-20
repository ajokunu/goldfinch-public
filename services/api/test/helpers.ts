/** Shared test fixtures: synthetic HTTP API v2 events and DynamoDB items. */

import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type {
  AccountItem,
  BudgetItem,
  CategoryItem,
  CategoryType,
  GoalContributionItem,
  GoalItem,
  HoldingBasisItem,
  HoldingItem,
  NetWorthSnapshotItem,
  RecurringSeriesItem,
  RuleItem,
  SyncStateItem,
  TransactionItem,
  UserProfileItem,
} from '@goldfinch/shared/types';

export const HOUSEHOLD = 'goldfinch-home';
export const SUB = 'test-sub';
export const PK = `USER#${HOUSEHOLD}`;

export function setTestEnv(): void {
  process.env.TABLE_NAME = 'GoldFinch';
  process.env.GSI1_NAME = 'GSI1';
  process.env.GSI2_NAME = 'GSI2';
  process.env.DEFAULT_TZ = 'America/New_York';
  process.env.BASE_CURRENCY = 'USD';
  // On-demand sync: the function name POST /sync/run async-invokes (infra
  // sets SYNC_FN_NAME on the API Lambda).
  process.env.SYNC_FN_NAME = 'goldfinch-sync-test';
  // Attachments presigning (P7-9): bucket + static env credentials so the
  // default provider chain resolves from env without touching IMDS/SSO.
  process.env.ATTACHMENTS_BUCKET = 'goldfinch-attachments-test';
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID = 'AKIDEXAMPLE';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
  delete process.env.AWS_SESSION_TOKEN;
}

/**
 * A ConditionalCheckFailedException as the document client surfaces it.
 * `withItem: true` mimics ReturnValuesOnConditionCheckFailure=ALL_OLD finding
 * an existing item (the 409 path); false mimics a missing item (404).
 */
export function conditionFailure(withItem: boolean): ConditionalCheckFailedException {
  const err = new ConditionalCheckFailedException({
    message: 'The conditional request failed',
    $metadata: {},
  });
  if (withItem) {
    Object.assign(err, { Item: { PK: { S: PK } } });
  }
  return err;
}

export interface MakeEventOptions {
  routeKey: string;
  query?: Record<string, string>;
  pathParameters?: Record<string, string>;
  body?: unknown;
  claims?: Record<string, string>;
}

export function makeEvent(
  options: MakeEventOptions,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const { routeKey, query, pathParameters, body, claims } = options;
  const method = routeKey.split(' ')[0] ?? 'GET';
  return {
    version: '2.0',
    routeKey,
    rawPath: '/',
    rawQueryString: '',
    headers: {},
    queryStringParameters: query,
    pathParameters,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'test.example.com',
      domainPrefix: 'test',
      http: {
        method,
        path: '/',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: 'test-request-id',
      routeKey,
      stage: '$default',
      time: '',
      timeEpoch: 0,
      authorizer: {
        principalId: '',
        integrationLatency: 0,
        jwt: {
          claims: claims ?? { household: HOUSEHOLD, sub: SUB, scope: 'goldfinch/api' },
          scopes: ['goldfinch/api'],
        },
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

export function parseBody<T>(result: { body?: string }): T {
  if (result.body === undefined) throw new Error('response has no body');
  return JSON.parse(result.body) as T;
}

export function makeAccountItem(overrides: Partial<AccountItem> & { SK: string }): AccountItem {
  return {
    PK,
    entityType: 'ACCOUNT',
    schemaVersion: 1,
    name: 'Checking',
    accountType: 'checking',
    institution: 'Chase',
    balanceMinor: 523055,
    currency: 'USD',
    balanceDate: 1_749_480_000,
    simplefinAccountId: 'sf-1',
    lastSyncedAt: '2026-06-09T09:00:00.000Z',
    ...overrides,
  } as AccountItem;
}

export function makeTxnItem(
  overrides: Partial<TransactionItem> & { SK: string },
): TransactionItem {
  const accountId = overrides.accountId ?? 'acct-1';
  return {
    PK,
    entityType: 'TRANSACTION',
    schemaVersion: 1,
    amountMinor: -4215,
    currency: 'USD',
    payee: 'Whole Foods Market',
    payeeLower: 'whole foods market',
    categoryId: null,
    accountId,
    pending: false,
    isTransfer: false,
    postedDate: null,
    simplefinTxnId: 'txn-1',
    categorizedBy: null,
    userCategorized: false,
    lastEditedBy: null,
    version: 1,
    GSI1PK: `USER#${HOUSEHOLD}#ACCT#${accountId}`,
    GSI1SK: `${overrides.SK.split('#')[1] ?? '2026-06-01'}#${overrides.SK.split('#')[2] ?? 'txn-1'}`,
    ...overrides,
  } as TransactionItem;
}

export function makeCategoryItem(
  categoryId: string,
  type: CategoryType,
  overrides: Partial<CategoryItem> = {},
): CategoryItem {
  return {
    PK,
    SK: `CATEGORY#${categoryId}`,
    entityType: 'CATEGORY',
    schemaVersion: 1,
    categoryId,
    name: categoryId,
    type,
    groupId: null,
    sortOrder: 100,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as CategoryItem;
}

export function makeBudgetItem(
  categoryId: string,
  limitMinor: number,
  overrides: Partial<BudgetItem> = {},
): BudgetItem {
  return {
    PK,
    SK: `BUDGET#${categoryId}`,
    entityType: 'BUDGET',
    schemaVersion: 1,
    categoryId,
    period: 'monthly',
    limitMinor,
    rollover: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as BudgetItem;
}

// ---------------------------------------------------------------------------
// Phase 7 factories (PHASE7-DECISIONS.md P7-1..P7-9)
// ---------------------------------------------------------------------------

export function makeRecurringItem(
  seriesId: string,
  overrides: Partial<RecurringSeriesItem> = {},
): RecurringSeriesItem {
  return {
    PK,
    SK: `RECURRING#${seriesId}`,
    entityType: 'RECURRING_SERIES',
    schemaVersion: 1,
    seriesId,
    payee: 'Netflix',
    payeeNormalized: 'netflix',
    cadence: 'monthly',
    avgAmountMinor: -1599,
    currency: 'USD',
    lastDate: '2026-05-15',
    nextExpectedDate: '2026-06-15',
    accountId: 'acct-1',
    status: 'detected',
    occurrenceCount: 4,
    createdAt: '2026-05-15T09:00:00.000Z',
    ...overrides,
  } as RecurringSeriesItem;
}

export function makeGoalItem(goalId: string, overrides: Partial<GoalItem> = {}): GoalItem {
  return {
    PK,
    SK: `GOAL#${goalId}`,
    entityType: 'GOAL',
    schemaVersion: 1,
    goalId,
    name: 'Emergency fund',
    targetMinor: 1_000_000,
    currency: 'USD',
    targetDate: null,
    fundingMode: 'manual',
    linkedAccountId: null,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as GoalItem;
}

export function makeContributionItem(
  goalId: string,
  contributedAt: string,
  amountMinor: number,
  overrides: Partial<GoalContributionItem> = {},
): GoalContributionItem {
  return {
    PK,
    SK: `CONTRIB#${goalId}#${contributedAt}`,
    entityType: 'GOAL_CONTRIBUTION',
    schemaVersion: 1,
    goalId,
    contributedAt,
    amountMinor,
    currency: 'USD',
    createdBy: SUB,
    createdAt: contributedAt,
    ...overrides,
  } as GoalContributionItem;
}

export function makeHoldingItem(
  accountId: string,
  holdingId: string,
  overrides: Partial<HoldingItem> = {},
): HoldingItem {
  return {
    PK,
    SK: `HOLDING#${accountId}#${holdingId}`,
    entityType: 'HOLDING',
    schemaVersion: 1,
    accountId,
    holdingId,
    symbol: 'VTI',
    description: 'Vanguard Total Stock Market ETF',
    shares: '12.5',
    marketValueMinor: 350_000,
    currency: 'USD',
    asOf: 1_749_480_000,
    lastSyncedAt: '2026-06-09T09:00:00.000Z',
    ...overrides,
  } as HoldingItem;
}

export function makeHoldingBasisItem(
  accountId: string,
  symbol: string,
  costBasisMinor: number,
  overrides: Partial<HoldingBasisItem> = {},
): HoldingBasisItem {
  return {
    PK,
    SK: `HOLDINGBASIS#${accountId}#${symbol}`,
    entityType: 'HOLDING_BASIS',
    schemaVersion: 1,
    accountId,
    symbol,
    costBasisMinor,
    currency: 'USD',
    createdBy: SUB,
    createdAt: '2026-06-09T09:00:00.000Z',
    version: 1,
    ...overrides,
  } as HoldingBasisItem;
}

export function makeNetWorthItem(
  date: string,
  overrides: Partial<NetWorthSnapshotItem> = {},
): NetWorthSnapshotItem {
  return {
    PK,
    SK: `NETWORTH#${date}`,
    entityType: 'NETWORTH_SNAPSHOT',
    schemaVersion: 1,
    date,
    currency: 'USD',
    assetsMinor: 1_773_055,
    liabilitiesMinor: 685_000,
    netMinor: 1_088_055,
    perCurrency: {
      USD: { assetsMinor: 1_773_055, liabilitiesMinor: 685_000, netMinor: 1_088_055 },
    },
    createdAt: `${date}T09:00:00.000Z`,
    ...overrides,
  } as NetWorthSnapshotItem;
}

export function makeProfileItem(
  sub: string,
  overrides: Partial<UserProfileItem> = {},
): UserProfileItem {
  return {
    PK,
    SK: `PROFILE#${sub}`,
    entityType: 'USER',
    schemaVersion: 1,
    cognitoSub: sub,
    displayName: 'Alex',
    baseCurrency: 'USD',
    householdId: HOUSEHOLD,
    createdAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  } as UserProfileItem;
}

// ---------------------------------------------------------------------------
// Phase 8 factories (ops/PHASE8-DECISIONS.md)
// ---------------------------------------------------------------------------

/**
 * SYNC#STATE singleton as services/sync/src/state.ts writes it: ISO-8601 run
 * timestamps, epoch-seconds success cursor, per-account status map.
 */
export function makeSyncStateItem(overrides: Partial<SyncStateItem> = {}): SyncStateItem {
  return {
    PK,
    SK: 'SYNC#STATE',
    entityType: 'SYNC_STATE',
    schemaVersion: 1,
    lastRunAt: '2026-06-10T13:00:00.000Z',
    lastRunStatus: 'success',
    lastSuccessEpoch: 1_781_096_400,
    windowStartEpoch: 1_780_000_000,
    perAccount: {
      'acct-1': {
        lastSyncedAt: '2026-06-10T13:00:00.000Z',
        status: 'success',
        txnCount: 12,
      },
    },
    ...overrides,
  } as SyncStateItem;
}

export function makeRuleItem(ruleId: string, overrides: Partial<RuleItem> = {}): RuleItem {
  return {
    PK,
    SK: `RULE#${ruleId}`,
    entityType: 'RULE',
    schemaVersion: 1,
    ruleId,
    matchType: 'contains',
    pattern: 'whole foods',
    categoryId: 'groceries',
    priority: 100,
    enabled: true,
    version: 1,
    createdBy: SUB,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as RuleItem;
}
