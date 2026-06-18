/**
 * Deterministic category coloring (charts.md 1.3): djb2 over UTF-16 code
 * units, unsigned, modulo palette length. The independent BigInt reference
 * implementation below kills sign/overflow mutants that hand-picked cases
 * cannot reach.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { categoryColor } from '../categoryColor';

/** Independent djb2 reference in 32-bit unsigned space via BigInt. */
function djb2Unsigned(id: string): number {
  let hash = 5381n;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 33n + BigInt(id.charCodeAt(i))) & 0xffffffffn;
  }
  return Number(hash);
}

const palette10 = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];
const palette7 = ['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6'];

describe('categoryColor', () => {
  it('hashes "abc" to the known djb2 slot', () => {
    // djb2("abc") = 193485963 -> % 10 = 3, % 7 = 6.
    assert.equal(categoryColor('abc', palette10), 'p3');
    assert.equal(categoryColor('abc', palette7), 'q6');
  });

  it('hashes the empty string to the seed slot', () => {
    // 5381 % 10 = 1.
    assert.equal(categoryColor('', palette10), 'p1');
  });

  it('distinguishes adjacent ids', () => {
    assert.equal(categoryColor('a', palette10), 'p0'); // 177670 % 10
    assert.equal(categoryColor('b', palette10), 'p1'); // 177671 % 10
  });

  it('hashes non-ASCII code units', () => {
    // "e-acute" U+00E9: 5381 * 33 + 233 = 177806 -> % 10 = 6.
    assert.equal(categoryColor('é', palette10), 'p6');
  });

  it('matches the unsigned 32-bit reference on long ids (overflow path)', () => {
    const ids = [
      'category-9f8e7d6c5b4a39281706',
      'cat_01HZX4Y8K2M9QW3R5T7V9B1D3F',
      'Groceries and household supplies',
      'zzzzzzzzzzzzzzzzzzzzzzzz',
    ];
    for (const id of ids) {
      for (const palette of [palette10, palette7]) {
        const expected = palette[djb2Unsigned(id) % palette.length];
        assert.equal(categoryColor(id, palette), expected, `id=${id}`);
      }
    }
  });

  it('is stable across calls and across equal palette instances', () => {
    const first = categoryColor('cat-123', palette10);
    assert.equal(categoryColor('cat-123', palette10), first);
    assert.equal(categoryColor('cat-123', [...palette10]), first);
  });

  it('does not depend on sibling categories (no list-order dependence)', () => {
    // The color is a pure function of (id, palette) -- recomputing after
    // "removing a neighbor" cannot change it, by construction.
    const before = categoryColor('cat-keep', palette10);
    categoryColor('cat-removed', palette10);
    assert.equal(categoryColor('cat-keep', palette10), before);
  });

  it('throws a descriptive RangeError on an empty palette', () => {
    assert.throws(
      () => categoryColor('abc', []),
      (error: unknown) =>
        error instanceof RangeError &&
        /non-empty palette/.test((error as Error).message),
    );
  });
});
