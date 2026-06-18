/**
 * CloudWatch Embedded Metric Format (EMF) emitter.
 *
 * Lambda ships stdout lines to CloudWatch Logs; lines carrying the `_aws`
 * EMF envelope are extracted into CloudWatch metrics with zero API calls and
 * zero extra cost beyond log ingestion. Token usage per run is the
 * load-bearing metric for the Bedrock cost alarm.
 */

export type MetricUnit = 'Count' | 'Milliseconds' | 'None';

export interface MetricDatum {
  name: string;
  value: number;
  unit?: MetricUnit;
}

export interface EmitMetricsOptions {
  /** CloudWatch namespace; defaults to GoldFinch/AI. */
  namespace?: string;
  /** Dimension set applied to every metric in this record. */
  dimensions?: Record<string, string>;
  metrics: readonly MetricDatum[];
  /** Extra non-metric context attached to the log record. */
  properties?: Record<string, unknown>;
  /** Epoch millis; defaults to Date.now(). */
  timestamp?: number;
  /** Injectable sink for tests; defaults to console.log. */
  logger?: (line: string) => void;
}

export const METRIC_NAMESPACE = 'GoldFinch/AI';

/** Emit one EMF record. Invalid (non-finite) metric values are dropped. */
export function emitMetrics(options: EmitMetricsOptions): void {
  const dimensions = options.dimensions ?? {};
  const dimensionNames = Object.keys(dimensions);
  const metrics = options.metrics.filter((m) => Number.isFinite(m.value));
  if (metrics.length === 0) {
    return;
  }
  const record: Record<string, unknown> = {
    _aws: {
      Timestamp: options.timestamp ?? Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: options.namespace ?? METRIC_NAMESPACE,
          Dimensions: [dimensionNames],
          Metrics: metrics.map((m) => ({ Name: m.name, Unit: m.unit ?? 'Count' })),
        },
      ],
    },
    ...dimensions,
    ...(options.properties ?? {}),
  };
  for (const m of metrics) {
    record[m.name] = m.value;
  }
  const log = options.logger ?? console.log;
  log(JSON.stringify(record));
}

export interface BedrockUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  bedrockCalls: number;
}

/**
 * Emit the per-run token/cost metrics under dimension Operation =
 * "categorize" | "summarize", plus any operation-specific counters.
 */
export function emitBedrockRunMetrics(
  operation: 'categorize' | 'summarize',
  usage: BedrockUsageMetrics,
  extraCounters: Record<string, number> = {},
  properties: Record<string, unknown> = {},
  logger?: (line: string) => void,
): void {
  const metrics: MetricDatum[] = [
    { name: 'BedrockInputTokens', value: usage.inputTokens },
    { name: 'BedrockOutputTokens', value: usage.outputTokens },
    { name: 'BedrockCacheReadInputTokens', value: usage.cacheReadInputTokens },
    { name: 'BedrockCacheCreationInputTokens', value: usage.cacheCreationInputTokens },
    { name: 'BedrockCalls', value: usage.bedrockCalls },
  ];
  for (const [name, value] of Object.entries(extraCounters)) {
    metrics.push({ name, value });
  }
  emitMetrics({
    dimensions: { Operation: operation },
    metrics,
    properties,
    ...(logger !== undefined ? { logger } : {}),
  });
}
