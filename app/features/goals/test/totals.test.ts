/** Per-currency goal totals for the total-saved hero card. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { goalTotalsByCurrency } from '../lib/totals.js';

describe('goalTotalsByCurrency', () => {
  it('returns an empty list for no goals', () => {
    assert.deepEqual(goalTotalsByCurrency([]), []);
  });

  it('sums one currency into a single entry', () => {
    assert.deepEqual(
      goalTotalsByCurrency([
        { currency: 'USD', progressMinor: 1_000, targetMinor: 5_000 },
        { currency: 'USD', progressMinor: 250, targetMinor: 10_000 },
      ]),
      [{ currency: 'USD', savedMinor: 1_250, targetMinor: 15_000 }],
    );
  });

  it('keeps currencies separate and sorts by code', () => {
    assert.deepEqual(
      goalTotalsByCurrency([
        { currency: 'USD', progressMinor: 100, targetMinor: 200 },
        { currency: 'JPY', progressMinor: 5_000, targetMinor: 10_000 },
        { currency: 'USD', progressMinor: 50, targetMinor: 300 },
      ]),
      [
        { currency: 'JPY', savedMinor: 5_000, targetMinor: 10_000 },
        { currency: 'USD', savedMinor: 150, targetMinor: 500 },
      ],
    );
  });

  it('carries negative progress (withdrawals) exactly', () => {
    assert.deepEqual(
      goalTotalsByCurrency([
        { currency: 'EUR', progressMinor: -500, targetMinor: 1_000 },
      ]),
      [{ currency: 'EUR', savedMinor: -500, targetMinor: 1_000 }],
    );
  });
});

describe('goalTotalsByCurrency ordering', () => {
  it('sorts three currencies inserted in reverse lexicographic order', () => {
    assert.deepEqual(
      goalTotalsByCurrency([
        { currency: 'USD', progressMinor: 1, targetMinor: 2 },
        { currency: 'KRW', progressMinor: 3, targetMinor: 4 },
        { currency: 'EUR', progressMinor: 5, targetMinor: 6 },
        { currency: 'CAD', progressMinor: 7, targetMinor: 8 },
      ]),
      [
        { currency: 'CAD', savedMinor: 7, targetMinor: 8 },
        { currency: 'EUR', savedMinor: 5, targetMinor: 6 },
        { currency: 'KRW', savedMinor: 3, targetMinor: 4 },
        { currency: 'USD', savedMinor: 1, targetMinor: 2 },
      ],
    );
  });
});
