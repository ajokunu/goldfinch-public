/**
 * CloudWatch metrics via Embedded Metric Format (EMF).
 *
 * EMF rides the existing CloudWatch Logs pipeline - one structured stdout line
 * per run, no PutMetricData API call, no extra SDK client in the bundle. The
 * log agent extracts the metrics into the GoldFinch/Sync namespace where the
 * SyncStack alarms watch them.
 */

export interface SyncMetrics {
  /** Transactions put (new or overwritten) this run. */
  TxnsUpserted: number;
  /** Accounts whose ACCT# item was refreshed this run. */
  AccountsSynced: number;
  /** Errors observed this run: SimpleFIN errlist entries + run failures. */
  SyncErrors: number;
  /**
   * Terminal classifications (402 payment lapsed / 403 auth dead / missing
   * access URL). These need a human - retries cannot fix them - so they get a
   * dedicated alarmable metric.
   */
  TerminalErrors: number;
}

export type MetricsWriter = (line: string) => void;

export interface EmitOptions {
  namespace: string;
  /** Injectable sink for tests; defaults to console.log (CloudWatch Logs). */
  write?: MetricsWriter;
  /** Clock injection for tests; epoch milliseconds. */
  timestampMs?: number;
}

const METRIC_NAMES: ReadonlyArray<keyof SyncMetrics> = [
  'TxnsUpserted',
  'AccountsSynced',
  'SyncErrors',
  'TerminalErrors',
];

/** Emit one EMF line carrying all sync metrics (no dimensions - cardinality 1). */
export function emitSyncMetrics(metrics: SyncMetrics, options: EmitOptions): void {
  const write = options.write ?? ((line: string) => console.log(line));
  const document: Record<string, unknown> = {
    _aws: {
      Timestamp: options.timestampMs ?? Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: options.namespace,
          Dimensions: [[]],
          Metrics: METRIC_NAMES.map((name) => ({ Name: name, Unit: 'Count' })),
        },
      ],
    },
  };
  for (const name of METRIC_NAMES) {
    document[name] = metrics[name];
  }
  write(JSON.stringify(document));
}
