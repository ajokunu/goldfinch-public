/**
 * themeCrossfadeMath unit tests (PHASE9-DECISIONS P9-2 item 8): the web
 * palette-transition stylesheet builder. Expected strings are hand-written
 * literals so a mutated joiner/format cannot survive by symmetry.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  themeTransitionCss,
  THEME_TRANSITION_PROPERTIES,
} from '../motion/themeCrossfadeMath';

const FLOW: readonly [number, number, number, number] = [0.16, 1, 0.3, 1];

describe('THEME_TRANSITION_PROPERTIES', () => {
  it('covers exactly the color-bearing properties, no layout properties', () => {
    assert.deepEqual(THEME_TRANSITION_PROPERTIES, [
      'color',
      'background-color',
      'border-color',
      'outline-color',
      'fill',
      'stroke',
    ]);
  });
});

describe('themeTransitionCss', () => {
  it('builds the full rule for the designed 350ms window', () => {
    assert.equal(
      themeTransitionCss(350, FLOW),
      '*, *::before, *::after { transition: ' +
        'color 350ms cubic-bezier(0.16, 1, 0.3, 1), ' +
        'background-color 350ms cubic-bezier(0.16, 1, 0.3, 1), ' +
        'border-color 350ms cubic-bezier(0.16, 1, 0.3, 1), ' +
        'outline-color 350ms cubic-bezier(0.16, 1, 0.3, 1), ' +
        'fill 350ms cubic-bezier(0.16, 1, 0.3, 1), ' +
        'stroke 350ms cubic-bezier(0.16, 1, 0.3, 1) !important; }',
    );
  });

  it('rounds fractional durations (multiplier-scaled tokens)', () => {
    const css = themeTransitionCss(350.4, FLOW);
    assert.match(css, / 350ms /);
    assert.doesNotMatch(css, /350\.4/);
    assert.match(themeTransitionCss(87.5, FLOW), / 88ms /);
  });

  it('formats arbitrary bezier control points verbatim', () => {
    const css = themeTransitionCss(200, [0.25, 0.1, 0.25, 1]);
    assert.match(css, /cubic-bezier\(0\.25, 0\.1, 0\.25, 1\)/);
  });

  it('returns the empty string for zero, negative, and junk durations', () => {
    assert.equal(themeTransitionCss(0, FLOW), '');
    assert.equal(themeTransitionCss(-350, FLOW), '');
    assert.equal(themeTransitionCss(0.4, FLOW), '');
    assert.equal(themeTransitionCss(Number.NaN, FLOW), '');
    assert.equal(themeTransitionCss(Number.POSITIVE_INFINITY, FLOW), '');
    assert.equal(themeTransitionCss(Number.NEGATIVE_INFINITY, FLOW), '');
  });

  it('marks every transition !important so it wins the window', () => {
    assert.match(themeTransitionCss(1, FLOW), /!important/);
  });
});
