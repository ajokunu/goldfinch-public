/**
 * Categorization-run wiring tests with fully fake dependencies. Focus areas:
 *
 *  - transfer handling: transfers may be categorized by rules but must reach
 *    the store with isTransfer=true (so the shared GSI2 rule keeps them out of
 *    the spend index), and they must never be sent to Bedrock;
 *  - the shared RULE# contract: handler consumes the @goldfinch/shared/rules
 *    matcher over converted records (shared RULE items + legacy
 *    CATEGORY_RULE items during the migration window);
 *  - P7-5 graceful degradation: AccessDeniedException / model-not-enabled
 *    emits ONE structured warning, skips the residual pass, and never throws
 *    -- the rules pass still completes.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLogger } from '@goldfinch/shared/logger';
import type { LogLevel } from '@goldfinch/shared/logger';
import type { CategoryItem, RuleItem, TransactionItem } from '@goldfinch/shared/types';

import type { ModelInvoker } from '../src/bedrock.js';
import type { AiConfig } from '../src/config.js';
import { runCategorization, runMonthlySummary } from '../src/handler.js';
import type { LegacyCategoryRuleItem, RuleRecord } from '../src/ruleSource.js';
import type { ApplyCategoryInput, GoldFinchStore } from '../src/store.js';

const HOUSEHOLD = 'goldfinch-home';
const PK = `USER#${HOUSEHOLD}`;

const config: AiConfig = {
  tableName: 'GoldFinch',
  household: HOUSEHOLD,
  modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  region: 'us-east-1',
  maxBedrockCallsPerRun: 4,
  batchSize: 12,
  categorizeMaxTokens: 512,
  summaryMaxTokens: 600,
  confidenceThreshold: 0.8,
  lookbackDays: 30,
};

function makeCategory(categoryId: string, type: CategoryItem['type']): CategoryItem {
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
    createdAt: '2026-01-01T00:00:00Z',
  } as CategoryItem;
}

/** Shared-contract rule item (RULE#<ruleId>, entityType RULE). */
function makeRule(
  ruleId: string,
  matchType: RuleItem['matchType'],
  pattern: string,
  categoryId: string,
  overrides: Partial<RuleItem> = {},
): RuleItem {
  return {
    PK,
    SK: `RULE#${ruleId}`,
    entityType: 'RULE',
    schemaVersion: 1,
    ruleId,
    matchType,
    pattern,
    categoryId,
    priority: 100,
    enabled: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as RuleItem;
}

/** Legacy services/ai rule item (RULE#<matchType>#<PATTERN>, CATEGORY_RULE). */
function makeLegacyRule(
  matchType: LegacyCategoryRuleItem['matchType'],
  pattern: string,
  categoryId: string,
): LegacyCategoryRuleItem {
  return {
    SK: `RULE#${matchType}#${pattern}`,
    entityType: 'CATEGORY_RULE',
    matchType,
    pattern,
    categoryId,
  };
}

function makeTxn(
  txnId: string,
  payee: string,
  overrides: Partial<TransactionItem> = {},
): TransactionItem {
  return {
    PK,
    SK: `TXN#2026-05-10#${txnId}`,
    entityType: 'TRANSACTION',
    schemaVersion: 1,
    amountMinor: -125000,
    currency: 'USD',
    payee,
    payeeLower: payee.toLowerCase(),
    categoryId: null,
    accountId: 'acct-1',
    pending: false,
    isTransfer: false,
    postedDate: '2026-05-10',
    simplefinTxnId: txnId,
    categorizedBy: null,
    userCategorized: false,
    lastEditedBy: null,
    version: 1,
    GSI1PK: `${PK}#ACCT#acct-1`,
    GSI1SK: `2026-05-10#${txnId}`,
    createdAt: '2026-05-10T12:00:00Z',
    updatedAt: '2026-05-10T12:00:00Z',
    ...overrides,
  } as TransactionItem;
}

interface FakeStoreSetup {
  categories: CategoryItem[];
  rules: RuleRecord[];
  txns: TransactionItem[];
  applied: ApplyCategoryInput[];
}

function fakeStore(setup: FakeStoreSetup): GoldFinchStore {
  return {
    loadCategories: async () => setup.categories,
    loadRules: async () => setup.rules,
    queryUncategorizedTransactions: async () => setup.txns,
    queryTransactionsInRange: async () => setup.txns,
    applyCategory: async (input) => {
      setup.applied.push(input);
      return true;
    },
    getMonthlySummary: async () => undefined,
    putMonthlySummary: async () => undefined,
  };
}

const neverInvoker: ModelInvoker = {
  invoke: async () => {
    throw new Error('Bedrock must not be called in this test');
  },
};

interface CapturedLog {
  level: LogLevel;
  line: string;
}

function captureLogger(captured: CapturedLog[]) {
  return createLogger({
    level: 'debug',
    base: { service: 'ai' },
    sink: (level, line) => captured.push({ level, line }),
  });
}

describe('runCategorization transfer handling', () => {
  it('rule-categorizes a transfer with isTransfer=true so it never indexes as spend', async () => {
    const applied: ApplyCategoryInput[] = [];
    const store = fakeStore({
      categories: [makeCategory('creditcard', 'EXPENSE')],
      rules: [makeRule('r-epay', 'exact', 'chase credit crd epay', 'creditcard')],
      txns: [makeTxn('t1', 'Chase Credit Crd Epay', { isTransfer: true })],
      applied,
    });

    const result = await runCategorization({}, { config, store, invoker: neverInvoker });

    assert.equal(result.ruleCategorized, 1);
    assert.equal(result.bedrockCalls, 0);
    assert.equal(applied.length, 1);
    const input = applied[0]!;
    assert.equal(input.source, 'rule');
    assert.equal(input.categoryId, 'creditcard');
    assert.equal(input.categoryType, 'EXPENSE');
    assert.equal(input.isTransfer, true);
  });

  it('passes isTransfer=false for a normal expense', async () => {
    const applied: ApplyCategoryInput[] = [];
    const store = fakeStore({
      categories: [makeCategory('groceries', 'EXPENSE')],
      rules: [makeRule('r-wf', 'contains', 'whole foods', 'groceries')],
      txns: [makeTxn('t2', 'Whole Foods Market')],
      applied,
    });

    const result = await runCategorization({}, { config, store, invoker: neverInvoker });

    assert.equal(result.ruleCategorized, 1);
    assert.equal(applied[0]!.isTransfer, false);
    assert.equal(applied[0]!.categoryType, 'EXPENSE');
  });

  it('honors a markTransfer rule: forces isTransfer=true even when the txn was isTransfer=false', async () => {
    // The durability fix -- the daily sync now applies the rule's transfer
    // ACTION, not just its category. Without it, a card-payment SimpleFIN feeds
    // as isTransfer=false would land back in the spend index every sync.
    const applied: ApplyCategoryInput[] = [];
    const store = fakeStore({
      categories: [makeCategory('transfers', 'TRANSFER')],
      rules: [
        makeRule('r-cardpay', 'contains', 'capital one', 'transfers', {
          markTransfer: true,
        }),
      ],
      // isTransfer omitted -> false (the SimpleFIN default for these rows).
      txns: [makeTxn('t1', 'Capital One Payment')],
      applied,
    });

    const result = await runCategorization({}, { config, store, invoker: neverInvoker });

    assert.equal(result.ruleCategorized, 1);
    assert.equal(applied.length, 1);
    const input = applied[0]!;
    assert.equal(input.categoryId, 'transfers');
    assert.equal(input.categoryType, 'TRANSFER');
    // Both transfer signals now coherent: flag forced true, TRANSFER category.
    assert.equal(input.isTransfer, true);
  });

  it('keeps unmatched transfers out of the Bedrock residual entirely', async () => {
    const applied: ApplyCategoryInput[] = [];
    const store = fakeStore({
      categories: [makeCategory('groceries', 'EXPENSE')],
      rules: [],
      txns: [makeTxn('t3', 'Online Transfer To Savings', { isTransfer: true })],
      applied,
    });

    // neverInvoker throws if called; transfers must not reach the model.
    const result = await runCategorization({}, { config, store, invoker: neverInvoker });

    assert.equal(result.bedrockCalls, 0);
    assert.equal(result.aiSuggested, 0);
    assert.equal(result.ruleCategorized, 0);
    assert.equal(applied.length, 0);
    assert.equal(result.leftUncategorized, 1);
    assert.deepEqual(result.errors, []);
  });
});

describe('runCategorization user-override safety (defense in depth)', () => {
  it('never rule-touches or Bedrock-ships a user-categorized or already-categorized txn that slips past the query filter', async () => {
    const applied: ApplyCategoryInput[] = [];
    const store = fakeStore({
      categories: [makeCategory('groceries', 'EXPENSE')],
      // Both rules would match if the guard were missing.
      rules: [makeRule('r-wf', 'contains', 'whole foods', 'groceries')],
      txns: [
        makeTxn('t-user', 'Whole Foods Market', { userCategorized: true }),
        makeTxn('t-done', 'Whole Foods Market', { categoryId: 'dining' }),
      ],
      applied,
    });

    // neverInvoker throws if called; neither row may reach the model either.
    const result = await runCategorization({}, { config, store, invoker: neverInvoker });

    assert.equal(result.ruleCategorized, 0);
    assert.equal(result.bedrockCalls, 0);
    assert.equal(result.aiSuggested, 0);
    assert.equal(applied.length, 0);
    assert.deepEqual(result.errors, []);
  });
});

describe('runCategorization shared RULE# contract', () => {
  it('matches on payeeLower with the shared matcher and falls back to payee.toLowerCase()', async () => {
    const applied: ApplyCategoryInput[] = [];
    const txn = makeTxn('t1', 'Blue Bottle Coffee');
    delete (txn as Partial<TransactionItem>).payeeLower;
    const store = fakeStore({
      categories: [makeCategory('coffee', 'EXPENSE')],
      rules: [makeRule('r-coffee', 'contains', 'blue bottle', 'coffee')],
      txns: [txn],
      applied,
    });

    const result = await runCategorization({}, { config, store, invoker: neverInvoker });

    assert.equal(result.ruleCategorized, 1);
    assert.equal(applied[0]!.categoryId, 'coffee');
  });

  it('consumes legacy CATEGORY_RULE items by lowercasing their patterns', async () => {
    const applied: ApplyCategoryInput[] = [];
    const store = fakeStore({
      categories: [makeCategory('groceries', 'EXPENSE')],
      // Legacy patterns are stored uppercase by the old normalizer.
      rules: [makeLegacyRule('contains', 'WHOLE FOODS', 'groceries')],
      txns: [makeTxn('t1', 'Whole Foods Market 123')],
      applied,
    });

    const result = await runCategorization({}, { config, store, invoker: neverInvoker });

    assert.equal(result.ruleCategorized, 1);
    assert.equal(applied[0]!.categoryId, 'groceries');
  });

  it('a shared exact rule beats a legacy contains rule (precedence is shared-matcher-owned)', async () => {
    const applied: ApplyCategoryInput[] = [];
    const store = fakeStore({
      categories: [makeCategory('coffee', 'EXPENSE'), makeCategory('dining', 'EXPENSE')],
      rules: [
        makeLegacyRule('contains', 'BLUE BOTTLE', 'dining'),
        makeRule('r-exact', 'exact', 'blue bottle coffee', 'coffee'),
      ],
      txns: [makeTxn('t1', 'Blue Bottle Coffee')],
      applied,
    });

    await runCategorization({}, { config, store, invoker: neverInvoker });

    assert.equal(applied.length, 1);
    assert.equal(applied[0]!.categoryId, 'coffee');
  });

  it('respects amount bounds: an out-of-bounds txn goes to the residual instead', async () => {
    const applied: ApplyCategoryInput[] = [];
    const captured: CapturedLog[] = [];
    const store = fakeStore({
      categories: [makeCategory('rent', 'EXPENSE')],
      rules: [
        makeRule('r-rent', 'contains', 'transferwise', 'rent', {
          amountMinMinor: 100000,
          amountMaxMinor: 200000,
        }),
      ],
      // -50.00: below the 1000.00 minimum, so the rule must not fire.
      txns: [makeTxn('t1', 'TransferWise Inc', { amountMinor: -5000 })],
      applied,
    });
    const accessDenied = Object.assign(new Error('no access'), {
      name: 'AccessDeniedException',
    });
    const invoker: ModelInvoker = {
      invoke: async () => {
        throw accessDenied;
      },
    };

    const result = await runCategorization(
      {},
      { config, store, invoker, logger: captureLogger(captured) },
    );

    assert.equal(result.ruleCategorized, 0);
    assert.equal(applied.length, 0);
    // It DID reach the residual pass (one attempted Bedrock call).
    assert.equal(result.bedrockCalls, 1);
  });

  it('disabled rules never categorize', async () => {
    const applied: ApplyCategoryInput[] = [];
    const store = fakeStore({
      categories: [makeCategory('coffee', 'EXPENSE')],
      rules: [makeRule('r-off', 'contains', 'blue bottle', 'coffee', { enabled: false })],
      txns: [makeTxn('t1', 'Blue Bottle Coffee', { isTransfer: true })],
      applied,
    });

    const result = await runCategorization({}, { config, store, invoker: neverInvoker });

    assert.equal(result.ruleCategorized, 0);
    assert.equal(applied.length, 0);
  });

  it('logs a warning when structurally invalid rule records are dropped', async () => {
    const captured: CapturedLog[] = [];
    const store = fakeStore({
      categories: [makeCategory('coffee', 'EXPENSE')],
      rules: [
        { entityType: 'SOMETHING_ELSE' } as unknown as RuleRecord,
        makeRule('r-coffee', 'contains', 'blue bottle', 'coffee'),
      ],
      txns: [makeTxn('t1', 'Blue Bottle Coffee', { isTransfer: true })],
      applied: [],
    });

    const result = await runCategorization(
      {},
      { config, store, invoker: neverInvoker, logger: captureLogger(captured) },
    );

    assert.equal(result.ruleCategorized, 1);
    const warns = captured.filter((l) => l.level === 'warn');
    assert.equal(warns.length, 1);
    assert.match(warns[0]!.line, /invalid rule records/);
  });
});

describe('runCategorization Bedrock graceful degradation (P7-5)', () => {
  function accessDeniedInvoker(calls: { count: number }): ModelInvoker {
    return {
      invoke: async () => {
        calls.count += 1;
        throw Object.assign(
          new Error(
            'You don\'t have access to the model with the specified model ID.',
          ),
          { name: 'AccessDeniedException' },
        );
      },
    };
  }

  it('AccessDeniedException: rules pass completes, residual skipped, one warning, no throw', async () => {
    const applied: ApplyCategoryInput[] = [];
    const captured: CapturedLog[] = [];
    const calls = { count: 0 };
    const store = fakeStore({
      categories: [makeCategory('groceries', 'EXPENSE'), makeCategory('coffee', 'EXPENSE')],
      rules: [makeRule('r-wf', 'contains', 'whole foods', 'groceries')],
      txns: [
        makeTxn('t1', 'Whole Foods Market'),
        // Three residual txns the rules cannot classify.
        makeTxn('t2', 'Mystery Vendor A'),
        makeTxn('t3', 'Mystery Vendor B'),
        makeTxn('t4', 'Mystery Vendor C'),
      ],
      applied,
    });

    // Must resolve, never reject -- EventBridge would otherwise retry forever.
    const result = await runCategorization(
      {},
      { config, store, invoker: accessDeniedInvoker(calls), logger: captureLogger(captured) },
    );

    // Rules pass unaffected.
    assert.equal(result.ruleCategorized, 1);
    assert.equal(applied.length, 1);
    // Residual pass stopped after the first denied call; no per-batch retries.
    assert.equal(calls.count, 1);
    assert.equal(result.bedrockCalls, 1);
    assert.equal(result.aiApplied, 0);
    assert.equal(result.modelAccessDenied, true);
    assert.equal(result.errors.length, 1);
    // Exactly ONE structured warning naming the condition; no error-level noise.
    const warns = captured.filter((l) => l.level === 'warn');
    assert.equal(warns.length, 1);
    const parsed = JSON.parse(warns[0]!.line) as Record<string, unknown>;
    assert.equal(parsed['level'], 'warn');
    assert.match(String(parsed['msg']), /model access not granted/);
    assert.equal(parsed['modelId'], config.modelId);
    assert.equal(captured.filter((l) => l.level === 'error').length, 0);
  });

  it('message-only model-not-enabled errors are classified the same way', async () => {
    const captured: CapturedLog[] = [];
    const store = fakeStore({
      categories: [makeCategory('coffee', 'EXPENSE')],
      rules: [],
      txns: [makeTxn('t1', 'Mystery Vendor')],
      applied: [],
    });
    const invoker: ModelInvoker = {
      invoke: async () => {
        throw new Error('Model anthropic.claude-haiku has not been enabled for this account');
      },
    };

    const result = await runCategorization(
      {},
      { config, store, invoker, logger: captureLogger(captured) },
    );

    assert.equal(result.modelAccessDenied, true);
    assert.equal(captured.filter((l) => l.level === 'warn').length, 1);
  });

  it('other Bedrock failures degrade too but log at error level', async () => {
    const captured: CapturedLog[] = [];
    const store = fakeStore({
      categories: [makeCategory('coffee', 'EXPENSE')],
      rules: [],
      txns: [makeTxn('t1', 'Mystery Vendor')],
      applied: [],
    });
    const invoker: ModelInvoker = {
      invoke: async () => {
        throw Object.assign(new Error('Too many requests'), {
          name: 'ThrottlingException',
        });
      },
    };

    const result = await runCategorization(
      {},
      { config, store, invoker, logger: captureLogger(captured) },
    );

    assert.equal(result.modelAccessDenied, false);
    assert.equal(result.errors.length, 1);
    assert.equal(captured.filter((l) => l.level === 'warn').length, 0);
    assert.equal(captured.filter((l) => l.level === 'error').length, 1);
  });

  it('monthly summary: AccessDeniedException skips the write with one warning, no throw', async () => {
    const captured: CapturedLog[] = [];
    const puts: unknown[] = [];
    const store: GoldFinchStore = {
      ...fakeStore({
        categories: [makeCategory('coffee', 'EXPENSE')],
        rules: [],
        txns: [makeTxn('t1', 'Blue Bottle Coffee')],
        applied: [],
      }),
      putMonthlySummary: async (item) => {
        puts.push(item);
      },
    };
    const invoker: ModelInvoker = {
      invoke: async () => {
        throw Object.assign(new Error('no model access'), {
          name: 'AccessDeniedException',
        });
      },
    };

    const result = await runMonthlySummary(
      { month: '2026-05' },
      { config, store, invoker, logger: captureLogger(captured) },
    );

    assert.equal(result.skipped, true);
    assert.equal(result.errors.length, 1);
    assert.equal(puts.length, 0);
    assert.equal(captured.filter((l) => l.level === 'warn').length, 1);
    assert.equal(captured.filter((l) => l.level === 'error').length, 0);
  });
});
