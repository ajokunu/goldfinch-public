/**
 * Income/spend series rule (charts.md 4.4): income is always the positive
 * token; spend is the accent EXCEPT under the quant grid variant, where it
 * deliberately swaps to accent2.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { trendSeriesColors } from '../seriesColors';
import type { ChartThemeSource } from '../chartTheme';

const colors = {
  surface: '#FFFFFF',
  surfaceAlt: '#E6EAE9',
  border: '#D6DCDB',
  accent: '#C6F24E',
  accent2: '#54CFE6',
  positive: '#5FD08B',
};

const source = (extra: Partial<ChartThemeSource>): ChartThemeSource => ({
  colors,
  ...extra,
});

describe('trendSeriesColors', () => {
  it('uses accent2 for spend under the grid variant (quant)', () => {
    assert.deepEqual(trendSeriesColors(source({ chartVariant: 'grid' })), {
      income: '#5FD08B',
      spend: '#54CFE6',
    });
  });

  it('reads the tokens.md chart field too', () => {
    assert.equal(
      trendSeriesColors(source({ chart: 'grid' })).spend,
      '#54CFE6',
    );
  });

  it('uses the accent for spend under every other variant', () => {
    for (const variant of ['area', 'block', 'soft'] as const) {
      assert.deepEqual(trendSeriesColors(source({ chartVariant: variant })), {
        income: '#5FD08B',
        spend: '#C6F24E',
      });
    }
  });

  it('defaults to the accent when the theme has no variant yet', () => {
    assert.equal(trendSeriesColors(source({})).spend, '#C6F24E');
  });

  it('falls back to the accent when grid has no accent2 token', () => {
    const { accent2: _unused, ...withoutAccent2 } = colors;
    assert.equal(
      trendSeriesColors({ colors: withoutAccent2, chartVariant: 'grid' }).spend,
      withoutAccent2.accent,
    );
  });

  it('income falls back through pos to the accent', () => {
    const { positive: _unusedPositive, ...noPositive } = colors;
    assert.equal(
      trendSeriesColors({ colors: { ...noPositive, pos: '#123456' } }).income,
      '#123456',
    );
    assert.equal(
      trendSeriesColors({ colors: noPositive }).income,
      noPositive.accent,
    );
  });
});
