/**
 * Net-worth hero math tests (lib/heroMath.ts; design-spec screens.md 1.3).
 * Expected values are hand-computed literals (P7-7 integer-minor posture),
 * never recomputed with the helpers under test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_NET_WORTH_RANGE,
  NET_WORTH_RANGES,
  formatPctTenths,
  netWorthDelta,
  rangeStartIsoDate,
  sliceHistoryToRange,
} from '../lib/heroMath';

describe('range constants', () => {
  it('keeps the prototype 3M / 6M / 1Y options in order', () => {
    assert.deepEqual(
      NET_WORTH_RANGES.map((option) => ({ ...option })),
      [
        { key: '3M', months: 3 },
        { key: '6M', months: 6 },
        { key: '1Y', months: 12 },
      ],
    );
  });

  it('defaults to 6M', () => {
    assert.equal(DEFAULT_NET_WORTH_RANGE, '6M');
  });
});

describe('rangeStartIsoDate', () => {
  it('subtracts whole months on the local calendar', () => {
    assert.equal(rangeStartIsoDate(3, new Date(2026, 5, 10)), '2026-03-10');
    assert.equal(rangeStartIsoDate(12, new Date(2026, 5, 10)), '2025-06-10');
  });

  it('crosses year boundaries backwards', () => {
    assert.equal(rangeStartIsoDate(6, new Date(2026, 1, 15)), '2025-08-15');
  });
});

describe('sliceHistoryToRange', () => {
  const now = new Date(2026, 5, 10); // 2026-06-10 local.
  const items = [
    { date: '2025-05-01' as const, label: 'old' },
    { date: '2025-08-01' as const, label: 'yr' },
    { date: '2025-12-10' as const, label: 'mid' },
    { date: '2026-03-10' as const, label: 'edge' },
    { date: '2026-06-01' as const, label: 'new' },
  ];

  it('keeps only items on or after the 3M window start (inclusive edge)', () => {
    assert.deepEqual(
      sliceHistoryToRange(items, '3M', now).map((item) => item.label),
      ['edge', 'new'],
    );
  });

  it('widens with 6M and 1Y', () => {
    // 6M start is 2025-12-10; the 'mid' snapshot sits exactly on it.
    assert.deepEqual(
      sliceHistoryToRange(items, '6M', now).map((item) => item.label),
      ['mid', 'edge', 'new'],
    );
    // 1Y start is 2025-06-10: picks up 'yr' but still excludes 'old'.
    assert.deepEqual(
      sliceHistoryToRange(items, '1Y', now).map((item) => item.label),
      ['yr', 'mid', 'edge', 'new'],
    );
  });

  it('clamps to everything available when the window predates history', () => {
    const recent = [{ date: '2026-06-01' as const }];
    assert.deepEqual(sliceHistoryToRange(recent, '1Y', now), recent);
  });

  it('returns an empty slice for empty history', () => {
    assert.deepEqual(sliceHistoryToRange([], '3M', now), []);
  });
});

describe('netWorthDelta', () => {
  it('returns null with fewer than two snapshots', () => {
    assert.equal(netWorthDelta([]), null);
    assert.equal(netWorthDelta([{ netMinor: 1000 }]), null);
  });

  it('subtracts the previous from the last snapshot (integers)', () => {
    assert.deepEqual(
      netWorthDelta([
        { netMinor: 50 },
        { netMinor: 1000 },
        { netMinor: 1500 },
      ]),
      { deltaMinor: 500, pctTenths: 500 },
    );
  });

  it('carries negative deltas', () => {
    assert.deepEqual(netWorthDelta([{ netMinor: 2000 }, { netMinor: 1500 }]), {
      deltaMinor: -500,
      pctTenths: 250,
    });
  });

  it('uses the absolute previous net as the percent base', () => {
    assert.deepEqual(
      netWorthDelta([{ netMinor: -2000 }, { netMinor: -1500 }]),
      { deltaMinor: 500, pctTenths: 250 },
    );
  });

  it('rounds tenths to the nearest integer', () => {
    // 100 * 1000 / 3000 = 33.33 -> 33.
    assert.deepEqual(netWorthDelta([{ netMinor: 3000 }, { netMinor: 3100 }]), {
      deltaMinor: 100,
      pctTenths: 33,
    });
  });

  it('returns a null percent when the previous net is zero', () => {
    assert.deepEqual(netWorthDelta([{ netMinor: 0 }, { netMinor: 700 }]), {
      deltaMinor: 700,
      pctTenths: null,
    });
  });
});

describe('formatPctTenths', () => {
  it('renders tenths', () => {
    assert.equal(formatPctTenths(12), '1.2%');
    assert.equal(formatPctTenths(5), '0.5%');
  });

  it('drops the .0 on whole percents', () => {
    assert.equal(formatPctTenths(20), '2%');
    assert.equal(formatPctTenths(0), '0%');
  });

  it('keeps the sign on negative values', () => {
    assert.equal(formatPctTenths(-12), '-1.2%');
    assert.equal(formatPctTenths(-20), '-2%');
  });
});
