/**
 * Investments cost-basis precedence + signed P/L math — the single source for
 * effective basis, gain, and percent return. Exhaustive over the precedence
 * branches (manual / feed-nonzero / feed-zero->undefined / neither->undefined),
 * the signed percent-return rounding (positive, NEGATIVE/loss, truncate-toward-
 * zero, cost===0->undefined), and the safe-integer guards. Dirty-data degrade
 * paths are proven to log through the shared logger instead of throwing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HoldingBasisError,
  effectiveCostBasisMinor,
  holdingGainMinor,
  holdingPercentReturn,
} from '../src/holdingBasis.js';
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

describe('effectiveCostBasisMinor — precedence', () => {
  it('uses the manual value when present (over the feed)', () => {
    assert.deepEqual(
      effectiveCostBasisMinor({ manualCostBasisMinor: 150000, feedCostBasisMinor: 99999 }),
      { costBasisMinor: 150000, source: 'manual' },
    );
  });

  it('uses a manual 0 (an explicit user value wins outright)', () => {
    assert.deepEqual(
      effectiveCostBasisMinor({ manualCostBasisMinor: 0, feedCostBasisMinor: 99999 }),
      { costBasisMinor: 0, source: 'manual' },
    );
  });

  it('falls back to a non-zero feed value when there is no manual value', () => {
    assert.deepEqual(
      effectiveCostBasisMinor({ feedCostBasisMinor: 99999 }),
      { costBasisMinor: 99999, source: 'feed' },
    );
  });

  it('treats a feed 0 as UNAVAILABLE -> undefined (never a $0 basis)', () => {
    assert.equal(effectiveCostBasisMinor({ feedCostBasisMinor: 0 }), undefined);
  });

  it('returns undefined when neither source is present', () => {
    assert.equal(effectiveCostBasisMinor({}), undefined);
  });

  it('falls back from an absent manual to a non-zero feed', () => {
    assert.deepEqual(
      effectiveCostBasisMinor({ manualCostBasisMinor: undefined, feedCostBasisMinor: 50000 }),
      { costBasisMinor: 50000, source: 'feed' },
    );
  });
});

describe('effectiveCostBasisMinor — dirty data degrades (never throws)', () => {
  it('ignores a non-integer manual value and falls through to the feed, logging', () => {
    const { logger, lines } = captureLogger();
    assert.deepEqual(
      effectiveCostBasisMinor(
        { manualCostBasisMinor: 1.5 as unknown as number, feedCostBasisMinor: 80000 },
        logger,
      ),
      { costBasisMinor: 80000, source: 'feed' },
    );
    assert.equal(lines.filter((l) => l.level === 'warn').length, 1);
    assert.match(lines[0]!.line, /invalid manual costBasisMinor/);
  });

  it('ignores a non-integer feed value and returns undefined, logging', () => {
    const { logger, lines } = captureLogger();
    assert.equal(
      effectiveCostBasisMinor({ feedCostBasisMinor: Number.NaN }, logger),
      undefined,
    );
    assert.equal(lines.filter((l) => l.level === 'warn').length, 1);
    assert.match(lines[0]!.line, /invalid feed costBasisMinor/);
  });
});

describe('holdingGainMinor', () => {
  it('subtracts cost from market value (positive gain)', () => {
    assert.equal(holdingGainMinor(200000, 150000), 50000);
  });

  it('returns a NEGATIVE gain on a loss', () => {
    assert.equal(holdingGainMinor(100000, 150000), -50000);
  });

  it('returns 0 when value equals cost', () => {
    assert.equal(holdingGainMinor(150000, 150000), 0);
  });

  it('throws on non-integer inputs (caller bug, not user data)', () => {
    assert.throws(() => holdingGainMinor(1.5, 100), HoldingBasisError);
    assert.throws(() => holdingGainMinor(100, Number.NaN), HoldingBasisError);
  });
});

describe('holdingPercentReturn — signed, truncate toward zero', () => {
  it('computes a positive percent return', () => {
    // gain 50000 on cost 100000 = +50%.
    assert.equal(holdingPercentReturn(50000, 100000), 50);
  });

  it('reports a NEGATIVE percent on a loss (does NOT clamp to 0)', () => {
    // gain -50000 on cost 100000 = -50% (percentUsed would clamp this to 0).
    assert.equal(holdingPercentReturn(-50000, 100000), -50);
  });

  it('truncates a positive fraction toward zero (149.7% -> 149)', () => {
    // gain 1497 on cost 1000 = 149.7% -> 149.
    assert.equal(holdingPercentReturn(1497, 1000), 149);
  });

  it('truncates a NEGATIVE fraction toward zero (-149.7% -> -149, NOT floored to -150)', () => {
    // gain -1497 on cost 1000 = -149.7% -> -149 (truncate toward zero, not floor).
    assert.equal(holdingPercentReturn(-1497, 1000), -149);
  });

  it('returns undefined when cost basis is 0 (never divides by zero)', () => {
    assert.equal(holdingPercentReturn(50000, 0), undefined);
    assert.equal(holdingPercentReturn(0, 0), undefined);
  });

  it('throws on non-safe-integer inputs', () => {
    assert.throws(() => holdingPercentReturn(1.5, 100), HoldingBasisError);
    assert.throws(() => holdingPercentReturn(100, 1.5), HoldingBasisError);
    assert.throws(
      () => holdingPercentReturn(Number.MAX_SAFE_INTEGER + 1, 100),
      HoldingBasisError,
    );
  });

  it('stays exact for large safe-integer values (BigInt math, no float drift)', () => {
    // 9_000_000_000 minor units gain on 9_000_000_000 cost = exactly 100%.
    assert.equal(holdingPercentReturn(9_000_000_000, 9_000_000_000), 100);
    // A gain larger than 2^53 worth of (gain*100) would overflow float math;
    // BigInt keeps it exact: gain 90_071_992_547_409 on cost 100 = a huge but
    // exact integer percent (proves the *100n happens in BigInt, not float).
    const gain = 90_071_992_547_409; // < MAX_SAFE_INTEGER
    assert.equal(holdingPercentReturn(gain, 100), Number((BigInt(gain) * 100n) / 100n));
  });
});
