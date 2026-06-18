/**
 * Bedrock (Claude) request building, response parsing, and the batched
 * categorization run with a hard call cap.
 *
 * Pure module: it depends only on the ModelInvoker interface, so every piece
 * of the batching / cap / parsing logic is unit-testable with a mock. The real
 * bedrock-runtime wiring lives in bedrockClient.ts.
 *
 * Wire shape (master plan section 11): native InvokeModel Messages body with
 * `anthropic_version: "bedrock-2023-05-31"`. The stable system prompt
 * (taxonomy + examples + JSON contract) carries a cache_control breakpoint;
 * the volatile transaction batch rides in the user message after it. Output is
 * strict JSON that is JSON.parsed and validated -- never substring-matched.
 */

import type { CategoryType, DecimalString } from '@goldfinch/shared/types';
import { ANTHROPIC_VERSION } from './config.js';

// ---------------------------------------------------------------------------
// Anthropic-on-Bedrock wire types (request/response bodies for InvokeModel).
// ---------------------------------------------------------------------------

export interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicRequestBody {
  anthropic_version: string;
  max_tokens: number;
  temperature?: number;
  system: AnthropicSystemBlock[];
  messages: AnthropicMessage[];
}

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
}

export interface AnthropicResponseBody {
  content?: AnthropicContentBlock[];
  stop_reason?: string | null;
  usage?: AnthropicUsage;
}

/** The single seam between this module and bedrock-runtime. */
export interface ModelInvoker {
  invoke(body: AnthropicRequestBody): Promise<AnthropicResponseBody>;
}

/** Raised when a response is structurally not what the JSON contract demands. */
export class BedrockResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BedrockResponseError';
  }
}

/**
 * Message fragments Bedrock uses when the account has not enabled model
 * access in the console (P7-5 graceful-degradation case). Matched only as a
 * fallback when the typed exception name is unavailable (wrapped errors).
 */
const MODEL_ACCESS_MESSAGE =
  /don'?t have access to the model|model.{0,40}not (?:been )?enabled|enable the model|not authorized to perform.{0,40}bedrock:InvokeModel/i;

/**
 * True for AccessDeniedException / model-not-enabled failures: a deploy-time
 * configuration gap (model access not yet granted in the Bedrock console),
 * not a transient fault. Callers log ONE structured warning and skip the
 * residual pass; the rules pass is unaffected and nothing retries into a
 * crash loop.
 */
export function isModelAccessError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'AccessDeniedException') {
    return true;
  }
  return typeof message === 'string' && MODEL_ACCESS_MESSAGE.test(message);
}

// ---------------------------------------------------------------------------
// Categorization.
// ---------------------------------------------------------------------------

/** One residual (rule-unclassifiable) transaction sent to the model. */
export interface ResidualTxn {
  txnId: string;
  payee: string;
  /** Signed decimal string (expense negative), e.g. "-6.50". Never a float. */
  amount: DecimalString;
  /** Merchant category code when SimpleFIN provides one (it often does not). */
  mcc?: string;
}

export interface CategorySuggestion {
  txnId: string;
  categoryId: string;
  /** 0..1; clamped during parsing. */
  confidence: number;
}

export interface CategoryDescriptor {
  categoryId: string;
  name: string;
  type: CategoryType;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

export function addUsage(total: TokenUsage, response: AnthropicResponseBody): void {
  const usage = response.usage;
  if (usage === undefined) {
    return;
  }
  total.inputTokens += usage.input_tokens ?? 0;
  total.outputTokens += usage.output_tokens ?? 0;
  total.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
  total.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
}

/**
 * Build the stable categorization system prompt: the category taxonomy, one
 * worked example, and the strict JSON contract. Deterministic for a given
 * category list, which keeps the prompt byte-identical across runs (a
 * prerequisite for Bedrock prompt caching; with a small taxonomy the prefix
 * may fall below the model's minimum cacheable size, in which case the
 * cache_control marker is harmless and batching alone bounds cost).
 */
export function buildCategorizationSystemPrompt(
  categories: readonly CategoryDescriptor[],
): string {
  const usable = [...categories].sort((a, b) =>
    a.categoryId.localeCompare(b.categoryId),
  );
  const taxonomy = usable
    .map((c) => `- ${c.categoryId}: ${c.name} (${c.type})`)
    .join('\n');
  const exampleId =
    usable.find((c) => c.type === 'EXPENSE')?.categoryId ??
    usable[0]?.categoryId ??
    'uncategorized';
  return [
    'You categorize personal-finance transactions for a household budget.',
    '',
    'Valid categories (use categoryId values exactly as listed):',
    taxonomy,
    '',
    'The user message is a JSON object: {"transactions":[{"txnId","payee","amount","mcc"?}]}.',
    'Amounts are signed decimal strings; negative means money spent.',
    '',
    'Respond with ONLY a JSON object, no prose, no markdown fences:',
    '{"results":[{"txnId":"<id>","categoryId":"<categoryId>","confidence":<0..1>}]}',
    '',
    'Rules:',
    '- categoryId MUST be one of the listed ids; never invent a category.',
    '- confidence is your calibrated probability the category is correct.',
    '- If you cannot tell what a transaction is, omit it from results entirely.',
    '- Never categorize transfers between own accounts as income or expense.',
    '',
    'Example input:',
    '{"transactions":[{"txnId":"t1","payee":"BLUE BOTTLE COFFEE","amount":"-6.50"}]}',
    'Example output:',
    `{"results":[{"txnId":"t1","categoryId":"${exampleId}","confidence":0.92}]}`,
  ].join('\n');
}

/** Build the InvokeModel body for one residual batch. */
export function buildCategorizationRequest(
  systemPrompt: string,
  batch: readonly ResidualTxn[],
  maxTokens: number,
): AnthropicRequestBody {
  return {
    anthropic_version: ANTHROPIC_VERSION,
    max_tokens: maxTokens,
    temperature: 0,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: JSON.stringify({ transactions: batch }),
      },
    ],
  };
}

function extractText(response: AnthropicResponseBody): string {
  const text = response.content
    ?.filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  if (text === undefined || text.length === 0) {
    throw new BedrockResponseError('response contains no text content');
  }
  return text;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Tolerate accidental wrapping (markdown fence / stray prose) by parsing
    // the outermost {...} span; anything still malformed is rejected.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new BedrockResponseError('response is not JSON');
    }
    try {
      parsed = JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      throw new BedrockResponseError('response is not parseable JSON');
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BedrockResponseError('response JSON is not an object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Parse + validate one categorization response. Suggestions referencing
 * unknown categoryIds or txnIds outside the batch are dropped (the model is
 * never trusted to write arbitrary keys); duplicates keep the first
 * occurrence; confidence is clamped to [0, 1].
 */
export function parseCategorizationResponse(
  response: AnthropicResponseBody,
  validCategoryIds: ReadonlySet<string>,
  batchTxnIds: ReadonlySet<string>,
): CategorySuggestion[] {
  const parsed = parseJsonObject(extractText(response));
  const results = parsed['results'];
  if (!Array.isArray(results)) {
    throw new BedrockResponseError('response JSON has no "results" array');
  }
  const seen = new Set<string>();
  const suggestions: CategorySuggestion[] = [];
  for (const entry of results) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const txnId = row['txnId'];
    const categoryId = row['categoryId'];
    const confidence = row['confidence'];
    if (typeof txnId !== 'string' || typeof categoryId !== 'string') {
      continue;
    }
    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
      continue;
    }
    if (!batchTxnIds.has(txnId) || !validCategoryIds.has(categoryId) || seen.has(txnId)) {
      continue;
    }
    seen.add(txnId);
    suggestions.push({
      txnId,
      categoryId,
      confidence: Math.min(1, Math.max(0, confidence)),
    });
  }
  return suggestions;
}

/** Keep only suggestions at or above the confidence threshold. */
export function filterConfident(
  suggestions: readonly CategorySuggestion[],
  threshold: number,
): CategorySuggestion[] {
  return suggestions.filter((s) => s.confidence >= threshold);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export interface CategorizeRunOptions {
  /** Residual transactions per InvokeModel call. */
  batchSize: number;
  /** Hard cap on InvokeModel calls for this run. */
  maxCalls: number;
  /** max_tokens for each call. */
  maxTokens: number;
}

export interface CategorizeRunResult {
  suggestions: CategorySuggestion[];
  usage: TokenUsage;
  /** InvokeModel calls actually made (always <= maxCalls). */
  bedrockCalls: number;
  /** Batches dropped by the cap or by an availability failure. */
  batchesSkipped: number;
  /** Transactions never sent because their batch was skipped. */
  txnsSkipped: number;
  /** Batches whose response violated the JSON contract. */
  parseFailures: number;
  /**
   * True when the run stopped on AccessDeniedException / model-not-enabled
   * (model access not granted in the Bedrock console). The caller emits one
   * structured warning instead of an error.
   */
  modelAccessDenied: boolean;
  /** Human-readable error notes (Bedrock failure, parse failures). */
  errors: string[];
}

/**
 * Run batched categorization over the residual set.
 *
 * Cost-control invariants:
 * - All transactions in one batch share ONE InvokeModel call.
 * - Never more than `maxCalls` calls per run; overflow batches are skipped and
 *   their transactions stay uncategorized until a later run.
 * - On an invocation error (throttle, outage, IAM) the run STOPS calling
 *   Bedrock; remaining batches are skipped. Graceful degradation: nothing is
 *   written for skipped transactions, the sync/read paths are unaffected.
 * - A contract violation (unparseable JSON) discards only that batch's
 *   results and continues, since the service itself is evidently up.
 */
export async function categorizeResidual(
  txns: readonly ResidualTxn[],
  categories: readonly CategoryDescriptor[],
  invoker: ModelInvoker,
  options: CategorizeRunOptions,
): Promise<CategorizeRunResult> {
  const result: CategorizeRunResult = {
    suggestions: [],
    usage: emptyUsage(),
    bedrockCalls: 0,
    batchesSkipped: 0,
    txnsSkipped: 0,
    parseFailures: 0,
    modelAccessDenied: false,
    errors: [],
  };
  if (txns.length === 0 || categories.length === 0 || options.maxCalls < 1) {
    if (txns.length > 0) {
      result.batchesSkipped = chunk(txns, options.batchSize).length;
      result.txnsSkipped = txns.length;
    }
    return result;
  }

  const systemPrompt = buildCategorizationSystemPrompt(categories);
  const validCategoryIds = new Set(categories.map((c) => c.categoryId));
  const batches = chunk(txns, options.batchSize);

  const skipFrom = (index: number): void => {
    for (let i = index; i < batches.length; i += 1) {
      result.batchesSkipped += 1;
      result.txnsSkipped += batches[i]!.length;
    }
  };

  for (let i = 0; i < batches.length; i += 1) {
    if (result.bedrockCalls >= options.maxCalls) {
      skipFrom(i);
      break;
    }
    const batch = batches[i]!;
    const request = buildCategorizationRequest(systemPrompt, batch, options.maxTokens);
    let response: AnthropicResponseBody;
    try {
      result.bedrockCalls += 1;
      response = await invoker.invoke(request);
    } catch (error) {
      result.modelAccessDenied = isModelAccessError(error);
      result.errors.push(
        `bedrock invocation failed on batch ${i + 1}/${batches.length}: ${String(error)}`,
      );
      // Availability failure: stop calling, leave the rest uncategorized.
      // skipFrom(i) also counts the failed batch itself as skipped.
      skipFrom(i);
      break;
    }
    addUsage(result.usage, response);
    try {
      const batchTxnIds = new Set(batch.map((t) => t.txnId));
      const suggestions = parseCategorizationResponse(
        response,
        validCategoryIds,
        batchTxnIds,
      );
      result.suggestions.push(...suggestions);
    } catch (error) {
      result.parseFailures += 1;
      result.errors.push(
        `bedrock response rejected on batch ${i + 1}/${batches.length}: ${String(error)}`,
      );
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Monthly summary.
// ---------------------------------------------------------------------------

export const SUMMARY_SYSTEM_PROMPT: string = [
  'You write a short monthly cashflow summary for a two-person household.',
  'You are given pre-computed rollups: this month\'s income, spending by',
  'category, and trailing three-month averages. All amounts are exact decimal',
  'strings in the household currency.',
  '',
  'Respond with ONLY a JSON object, no prose outside it, no markdown fences:',
  '{"narrative":"<2-4 sentence plain-text summary>"}',
  '',
  'Rules:',
  '- Mention overall spending vs the trailing average and the one or two',
  '  categories that moved the most.',
  '- Use plain language and round amounts naturally when narrating.',
  '- Never invent numbers that are not derivable from the input.',
  '- No emojis.',
].join('\n');

/** Build the InvokeModel body for the monthly summary. */
export function buildSummaryRequest(
  userPrompt: string,
  maxTokens: number,
): AnthropicRequestBody {
  return {
    anthropic_version: ANTHROPIC_VERSION,
    max_tokens: maxTokens,
    temperature: 0,
    system: [
      {
        type: 'text',
        text: SUMMARY_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  };
}

/** Parse + validate the summary response into the narrative string. */
export function parseSummaryResponse(response: AnthropicResponseBody): string {
  const parsed = parseJsonObject(extractText(response));
  const narrative = parsed['narrative'];
  if (typeof narrative !== 'string' || narrative.trim().length === 0) {
    throw new BedrockResponseError('summary response has no "narrative" string');
  }
  return narrative.trim();
}
