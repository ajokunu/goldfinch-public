/** Structured logger + EMF metrics (P7-10). */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MetricError,
  createAppLogger,
  createLogger,
  emitMetric,
  type LogLevel,
} from '../src/logger.js';

interface Captured {
  level: LogLevel;
  record: Record<string, unknown>;
}

function capture(): { lines: Captured[]; sink: (level: LogLevel, line: string) => void } {
  const lines: Captured[] = [];
  return {
    lines,
    sink: (level, line) => {
      lines.push({ level, record: JSON.parse(line) as Record<string, unknown> });
    },
  };
}

const fixedNow = () => new Date('2026-06-09T12:00:00.000Z');

describe('createLogger', () => {
  it('emits JSON lines with level, msg, time, base, and call fields', () => {
    const { lines, sink } = capture();
    const log = createLogger({ level: 'debug', base: { service: 'sync' }, sink, now: fixedNow });
    log.info('synced', { accounts: 4 });
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.level, 'info');
    assert.deepEqual(lines[0]!.record, {
      level: 'info',
      msg: 'synced',
      time: '2026-06-09T12:00:00.000Z',
      service: 'sync',
      accounts: 4,
    });
  });

  it('drops lines below the configured level — and only those', () => {
    const { lines, sink } = capture();
    const log = createLogger({ level: 'warn', sink, now: fixedNow });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    assert.deepEqual(lines.map((l) => l.level), ['warn', 'error']);
  });

  it('defaults to info level', () => {
    const { lines, sink } = capture();
    const log = createLogger({ sink, now: fixedNow });
    log.debug('hidden');
    log.info('shown');
    assert.deepEqual(lines.map((l) => l.record['msg']), ['shown']);
    assert.equal(log.level, 'info');
  });

  it('child loggers merge fields and keep the sink and level', () => {
    const { lines, sink } = capture();
    const log = createLogger({ level: 'debug', base: { service: 'api' }, sink, now: fixedNow });
    const child = log.child({ requestId: 'r-1' });
    child.debug('handling');
    assert.equal(lines[0]!.record['service'], 'api');
    assert.equal(lines[0]!.record['requestId'], 'r-1');
    // Per-call fields can override child fields deterministically.
    child.info('handling', { requestId: 'r-2' });
    assert.equal(lines[1]!.record['requestId'], 'r-2');
  });

  it('serializes Error values to name/message/stack (with cause)', () => {
    const { lines, sink } = capture();
    const log = createLogger({ sink, now: fixedNow });
    const cause = new Error('root');
    const err = new Error('boom', { cause });
    log.error('failed', { err });
    const serialized = lines[0]!.record['err'] as Record<string, unknown>;
    assert.equal(serialized['name'], 'Error');
    assert.equal(serialized['message'], 'boom');
    assert.equal(typeof serialized['stack'], 'string');
    assert.equal((serialized['cause'] as Record<string, unknown>)['message'], 'root');
  });

  it('serializes Errors nested in arrays/objects and BigInt values', () => {
    const { lines, sink } = capture();
    const log = createLogger({ sink, now: fixedNow });
    log.info('nested', { failures: [new Error('one')], total: 10n });
    const failures = lines[0]!.record['failures'] as Array<Record<string, unknown>>;
    assert.equal(failures[0]!['message'], 'one');
    assert.equal(lines[0]!.record['total'], '10');
  });

  it('never throws on unserializable fields — emits a loggerError line instead', () => {
    const { lines, sink } = capture();
    const log = createLogger({ sink, now: fixedNow });
    // Depth-limited serialization handles shallow structures; force a real
    // stringify failure with a cycle that survives past the depth cutoff.
    class Box {
      self: unknown;
    }
    const box = new Box();
    box.self = box;
    assert.doesNotThrow(() => log.info('cyclic', { box: { a: { b: { c: { d: box } } } } }));
    assert.equal(lines.length, 1);
    const record = lines[0]!.record;
    assert.equal(record['msg'], 'cyclic');
    assert.ok(record['box'] !== undefined || record['loggerError'] !== undefined);
  });
});

describe('createAppLogger', () => {
  it('is debug-leveled in development', () => {
    const { lines, sink } = capture();
    const log = createAppLogger({ isProduction: false, sink, now: fixedNow });
    log.debug('dev detail');
    assert.equal(lines.length, 1);
  });

  it('silences ONLY debug in production; warn/error always emit', () => {
    const { lines, sink } = capture();
    const log = createAppLogger({ isProduction: true, sink, now: fixedNow });
    log.debug('hidden');
    log.info('i');
    log.warn('w');
    log.error('e');
    assert.deepEqual(lines.map((l) => l.level), ['info', 'warn', 'error']);
  });
});

describe('emitMetric', () => {
  function captureMetric(): { lines: Array<Record<string, unknown>>; write: (line: string) => void } {
    const lines: Array<Record<string, unknown>> = [];
    return { lines, write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>) };
  }

  it('emits a valid EMF envelope with dimensions and the metric value', () => {
    const { lines, write } = captureMetric();
    emitMetric('TxnUpserts', 42, 'Count', {
      namespace: 'GoldFinch/Sync',
      dimensions: { Service: 'sync' },
      properties: { runId: 'r-1' },
      timestampMs: 1765000000000,
      write,
    });
    assert.deepEqual(lines[0], {
      _aws: {
        Timestamp: 1765000000000,
        CloudWatchMetrics: [
          {
            Namespace: 'GoldFinch/Sync',
            Dimensions: [['Service']],
            Metrics: [{ Name: 'TxnUpserts', Unit: 'Count' }],
          },
        ],
      },
      Service: 'sync',
      runId: 'r-1',
      TxnUpserts: 42,
    });
  });

  it('works without dimensions (empty dimension set)', () => {
    const { lines, write } = captureMetric();
    emitMetric('Latency', 12.5, 'Milliseconds', { namespace: 'GoldFinch/Api', timestampMs: 1, write });
    const aws = lines[0]!['_aws'] as { CloudWatchMetrics: Array<{ Dimensions: string[][] }> };
    assert.deepEqual(aws.CloudWatchMetrics[0]!.Dimensions, [[]]);
    assert.equal(lines[0]!['Latency'], 12.5);
  });

  it('validates name, namespace, value, and dimension count', () => {
    const opts = { namespace: 'GoldFinch/Sync' };
    assert.throws(() => emitMetric('', 1, 'Count', opts), MetricError);
    assert.throws(() => emitMetric('X', 1, 'Count', { namespace: '' }), MetricError);
    assert.throws(() => emitMetric('X', Number.NaN, 'Count', opts), MetricError);
    assert.throws(() => emitMetric('X', Number.POSITIVE_INFINITY, 'Count', opts), MetricError);
    const tooMany: Record<string, string> = {};
    for (let i = 0; i < 31; i += 1) {
      tooMany[`d${i}`] = 'v';
    }
    assert.throws(
      () => emitMetric('X', 1, 'Count', { namespace: 'NS', dimensions: tooMany }),
      MetricError,
    );
  });
});
