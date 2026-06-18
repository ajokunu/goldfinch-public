/**
 * Configuration for the AI insights Lambda (master plan section 11).
 *
 * Every Bedrock-relevant constant lives here so code and IaC reference one
 * source of truth (the "bare-model-ID failure" risk in the plan is mitigated by
 * hard-coding the cross-region inference-profile ID below, never the bare
 * foundation-model ID).
 */

import { HOUSEHOLD_ID } from '@goldfinch/shared/constants';
import { createLogger } from '@goldfinch/shared/logger';

/** Module logger: config parsing happens before the handler builds its own. */
const configLogger = createLogger({ base: { service: 'ai', module: 'config' } });

/**
 * Cross-region inference profile ID for Claude Haiku 4.5 on Bedrock.
 * On-demand invocation of current Claude models REQUIRES the `us.` inference
 * profile ID; the bare `anthropic.claude-haiku-4-5-20251001-v1:0` foundation
 * model ID returns an error for on-demand throughput.
 */
export const DEFAULT_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

/**
 * Bedrock's required Anthropic API version marker. This is distinct from the
 * first-party `anthropic-version: 2023-06-01` header and must not be changed.
 */
export const ANTHROPIC_VERSION = 'bedrock-2023-05-31';

/**
 * Absolute ceiling on InvokeModel calls per Lambda invocation, regardless of
 * environment configuration. This is the cost-control backstop: even a
 * misconfigured `AI_MAX_BEDROCK_CALLS` cannot push a single run past this.
 */
export const MAX_BEDROCK_CALLS_CEILING = 10;

export interface AiConfig {
  /** DynamoDB single-table name. */
  tableName: string;
  /** Household partition (defaults to the shared HOUSEHOLD_ID constant). */
  household: string;
  /** Bedrock inference-profile ID. */
  modelId: string;
  /** AWS region for the bedrock-runtime endpoint. */
  region: string | undefined;
  /** Hard cap on InvokeModel calls per categorization run. */
  maxBedrockCallsPerRun: number;
  /** Residual transactions per InvokeModel call (one call carries many txns). */
  batchSize: number;
  /** max_tokens for a categorization batch (strict JSON, labels only). */
  categorizeMaxTokens: number;
  /** max_tokens for the monthly summary narrative. */
  summaryMaxTokens: number;
  /** AI suggestions below this confidence are discarded (txn stays uncategorized). */
  confidenceThreshold: number;
  /** Default categorization window when the event does not provide one. */
  lookbackDays: number;
}

function intFromEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    // P7-10: a set-but-unparseable env var is a misconfiguration; falling
    // back silently would hide it forever.
    configLogger.warn('env var is not a parseable integer; using fallback', {
      name,
      raw,
      fallback,
    });
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function floatFromEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    // P7-10: same as intFromEnv -- log the misconfiguration, then degrade.
    configLogger.warn('env var is not a parseable number; using fallback', {
      name,
      raw,
      fallback,
    });
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Read configuration from the environment. Numeric values are clamped to safe
 * ranges; the Bedrock call cap can never exceed MAX_BEDROCK_CALLS_CEILING.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const tableName = env['GOLDFINCH_TABLE_NAME'] ?? env['TABLE_NAME'] ?? '';
  return {
    tableName,
    household: env['GOLDFINCH_HOUSEHOLD'] ?? HOUSEHOLD_ID,
    modelId: env['BEDROCK_MODEL_ID'] ?? DEFAULT_MODEL_ID,
    region: env['BEDROCK_REGION'] ?? env['AWS_REGION'],
    maxBedrockCallsPerRun: intFromEnv(
      env,
      'AI_MAX_BEDROCK_CALLS',
      4,
      0,
      MAX_BEDROCK_CALLS_CEILING,
    ),
    batchSize: intFromEnv(env, 'AI_BATCH_SIZE', 12, 1, 50),
    categorizeMaxTokens: intFromEnv(env, 'AI_CATEGORIZE_MAX_TOKENS', 512, 64, 2048),
    summaryMaxTokens: intFromEnv(env, 'AI_SUMMARY_MAX_TOKENS', 600, 64, 2048),
    confidenceThreshold: floatFromEnv(env, 'AI_CONFIDENCE_THRESHOLD', 0.8, 0, 1),
    lookbackDays: intFromEnv(env, 'AI_LOOKBACK_DAYS', 30, 1, 366),
  };
}
