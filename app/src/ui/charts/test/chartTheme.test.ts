/**
 * Token-boundary resolution tests (chartTheme.ts): the resolver must accept
 * BOTH the currently shipped Theme shape (textPrimary/textSecondary/
 * positive/danger, no chart tokens) and the extended-theme shapes
 * (tokens.md GFTheme and charts.md field names), with the documented
 * fallback chains reproducing today's rendering until the theme lands.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_CATEGORY_OTHER,
  DEFAULT_CATEGORY_PALETTE,
  resolveChartTheme,
  svgFontProps,
  type ChartThemeSource,
} from '../chartTheme';

const baseColors = {
  surface: '#FFFFFF',
  surfaceAlt: '#F1EFEA',
  border: '#E3E1DA',
  accent: '#A87B0B',
};

describe('resolveChartTheme: variant', () => {
  it('defaults to area (meridian default direction) when untokened', () => {
    assert.equal(resolveChartTheme({ colors: baseColors }).variant, 'area');
  });

  it('reads the charts.md chartVariant field', () => {
    assert.equal(
      resolveChartTheme({ colors: baseColors, chartVariant: 'block' }).variant,
      'block',
    );
  });

  it('reads the tokens.md chart field', () => {
    assert.equal(
      resolveChartTheme({ colors: baseColors, chart: 'grid' }).variant,
      'grid',
    );
  });

  it('prefers chartVariant over chart when both exist', () => {
    assert.equal(
      resolveChartTheme({
        colors: baseColors,
        chartVariant: 'soft',
        chart: 'grid',
      }).variant,
      'soft',
    );
  });
});

describe('resolveChartTheme: color chains', () => {
  it('resolves the currently shipped Theme shape', () => {
    const resolved = resolveChartTheme({
      colors: {
        ...baseColors,
        textPrimary: '#1B1A17',
        textSecondary: '#6C6A62',
        positive: '#1E7F4F',
        danger: '#B3322B',
      },
    });
    assert.equal(resolved.text, '#1B1A17');
    assert.equal(resolved.dim, '#6C6A62');
    assert.equal(resolved.faint, '#6C6A62'); // falls back to dim
    assert.equal(resolved.positive, '#1E7F4F');
    assert.equal(resolved.negative, '#B3322B');
    assert.equal(resolved.grid, baseColors.border); // falls back to border
    assert.equal(resolved.accent2, baseColors.accent); // falls back to accent
    assert.equal(resolved.surface, baseColors.surface);
    assert.equal(resolved.surfaceAlt, baseColors.surfaceAlt);
    assert.equal(resolved.border, baseColors.border);
  });

  it('resolves the extended tokens.md shape', () => {
    const resolved = resolveChartTheme({
      colors: {
        ...baseColors,
        text: '#1A2420',
        dim: '#6B7268',
        faint: '#9A9C8F',
        pos: '#1E7F4F',
        neg: '#B3463B',
        accent2: '#B07D2B',
        grid: '#E6DECD',
      },
    });
    assert.equal(resolved.text, '#1A2420');
    assert.equal(resolved.dim, '#6B7268');
    assert.equal(resolved.faint, '#9A9C8F');
    assert.equal(resolved.positive, '#1E7F4F');
    assert.equal(resolved.negative, '#B3463B');
    assert.equal(resolved.accent2, '#B07D2B');
    assert.equal(resolved.grid, '#E6DECD');
  });

  it('prefers shipped-Theme names over extended names when both exist', () => {
    const resolved = resolveChartTheme({
      colors: {
        ...baseColors,
        textPrimary: '#111111',
        text: '#222222',
        textSecondary: '#333333',
        dim: '#444444',
        positive: '#555555',
        pos: '#666666',
        danger: '#777777',
        neg: '#888888',
      },
    });
    assert.equal(resolved.text, '#111111');
    assert.equal(resolved.dim, '#333333');
    assert.equal(resolved.positive, '#555555');
    assert.equal(resolved.negative, '#777777');
  });

  it('terminates every chain at the accent when nothing else exists', () => {
    const resolved = resolveChartTheme({ colors: baseColors });
    assert.equal(resolved.text, baseColors.accent);
    assert.equal(resolved.dim, baseColors.accent);
    assert.equal(resolved.faint, baseColors.accent);
    assert.equal(resolved.positive, baseColors.accent);
    assert.equal(resolved.negative, baseColors.accent);
  });
});

describe('resolveChartTheme: category palette', () => {
  it('uses the interim meridian palette when untokened', () => {
    const resolved = resolveChartTheme({ colors: baseColors });
    assert.equal(resolved.categories, DEFAULT_CATEGORY_PALETTE);
    // Exact meridian cats c1..c9, c0 (tokens.md section 3): the interim
    // palette must match the default direction value-for-value.
    assert.deepEqual(DEFAULT_CATEGORY_PALETTE, [
      '#2E6E54',
      '#B07D2B',
      '#4E7A8A',
      '#9A5E7A',
      '#A65A3C',
      '#6B7A45',
      '#3E8A78',
      '#8A6BA0',
      '#5C6B8A',
      '#2E7D55',
    ]);
    assert.equal(resolved.categoryOther, DEFAULT_CATEGORY_OTHER);
    assert.equal(DEFAULT_CATEGORY_OTHER, '#8C8579');
  });

  it('prefers colors.categories (charts.md shape)', () => {
    const categories = ['#111111', '#222222'];
    const resolved = resolveChartTheme({
      colors: { ...baseColors, categories, categoryOther: '#999999' },
      cats: { c1: '#AAAAAA', other: '#BBBBBB' },
    });
    assert.equal(resolved.categories, categories);
    assert.equal(resolved.categoryOther, '#999999');
  });

  it('flattens cats in prototype order c1..c9 then c0 (tokens.md shape)', () => {
    const resolved = resolveChartTheme({
      colors: baseColors,
      cats: {
        c1: '#01',
        c2: '#02',
        c3: '#03',
        c4: '#04',
        c5: '#05',
        c6: '#06',
        c7: '#07',
        c8: '#08',
        c9: '#09',
        c0: '#00',
        other: '#0other',
      },
    });
    assert.deepEqual(resolved.categories, [
      '#01',
      '#02',
      '#03',
      '#04',
      '#05',
      '#06',
      '#07',
      '#08',
      '#09',
      '#00',
    ]);
    assert.equal(resolved.categoryOther, '#0other');
  });

  it('skips missing cats entries without reordering', () => {
    const resolved = resolveChartTheme({
      colors: baseColors,
      cats: { c2: '#02', c5: '#05' },
    });
    assert.deepEqual(resolved.categories, ['#02', '#05']);
  });

  it('falls back to the default palette for an empty cats object', () => {
    const resolved = resolveChartTheme({ colors: baseColors, cats: {} });
    assert.equal(resolved.categories, DEFAULT_CATEGORY_PALETTE);
  });
});

describe('resolveChartTheme: fonts pass-through', () => {
  it('carries font tokens through unchanged', () => {
    const fonts = {
      display: 'Newsreader_500Medium',
      sans: { regular: 'HankenGrotesk_400Regular' },
      mono: 'JetBrainsMono_400Regular',
    };
    const resolved = resolveChartTheme({ colors: baseColors, fonts });
    assert.equal(resolved.fonts.display, fonts.display);
    assert.equal(resolved.fonts.sans, fonts.sans);
    assert.equal(resolved.fonts.mono, fonts.mono);
  });

  it('prefers per-cut sets over single-family tokens (theme-engine shape)', () => {
    const displaySet = { regular: 'NR', semibold: 'NS', bold: 'NB' };
    const monoSet = { regular: 'JR', bold: 'JB' };
    const resolved = resolveChartTheme({
      colors: baseColors,
      fonts: {
        display: 'Newsreader_500Medium',
        mono: 'JetBrainsMono_400Regular',
        sans: 'HankenGrotesk_400Regular',
        displaySet,
        monoSet,
      },
    });
    assert.equal(resolved.fonts.display, displaySet);
    assert.equal(resolved.fonts.mono, monoSet);
    // No sansSet provided: the single family remains.
    assert.equal(resolved.fonts.sans, 'HankenGrotesk_400Regular');
  });

  it('leaves fonts undefined when the theme has none (system font)', () => {
    const resolved = resolveChartTheme({ colors: baseColors });
    assert.equal(resolved.fonts.display, undefined);
    assert.equal(resolved.fonts.sans, undefined);
    assert.equal(resolved.fonts.mono, undefined);
  });
});

describe('svgFontProps', () => {
  it('system font: weight only when non-regular', () => {
    assert.deepEqual(svgFontProps(undefined, 400), {});
    assert.deepEqual(svgFontProps(undefined, 600), { fontWeight: '600' });
    assert.deepEqual(svgFontProps(undefined, 700), { fontWeight: '700' });
  });

  it('plain family string: family plus explicit non-regular weight', () => {
    assert.deepEqual(svgFontProps('Mono', 400), { fontFamily: 'Mono' });
    assert.deepEqual(svgFontProps('Sans', 600), {
      fontFamily: 'Sans',
      fontWeight: '600',
    });
    assert.deepEqual(svgFontProps('Disp', 700), {
      fontFamily: 'Disp',
      fontWeight: '700',
    });
  });

  it('per-cut set: cut family encodes the weight, no fontWeight emitted', () => {
    const cuts = {
      regular: 'R',
      medium: 'M',
      semibold: 'S',
      bold: 'B',
      extrabold: 'X',
    };
    assert.deepEqual(svgFontProps(cuts, 400), { fontFamily: 'R' });
    assert.deepEqual(svgFontProps(cuts, 600), { fontFamily: 'S' });
    assert.deepEqual(svgFontProps(cuts, 700), { fontFamily: 'B' });
  });

  it('per-cut set: documented fallback order for missing cuts', () => {
    assert.deepEqual(svgFontProps({ regular: 'R' }, 600), { fontFamily: 'R' });
    assert.deepEqual(svgFontProps({ regular: 'R' }, 700), { fontFamily: 'R' });
    assert.deepEqual(svgFontProps({ regular: 'R', medium: 'M' }, 600), {
      fontFamily: 'M',
    });
    assert.deepEqual(svgFontProps({ regular: 'R', bold: 'B' }, 600), {
      fontFamily: 'B',
    });
    assert.deepEqual(svgFontProps({ regular: 'R', semibold: 'S' }, 700), {
      fontFamily: 'S',
    });
    assert.deepEqual(svgFontProps({ regular: 'R', extrabold: 'X' }, 700), {
      fontFamily: 'X',
    });
  });
});

describe('ChartThemeSource structural compatibility', () => {
  it('accepts the currently shipped Theme colors object as-is', () => {
    // Mirrors app/src/ui/theme.ts lightTheme.colors; extra keys
    // (bg, onAccent, warning, tab*) must not break assignability.
    const shippedLikeColors = {
      bg: '#FAF9F6',
      surface: '#FFFFFF',
      surfaceAlt: '#F1EFEA',
      border: '#E3E1DA',
      textPrimary: '#1B1A17',
      textSecondary: '#6C6A62',
      accent: '#A87B0B',
      onAccent: '#FFFFFF',
      danger: '#B3322B',
      positive: '#1E7F4F',
      warning: '#A36206',
      tabBarBg: '#FFFFFF',
      tabActive: '#A87B0B',
      tabInactive: '#8B897F',
    };
    const source: ChartThemeSource = { colors: shippedLikeColors };
    const resolved = resolveChartTheme(source);
    assert.equal(resolved.accent, '#A87B0B');
    assert.equal(resolved.text, '#1B1A17');
  });
});
