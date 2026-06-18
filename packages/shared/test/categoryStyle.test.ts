/**
 * P10-1/P10-2/P10-4 category icon + color contract — exhaustive,
 * mutation-grade. The color/glyph key sets are locked element-by-element and
 * by length, both validators are proven exhaustively + on adversarial input,
 * and `resolveCategoryColorKey` is pinned across user-key, hash-pick, and
 * dirty-data branches with the failure path asserted to log through the shared
 * logger and degrade instead of throwing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CATEGORY_COLOR_KEYS,
  GLYPH_KEYS,
  ICON_PRECEDENCE_DOC,
  isCategoryColorKey,
  isGlyphKey,
  resolveCategoryColorKey,
  type CategoryColorKey,
} from '../src/categoryStyle.js';
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

/**
 * Local re-derivation of the djb2 pick over the FULL color-key set, used to
 * pin `resolveCategoryColorKey`'s auto branch independently of the impl.
 */
function expectedHashKey(categoryId: string): CategoryColorKey {
  let hash = 5381;
  for (let i = 0; i < categoryId.length; i += 1) {
    hash = (Math.imul(hash, 33) + categoryId.charCodeAt(i)) | 0;
  }
  const index = (hash >>> 0) % CATEGORY_COLOR_KEYS.length;
  return CATEGORY_COLOR_KEYS[index]!;
}

// ---------------------------------------------------------------------------
// CATEGORY_COLOR_KEYS
// ---------------------------------------------------------------------------

describe('CATEGORY_COLOR_KEYS', () => {
  it('is exactly the 11 palette keys, in the locked prototype order', () => {
    assert.deepEqual(CATEGORY_COLOR_KEYS, [
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      'c7',
      'c8',
      'c9',
      'c0',
      'other',
    ]);
  });

  it('has exactly 11 keys with no duplicates', () => {
    assert.equal(CATEGORY_COLOR_KEYS.length, 11);
    assert.equal(new Set(CATEGORY_COLOR_KEYS).size, CATEGORY_COLOR_KEYS.length);
  });

  it('mirrors the app CategoryPalette key set (c1..c9, c0, other)', () => {
    // The app `CategoryPalette` interface (app/src/ui/themeResolve.ts) declares
    // these exact members; this pins the contract against silent additions.
    const appCategoryPaletteKeys = [
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      'c7',
      'c8',
      'c9',
      'c0',
      'other',
    ];
    assert.deepEqual([...CATEGORY_COLOR_KEYS], appCategoryPaletteKeys);
  });
});

describe('isCategoryColorKey', () => {
  it('returns true for every key in the set', () => {
    for (const key of CATEGORY_COLOR_KEYS) {
      assert.equal(isCategoryColorKey(key), true, `expected ${key} valid`);
    }
  });

  it('rejects near-miss and unknown strings', () => {
    for (const bad of ['c10', 'C1', 'c', '', 'cat', 'c1 ', ' c1', 'other ', 'hex', '#fff']) {
      assert.equal(isCategoryColorKey(bad), false, `expected ${JSON.stringify(bad)} invalid`);
    }
  });

  it('rejects non-string inputs without throwing', () => {
    for (const bad of [undefined, null, 0, 1, true, false, {}, [], Symbol('c1')]) {
      assert.equal(isCategoryColorKey(bad), false);
    }
  });
});

// ---------------------------------------------------------------------------
// GLYPH_KEYS
// ---------------------------------------------------------------------------

describe('GLYPH_KEYS', () => {
  it('is a non-empty, deduplicated, ~48-key curated set', () => {
    assert.ok(GLYPH_KEYS.length >= 40, 'curated set should be ~48 keys');
    assert.equal(new Set(GLYPH_KEYS).size, GLYPH_KEYS.length, 'no duplicate keys');
  });

  it('every key is a stable lowercase kebab-case token', () => {
    for (const key of GLYPH_KEYS) {
      assert.match(key, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${key} must be kebab-case`);
    }
  });

  it('covers the default-category + P10-2 spread glyphs the contract names', () => {
    // These are the glyphs P10-2 explicitly calls out plus the default-category
    // identity glyphs; the app glyph map MUST contain (at least) these keys.
    const required = [
      // default-category identity (mirror of app CATEGORY_ICONS)
      'money',
      'hand-coins',
      'basket',
      'fork-knife',
      'coffee',
      'house',
      'lightbulb',
      'wifi-high',
      'broom',
      'gas-pump',
      'car',
      'garage',
      'bus',
      'shopping-bag',
      't-shirt',
      'devices',
      'arrows-clockwise',
      'film-slate',
      'airplane-tilt',
      'first-aid-kit',
      'barbell',
      'scissors',
      'shield-check',
      'receipt-x',
      'percent',
      'gift',
      'paw-print',
      'graduation-cap',
      'credit-card',
      'arrows-left-right',
      'shapes',
      // fallback-rule extras
      'baby',
      'chart-line-up',
      'music-notes',
      'wrench',
      // resolution terminals
      'circle-dashed',
      'tag',
      // P10-2 spread additions
      'heart',
      'book',
      'game-controller',
      'phone',
      'leaf',
      'ticket',
    ];
    const set = new Set<string>(GLYPH_KEYS);
    for (const key of required) {
      assert.ok(set.has(key), `GLYPH_KEYS missing required contract key: ${key}`);
    }
  });
});

describe('isGlyphKey', () => {
  it('returns true for every key in the set', () => {
    for (const key of GLYPH_KEYS) {
      assert.equal(isGlyphKey(key), true, `expected ${key} valid`);
    }
  });

  it('rejects unknown / near-miss strings', () => {
    for (const bad of ['Coffee', 'coffee ', 'unknown-glyph', '', 'fork_knife', 'paw']) {
      assert.equal(isGlyphKey(bad), false, `expected ${JSON.stringify(bad)} invalid`);
    }
  });

  it('rejects non-string inputs without throwing', () => {
    for (const bad of [undefined, null, 42, true, {}, [], Symbol('coffee')]) {
      assert.equal(isGlyphKey(bad), false);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveCategoryColorKey — P10-4 color precedence
// ---------------------------------------------------------------------------

describe('resolveCategoryColorKey', () => {
  it('returns the user key verbatim when it is a valid palette key', () => {
    for (const key of CATEGORY_COLOR_KEYS) {
      // categoryId is irrelevant on the user-key branch; vary it to prove so.
      assert.equal(resolveCategoryColorKey(key, 'groceries'), key);
      assert.equal(resolveCategoryColorKey(key, 'literally-anything-else'), key);
    }
  });

  it('falls back to the deterministic hash pick when the user key is absent', () => {
    for (const id of ['groceries', 'dining-drinks', 'paycheck', 'x', '', 'a-very-long-slug-name']) {
      const expected = expectedHashKey(id);
      assert.equal(resolveCategoryColorKey(undefined, id), expected);
      assert.equal(resolveCategoryColorKey(null, id), expected);
    }
  });

  it('always returns a member of CATEGORY_COLOR_KEYS on the hash branch', () => {
    const set = new Set<string>(CATEGORY_COLOR_KEYS);
    for (let i = 0; i < 500; i += 1) {
      const key = resolveCategoryColorKey(undefined, `category-${i}`);
      assert.ok(set.has(key), `${key} not in palette`);
    }
  });

  it('is deterministic and order-independent for the same id', () => {
    const a = resolveCategoryColorKey(undefined, 'coffee-shops');
    const b = resolveCategoryColorKey(undefined, 'coffee-shops');
    assert.equal(a, b);
  });

  it('distributes across more than one palette key (hash is not constant)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      seen.add(resolveCategoryColorKey(undefined, `id-${i}`));
    }
    assert.ok(seen.size > 1, 'hash pick collapsed to a single key');
  });

  it('includes the `other` key in the hash domain (full set, no slicing)', () => {
    // Some id must hash onto the last key; prove the pick is over the full
    // length, not a truncated prefix.
    let sawOther = false;
    for (let i = 0; i < 1000 && !sawOther; i += 1) {
      if (resolveCategoryColorKey(undefined, `seed-${i}`) === 'other') sawOther = true;
    }
    assert.equal(sawOther, true, 'hash pick never reaches `other` -> domain truncated');
  });

  it('ignores an invalid user key, logs a warning, and uses the hash pick', () => {
    const { logger, lines } = captureLogger();
    const id = 'groceries';
    const result = resolveCategoryColorKey('#ff0000', id, logger);
    assert.equal(result, expectedHashKey(id));
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.level, 'warn');
    assert.match(lines[0]!.line, /invalid category color key/);
  });

  it('does not log when the user key is valid', () => {
    const { logger, lines } = captureLogger();
    const result = resolveCategoryColorKey('c3', 'groceries', logger);
    assert.equal(result, 'c3');
    assert.equal(lines.length, 0);
  });

  it('does not log when the user key is simply absent (auto path is not an error)', () => {
    const { logger, lines } = captureLogger();
    resolveCategoryColorKey(undefined, 'groceries', logger);
    resolveCategoryColorKey(null, 'groceries', logger);
    assert.equal(lines.length, 0);
  });

  it('never throws on adversarial inputs', () => {
    assert.doesNotThrow(() => resolveCategoryColorKey('', ''));
    assert.doesNotThrow(() => resolveCategoryColorKey('not-a-key', ''));
    assert.doesNotThrow(() => resolveCategoryColorKey(undefined, ''));
  });
});

// ---------------------------------------------------------------------------
// Icon precedence is documented (resolved in the app), not implemented here
// ---------------------------------------------------------------------------

describe('ICON_PRECEDENCE_DOC', () => {
  it('documents the app-resolved icon precedence rule', () => {
    assert.match(ICON_PRECEDENCE_DOC, /userIconKey/);
    assert.match(ICON_PRECEDENCE_DOC, /fallback/);
  });
});
