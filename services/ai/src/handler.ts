/**
 * AI insights Lambda entry points.
 *
 *  - `handler`               categorizes uncategorized transactions; invoked
 *                            after each sync run via EventBridge. Rules first
 *                            (free, deterministic), Bedrock second and only
 *                            for the residual the rules cannot classify.
 *  - `monthlySummaryHandler` generates the monthly cashflow narrative from
 *                            pre-computed rollups; invoked by a monthly
 *                            EventBridge schedule.
 *
 * Both degrade gracefully: any Bedrock failure leaves transactions
 * uncategorized / skips the summary write and never breaks sync or reads.
 * Token usage and call counts are emitted as EMF metrics on every run.
 */

import {
  categorizeResidual,
  filterConfident,
  buildSummaryRequest,
  parseSummaryResponse,
  emptyUsage,
  addUsage,
  isModelAccessError,
} from './bedrock.js';
import type {
  CategoryDescriptor,
  CategorySuggestion,
  ModelInvoker,
  ResidualTxn,
  TokenUsage,
} from './bedrock.js';
import { createBedrockInvoker } from './bedrockClient.js';
import { loadConfig } from './config.js';
import type { AiConfig } from './config.js';
import { emitBedrockRunMetrics } from './metrics.js';
import { convertRuleRecords } from './ruleSource.js';
import { createStore } from './store.js';
import type { GoldFinchStore } from './store.js';
import {
  averageRollups,
  buildInsightSummaryItem,
  buildSummaryUserPrompt,
  computeInputDigest,
  computeMonthRollups,
  monthOf,
  monthRange,
  addMonths,
  previousMonth,
  assertIsoMonth,
} from './summary.js';

import { parseTxnSk } from '@goldfinch/shared/keys';
import { createLogger } from '@goldfinch/shared/logger';
import type { Logger } from '@goldfinch/shared/logger';
import { toCurrencyDecimalString } from '@goldfinch/shared/money';
import { findMatchingRule, ruleMarksTransfer } from '@goldfinch/shared/rules';
import type {
  CategoryItem,
  IsoDate,
  IsoMonth,
  IsoTimestamp,
  TransactionItem,
} from '@goldfinch/shared/types';

// ---------------------------------------------------------------------------
// Events and results.
// ---------------------------------------------------------------------------

export interface CategorizeEvent {
  household?: string;
  /** Explicit window; defaults to [today - lookbackDays, today]. */
  from?: IsoDate;
  to?: IsoDate;
  lookbackDays?: number;
  /** When true, nothing is written and Bedrock is still consulted normally. */
  dryRun?: boolean;
}

export interface CategorizeResult {
  window: { from: IsoDate; to: IsoDate };
  scanned: number;
  ruleCategorized: number;
  aiSuggested: number;
  aiApplied: number;
  aiRejectedLowConfidence: number;
  /** Conditional writes refused because a user edit won the race. */
  writeConflicts: number;
  leftUncategorized: number;
  bedrockCalls: number;
  /**
   * True when the residual pass was skipped because Bedrock model access is
   * not granted yet (AccessDeniedException / model-not-enabled). The rules
   * pass still completed; this is a warning, not a failure.
   */
  modelAccessDenied: boolean;
  usage: TokenUsage;
  dryRun: boolean;
  errors: string[];
}

export interface MonthlySummaryEvent {
  household?: string;
  /** yyyy-mm; defaults to the previous calendar month (UTC). */
  month?: IsoMonth;
  /** Regenerate even when the input digest is unchanged. */
  force?: boolean;
}

export interface MonthlySummaryResult {
  month: IsoMonth;
  /** True when no Bedrock call was needed (unchanged digest or failure). */
  skipped: boolean;
  narrative?: string;
  inputDigest: string;
  bedrockCalls: number;
  usage: TokenUsage;
  errors: string[];
}

/** Injectable dependencies (tests pass fakes; Lambda uses the defaults). */
export interface HandlerDeps {
  config: AiConfig;
  store: GoldFinchStore;
  invoker: ModelInvoker;
  logger?: Logger;
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

function isoTimestamp(date: Date): IsoTimestamp {
  return `${date.toISOString().slice(0, 19)}Z`;
}

function isoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

function isoDateDaysAgo(date: Date, days: number): IsoDate {
  const shifted = new Date(date.getTime() - days * 86_400_000);
  return isoDate(shifted);
}

/** EventBridge wraps custom payloads in `detail`; accept both shapes. */
function unwrapDetail<T>(event: unknown): T {
  if (typeof event === 'object' && event !== null) {
    const candidate = event as Record<string, unknown>;
    if (typeof candidate['detail'] === 'object' && candidate['detail'] !== null) {
      return candidate['detail'] as T;
    }
    return event as T;
  }
  return {} as T;
}

function toDescriptor(category: CategoryItem): CategoryDescriptor {
  return { categoryId: category.categoryId, name: category.name, type: category.type };
}

function descriptorMap(
  categories: readonly CategoryItem[],
): Map<string, CategoryDescriptor> {
  const map = new Map<string, CategoryDescriptor>();
  for (const category of categories) {
    map.set(category.categoryId, toDescriptor(category));
  }
  return map;
}

let defaultDeps: HandlerDeps | undefined;

function resolveDeps(): HandlerDeps {
  if (defaultDeps === undefined) {
    const config = loadConfig();
    defaultDeps = {
      config,
      store: createStore({ tableName: config.tableName, household: config.household }),
      invoker: createBedrockInvoker({ modelId: config.modelId, region: config.region }),
      logger: createLogger({ base: { service: 'ai' } }),
    };
  }
  return defaultDeps;
}

// ---------------------------------------------------------------------------
// Categorization run.
// ---------------------------------------------------------------------------

export async function runCategorization(
  event: CategorizeEvent,
  deps: HandlerDeps,
): Promise<CategorizeResult> {
  const { config, store, invoker } = deps;
  const logger = deps.logger ?? createLogger({ base: { service: 'ai' } });
  const now = (deps.now ?? (() => new Date()))();
  const to = event.to ?? isoDate(now);
  const from =
    event.from ?? isoDateDaysAgo(now, event.lookbackDays ?? config.lookbackDays);
  const dryRun = event.dryRun === true;

  const [categories, ruleRecords] = await Promise.all([
    store.loadCategories(),
    store.loadRules(),
  ]);
  // Rules and AI may only assign live categories; archived ones stay resolvable
  // for history but never receive new transactions.
  const activeCategories = categories.filter((c) => !c.archived);
  const categoriesById = descriptorMap(activeCategories);
  // Shared matcher (the single precedence implementation); legacy
  // CATEGORY_RULE items are converted, never re-matched locally.
  const { specs: ruleSpecs, dropped: rulesDropped } = convertRuleRecords(ruleRecords);
  if (rulesDropped > 0) {
    logger.warn('dropped structurally invalid rule records', {
      dropped: rulesDropped,
      loaded: ruleRecords.length,
    });
  }

  const txns = await store.queryUncategorizedTransactions(from, to);

  const result: CategorizeResult = {
    window: { from, to },
    scanned: txns.length,
    ruleCategorized: 0,
    aiSuggested: 0,
    aiApplied: 0,
    aiRejectedLowConfidence: 0,
    writeConflicts: 0,
    leftUncategorized: 0,
    bedrockCalls: 0,
    modelAccessDenied: false,
    usage: emptyUsage(),
    dryRun,
    errors: [],
  };

  // Pass 1: deterministic rules (zero token cost) via the shared matcher.
  const residual: TransactionItem[] = [];
  for (const txn of txns) {
    // Defense in depth: the query filter already excludes user-categorized and
    // already-categorized rows; never rule- or AI-touch one that slips through.
    if (txn.userCategorized === true || (txn.categoryId !== null && txn.categoryId !== undefined)) {
      continue;
    }
    let match;
    try {
      match = findMatchingRule(ruleSpecs, {
        payeeLower: txn.payeeLower ?? txn.payee.toLowerCase(),
        amountMinor: txn.amountMinor,
      });
    } catch (error) {
      // A corrupted row (e.g. non-integer amountMinor) must not crash the run
      // or be shipped to Bedrock; it stays uncategorized and is logged.
      logger.error('rule matching failed for transaction; leaving uncategorized', {
        txnSk: txn.SK,
        error,
      });
      result.errors.push(`rule matching failed for ${txn.SK}: ${String(error)}`);
      continue;
    }
    const category = match !== null ? categoriesById.get(match.categoryId) : undefined;
    if (match === null || category === undefined) {
      // Transfers never go to the model; they are not spend/income to label
      // (they simply remain uncategorized).
      if (!txn.isTransfer) {
        residual.push(txn);
      }
      continue;
    }
    const applied = dryRun
      ? true
      : await store.applyCategory({
          txnSk: txn.SK,
          categoryId: category.categoryId,
          source: 'rule',
          // The store derives the sparse GSI2 spend-index keys from these via
          // the shared computeGsi2Keys rule (transfers never index as spend).
          categoryType: category.type,
          // Honor the rule's transfer-marking ACTION (parity with the API
          // apply-now route): a markTransfer rule sets isTransfer=true so the
          // row is evicted from the spend index and excluded by either signal,
          // even if it already carried isTransfer=false.
          isTransfer: txn.isTransfer === true || ruleMarksTransfer(match),
          now: isoTimestamp(now),
        });
    if (applied) {
      result.ruleCategorized += 1;
    } else {
      result.writeConflicts += 1;
    }
  }

  // Pass 2: Bedrock for the residual, batched, hard-capped.
  if (residual.length > 0 && activeCategories.length > 0) {
    const residualBySk = new Map(residual.map((t) => [parseTxnSk(t.SK).txnId, t]));
    const residualTxns: ResidualTxn[] = residual.map((t) => ({
      txnId: parseTxnSk(t.SK).txnId,
      payee: t.payee,
      amount: toCurrencyDecimalString(t.amountMinor, t.currency),
    }));
    const run = await categorizeResidual(
      residualTxns,
      activeCategories.map(toDescriptor),
      invoker,
      {
        batchSize: config.batchSize,
        maxCalls: config.maxBedrockCallsPerRun,
        maxTokens: config.categorizeMaxTokens,
      },
    );
    result.bedrockCalls = run.bedrockCalls;
    result.usage = run.usage;
    result.errors.push(...run.errors);
    result.modelAccessDenied = run.modelAccessDenied;
    result.aiSuggested = run.suggestions.length;

    // P7-5 graceful degradation: model access not granted in the Bedrock
    // console is a known deploy-time state, not a fault. One structured
    // warning, residual pass skipped, rules pass already complete -- and the
    // handler returns normally so EventBridge never retries into a crash loop.
    if (run.modelAccessDenied) {
      logger.warn(
        'bedrock model access not granted; skipping residual categorization pass',
        {
          modelId: config.modelId,
          batchesSkipped: run.batchesSkipped,
          txnsSkipped: run.txnsSkipped,
          ruleCategorized: result.ruleCategorized,
          errors: run.errors,
        },
      );
    } else if (run.errors.length > 0) {
      logger.error('bedrock categorization reported errors', {
        modelId: config.modelId,
        bedrockCalls: run.bedrockCalls,
        parseFailures: run.parseFailures,
        batchesSkipped: run.batchesSkipped,
        txnsSkipped: run.txnsSkipped,
        errors: run.errors,
      });
    }

    const confident: CategorySuggestion[] = filterConfident(
      run.suggestions,
      config.confidenceThreshold,
    );
    result.aiRejectedLowConfidence = run.suggestions.length - confident.length;

    for (const suggestion of confident) {
      const txn = residualBySk.get(suggestion.txnId);
      const category = categoriesById.get(suggestion.categoryId);
      if (txn === undefined || category === undefined) {
        continue;
      }
      const applied = dryRun
        ? true
        : await store.applyCategory({
            txnSk: txn.SK,
            categoryId: category.categoryId,
            source: 'ai',
            categoryType: category.type,
            isTransfer: txn.isTransfer === true,
            now: isoTimestamp(now),
            aiConfidence: suggestion.confidence,
            aiModel: config.modelId,
          });
      if (applied) {
        result.aiApplied += 1;
      } else {
        result.writeConflicts += 1;
      }
    }
  }

  result.leftUncategorized =
    result.scanned - result.ruleCategorized - result.aiApplied - result.writeConflicts;

  emitBedrockRunMetrics(
    'categorize',
    { ...result.usage, bedrockCalls: result.bedrockCalls },
    {
      RuleCategorized: result.ruleCategorized,
      AiApplied: result.aiApplied,
      AiRejectedLowConfidence: result.aiRejectedLowConfidence,
      UncategorizedRemaining: result.leftUncategorized,
      WriteConflicts: result.writeConflicts,
      BedrockErrors: result.errors.length,
      ModelAccessDenied: result.modelAccessDenied ? 1 : 0,
    },
    { window: result.window, dryRun, scanned: result.scanned },
  );

  return result;
}

/** Lambda entry point: EventBridge invocation after each sync run. */
export async function handler(event?: unknown): Promise<CategorizeResult> {
  return runCategorization(unwrapDetail<CategorizeEvent>(event), resolveDeps());
}

// ---------------------------------------------------------------------------
// Monthly summary run.
// ---------------------------------------------------------------------------

export async function runMonthlySummary(
  event: MonthlySummaryEvent,
  deps: HandlerDeps,
): Promise<MonthlySummaryResult> {
  const { config, store, invoker } = deps;
  const logger = deps.logger ?? createLogger({ base: { service: 'ai' } });
  const now = (deps.now ?? (() => new Date()))();
  const month = event.month ?? previousMonth(monthOf(isoDate(now)));
  assertIsoMonth(month);

  // One range query covers the target month and the trailing three.
  const from = monthRange(addMonths(month, -3)).from;
  const to = monthRange(month).to;
  const [categories, txns] = await Promise.all([
    store.loadCategories(),
    store.queryTransactionsInRange(from, to),
  ]);
  const categoriesById = descriptorMap(categories);

  const byMonth = new Map<IsoMonth, TransactionItem[]>();
  for (const txn of txns) {
    const txnMonth = monthOf(parseTxnSk(txn.SK).date);
    const bucket = byMonth.get(txnMonth);
    if (bucket === undefined) {
      byMonth.set(txnMonth, [txn]);
    } else {
      bucket.push(txn);
    }
  }
  const rollupsFor = (m: IsoMonth) =>
    computeMonthRollups(m, byMonth.get(m) ?? [], categoriesById);
  const current = rollupsFor(month);
  const trailing = averageRollups([
    rollupsFor(addMonths(month, -1)),
    rollupsFor(addMonths(month, -2)),
    rollupsFor(addMonths(month, -3)),
  ]);
  const inputDigest = computeInputDigest({ month, current, trailing });

  const result: MonthlySummaryResult = {
    month,
    skipped: false,
    inputDigest,
    bedrockCalls: 0,
    usage: emptyUsage(),
    errors: [],
  };

  const emit = (extra: Record<string, number>): void => {
    emitBedrockRunMetrics(
      'summarize',
      { ...result.usage, bedrockCalls: result.bedrockCalls },
      extra,
      { month, inputDigest },
    );
  };

  // Idempotency: identical inputs mean the existing narrative still holds.
  const existing = await store.getMonthlySummary(month);
  if (existing !== undefined && existing.inputDigest === inputDigest && event.force !== true) {
    result.skipped = true;
    result.narrative = existing.narrative;
    emit({ SummarySkippedUnchanged: 1 });
    return result;
  }

  const currency = txns.find((t) => !t.pending)?.currency ?? txns[0]?.currency ?? 'USD';
  const userPrompt = buildSummaryUserPrompt(current, trailing, categoriesById, currency);
  const request = buildSummaryRequest(userPrompt, config.summaryMaxTokens);

  try {
    result.bedrockCalls = 1;
    const response = await invoker.invoke(request);
    addUsage(result.usage, response);
    const narrative = parseSummaryResponse(response);
    const item = buildInsightSummaryItem(
      config.household,
      month,
      narrative,
      config.modelId,
      inputDigest,
      isoTimestamp(now),
      result.usage,
    );
    await store.putMonthlySummary(item);
    result.narrative = narrative;
    emit({ SummaryGenerated: 1 });
  } catch (error) {
    // Graceful degradation: no summary item is written, nothing else breaks.
    result.skipped = true;
    result.errors.push(`monthly summary failed: ${String(error)}`);
    if (isModelAccessError(error)) {
      // Same P7-5 case as categorization: one structured warning, no retry storm.
      logger.warn('bedrock model access not granted; skipping monthly summary', {
        modelId: config.modelId,
        month,
        error,
      });
      emit({ SummaryFailures: 1, ModelAccessDenied: 1 });
    } else {
      logger.error('monthly summary failed', { modelId: config.modelId, month, error });
      emit({ SummaryFailures: 1 });
    }
  }
  return result;
}

/** Lambda entry point: monthly EventBridge schedule. */
export async function monthlySummaryHandler(
  event?: unknown,
): Promise<MonthlySummaryResult> {
  return runMonthlySummary(unwrapDetail<MonthlySummaryEvent>(event), resolveDeps());
}

/** Test hook: reset the lazily-built default dependencies. */
export function resetDefaultDeps(): void {
  defaultDeps = undefined;
}
