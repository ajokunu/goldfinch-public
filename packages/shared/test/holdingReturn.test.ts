/**
 * Investment price-history normalization — the single source for the
 * Investments tab return chart. Covers baseline indexing (0% at the start), the
 * signed truncate-toward-zero rounding (gain AND loss), the no-usable-baseline
 * degrade ([]), dirty later-point dropping (log, not throw), and
 * windowReturnPercent's "fewer than two points -> undefined" rule.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  normalizeReturnSeries,
  pricePerShareMinor,
  windowReturnPercent,
} from '../src/holdingReturn.js';
import { createLogger, type LogLevel } from '../src/logger.js';

/** Captures every emitted line so failure-path logging is assertable. */
function captureLogger() {
  const lines: Array<{ level: LogLevel; line: string }> = [];
  const logger = createLogger({
    level: 'debug',
    sink: (level, line) => lines.push({ level, line }),
  });
  return { logger, lines };
}

describe('normalizeReturnSeries', () => {
  it('indexes to the first point (baseline 0%) and reports gains', () => {
    const series = normalizeReturnSeries([
      { date: '2025-01-01', pricePerShareMinor: 10000 },
      { date: '2025-06-01', pricePerShareMinor: 11000 },
      { date: '2025-12-01', pricePerShareMinor: 12500 },
    ]);
    assert.deepEqual(series, [
      { date: '2025-01-01', returnPercent: 0 },
      { date: '2025-06-01', returnPercent: 10 },
      { date: '2025-12-01', returnPercent: 25 },
    ]);
  });

  it('reports a NEGATIVE percent for a loss (never clamped to 0)', () => {
    const series = normalizeReturnSeries([
      { date: '2025-01-01', pricePerShareMinor: 20000 },
      { date: '2025-12-01', pricePerShareMinor: 17000 },
    ]);
    assert.deepEqual(series[series.length - 1], { date: '2025-12-01', returnPercent: -15 });
  });

  it('truncates toward zero for both signs (not floor)', () => {
    // gain: (11497-10000)*100/10000 = 14.97 -> 14
    const gain = normalizeReturnSeries([
      { date: 'a', pricePerShareMinor: 10000 },
      { date: 'b', pricePerShareMinor: 11497 },
    ]);
    assert.equal(gain[gain.length - 1]!.returnPercent, 14);
    // loss: (8503-10000)*100/10000 = -14.97 -> -14 (toward zero, not -15)
    const loss = normalizeReturnSeries([
      { date: 'a', pricePerShareMinor: 10000 },
      { date: 'b', pricePerShareMinor: 8503 },
    ]);
    assert.equal(loss[loss.length - 1]!.returnPercent, -14);
  });

  it('returns [] for empty input', () => {
    assert.deepEqual(normalizeReturnSeries([]), []);
  });

  it('returns [] and logs when the baseline price is non-positive', () => {
    const { logger, lines } = captureLogger();
    assert.deepEqual(
      normalizeReturnSeries(
        [
          { date: 'a', pricePerShareMinor: 0 },
          { date: 'b', pricePerShareMinor: 10000 },
        ],
        logger,
      ),
      [],
    );
    assert.ok(lines.some((l) => l.level === 'warn'));
  });

  it('drops a dirty later point with a logged warning, keeping the rest', () => {
    const { logger, lines } = captureLogger();
    const series = normalizeReturnSeries(
      [
        { date: 'a', pricePerShareMinor: 10000 },
        { date: 'b', pricePerShareMinor: 1.5 },
        { date: 'c', pricePerShareMinor: 12000 },
      ],
      logger,
    );
    assert.deepEqual(series, [
      { date: 'a', returnPercent: 0 },
      { date: 'c', returnPercent: 20 },
    ]);
    assert.ok(lines.some((l) => l.level === 'warn'));
  });
});

describe('windowReturnPercent', () => {
  it('is the last normalized point (total window return)', () => {
    assert.equal(
      windowReturnPercent([
        { date: 'a', pricePerShareMinor: 10000 },
        { date: 'b', pricePerShareMinor: 13000 },
      ]),
      30,
    );
  });

  it('is undefined with fewer than two usable points (dash, not 0%)', () => {
    assert.equal(windowReturnPercent([{ date: 'a', pricePerShareMinor: 10000 }]), undefined);
    assert.equal(windowReturnPercent([]), undefined);
  });
});

describe('pricePerShareMinor', () => {
  it('divides market value by whole shares (minor units)', () => {
    // $10,000.00 over 100 shares -> $100.00 per share.
    assert.equal(pricePerShareMinor(1000000, '100'), 10000);
  });

  it('handles fractional shares BigInt-exactly', () => {
    // $1,250.00 over 12.5 shares -> $100.00 per share.
    assert.equal(pricePerShareMinor(125000, '12.5'), 10000);
  });

  it('truncates toward zero (no float, never rounds up)', () => {
    // $100.00 over 3 shares -> 3333.33... cents -> 3333.
    assert.equal(pricePerShareMinor(10000, '3'), 3333);
  });

  it('returns undefined for zero, negative, or non-numeric shares (no divide-by-zero)', () => {
    assert.equal(pricePerShareMinor(10000, '0'), undefined);
    assert.equal(pricePerShareMinor(10000, '-5'), undefined);
    assert.equal(pricePerShareMinor(10000, 'abc'), undefined);
  });

  it('returns undefined when market value is not a safe integer', () => {
    assert.equal(pricePerShareMinor(1.5, '100'), undefined);
    assert.equal(pricePerShareMinor(Number.MAX_SAFE_INTEGER + 1, '100'), undefined);
  });
});
