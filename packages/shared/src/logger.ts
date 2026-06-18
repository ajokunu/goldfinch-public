/**
 * Structured logging (P7-10) — the one logger for every Lambda and the app.
 *
 * - JSON lines: one object per line with `level`, `msg`, `time`, plus base
 *   fields (service name etc.) and per-call fields. CloudWatch Logs Insights
 *   can `filter level = "error"` immediately.
 * - Error values anywhere in the fields are serialized to
 *   { name, message, stack } — never the useless `{}`.
 * - Logging can never throw: a value JSON.stringify rejects (circular, BigInt)
 *   degrades to a line that SAYS serialization failed (no silent drop).
 * - Lambdas: `createLogger({ base: { service: 'sync' } })` writing to stdout.
 * - App: `createAppLogger({ isProduction })` routes through the matching
 *   console method (so devtools level filters work) and silences ONLY debug
 *   in production builds — warn/error always emit.
 * - Metrics: `emitMetric` writes a CloudWatch Embedded Metric Format line, so
 *   Lambdas get real metrics with zero PutMetricData calls (and zero cost
 *   beyond the log bytes).
 *
 * Platform-neutral: no node:* imports, no process.env reads.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogFields = Record<string, unknown>;

/** Sink signature: receives the level and the finished JSON line. */
export type LogSink = (level: LogLevel, line: string) => void;

export interface Logger {
  readonly level: LogLevel;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A new logger whose lines additionally carry `fields` (request ids etc.). */
  child(fields: LogFields): Logger;
}

export interface CreateLoggerOptions {
  /** Minimum level emitted; lines below it are dropped. Default 'info'. */
  level?: LogLevel;
  /** Static fields merged into every line (e.g. { service: 'sync' }). */
  base?: LogFields;
  /** Override the output for tests; defaults to the console sink below. */
  sink?: LogSink;
  /** Clock override for tests. */
  now?: () => Date;
}

/** Routes each line through the matching console method (stdout in Lambda). */
function consoleSink(level: LogLevel, line: string): void {
  switch (level) {
    case 'debug':
      console.debug(line);
      break;
    case 'info':
      console.info(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'error':
      console.error(line);
      break;
  }
}

/** Error -> plain serializable object; applied recursively to field values. */
function serializeValue(value: unknown, depth: number): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause !== undefined && depth < 4
        ? { cause: serializeValue(value.cause, depth + 1) }
        : {}),
    };
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value) && depth < 4) {
    return value.map((entry) => serializeValue(entry, depth + 1));
  }
  if (value !== null && typeof value === 'object' && depth < 4) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = serializeValue(entry, depth + 1);
    }
    return out;
  }
  return value;
}

function buildLine(
  level: LogLevel,
  msg: string,
  base: LogFields,
  fields: LogFields | undefined,
  now: () => Date,
): string {
  const record: Record<string, unknown> = {
    level,
    msg,
    time: now().toISOString(),
    ...base,
  };
  if (fields !== undefined) {
    for (const [key, value] of Object.entries(fields)) {
      record[key] = serializeValue(value, 0);
    }
  }
  try {
    return JSON.stringify(record);
  } catch (cause) {
    // Never throw, never drop silently: emit a line that says what happened.
    return JSON.stringify({
      level,
      msg,
      time: now().toISOString(),
      loggerError: `log fields were not serializable: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    });
  }
}

/** Structured JSON logger; see module docs. */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const base = options.base ?? {};
  const sink = options.sink ?? consoleSink;
  const now = options.now ?? (() => new Date());
  const minRank = LEVEL_RANK[level];

  function emit(lineLevel: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVEL_RANK[lineLevel] < minRank) {
      return;
    }
    sink(lineLevel, buildLine(lineLevel, msg, base, fields, now));
  }

  return {
    level,
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (fields) =>
      createLogger({
        level,
        base: { ...base, ...fields },
        sink,
        now,
      }),
  };
}

export interface CreateAppLoggerOptions {
  /** Expo: pass !__DEV__. Production silences debug ONLY; info/warn/error always emit. */
  isProduction: boolean;
  base?: LogFields;
  sink?: LogSink;
  now?: () => Date;
}

/**
 * The client-side variant (P7-10): same JSON lines, leveled through the
 * matching console method, debug-silent in production builds.
 */
export function createAppLogger(options: CreateAppLoggerOptions): Logger {
  return createLogger({
    level: options.isProduction ? 'info' : 'debug',
    base: options.base,
    sink: options.sink,
    now: options.now,
  });
}

// ---------------------------------------------------------------------------
// CloudWatch Embedded Metric Format (EMF) — Lambda-side metrics for free
// ---------------------------------------------------------------------------

export class MetricError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetricError';
  }
}

/** Common CloudWatch units; the union stays open for the long tail. */
export type MetricUnit =
  | 'Count'
  | 'Milliseconds'
  | 'Seconds'
  | 'Bytes'
  | 'Percent'
  | 'None'
  | (string & {});

export interface EmitMetricOptions {
  /** CloudWatch namespace, e.g. 'GoldFinch/Sync'. */
  namespace: string;
  /** Dimension key/values (one dimension set). Max 30 per EMF spec. */
  dimensions?: Record<string, string>;
  /** Extra non-metric properties carried on the log line (searchable, not graphed). */
  properties?: Record<string, string | number | boolean>;
  /** Millisecond timestamp override for tests. */
  timestampMs?: number;
  /** Output override for tests; defaults to console.log (Lambda stdout). */
  write?: (line: string) => void;
}

/**
 * Emit one metric value as an EMF log line. CloudWatch extracts it into a
 * real metric asynchronously; in non-Lambda contexts the line is just a
 * harmless structured log.
 */
export function emitMetric(
  name: string,
  value: number,
  unit: MetricUnit,
  options: EmitMetricOptions,
): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new MetricError('metric name must be a non-empty string');
  }
  if (typeof options.namespace !== 'string' || options.namespace.length === 0) {
    throw new MetricError('metric namespace must be a non-empty string');
  }
  if (!Number.isFinite(value)) {
    throw new MetricError(`metric value must be finite, got ${String(value)}`);
  }
  const dimensions = options.dimensions ?? {};
  const dimensionKeys = Object.keys(dimensions);
  if (dimensionKeys.length > 30) {
    throw new MetricError('EMF allows at most 30 dimensions');
  }
  const record: Record<string, unknown> = {
    _aws: {
      Timestamp: options.timestampMs ?? Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: options.namespace,
          Dimensions: [dimensionKeys],
          Metrics: [{ Name: name, Unit: unit }],
        },
      ],
    },
    ...dimensions,
    ...(options.properties ?? {}),
    [name]: value,
  };
  const write = options.write ?? ((line: string) => console.log(line));
  write(JSON.stringify(record));
}
