/**
 * goldfinchMark unit tests (PHASE9-DECISIONS P9-2 item 7: the
 * pull-to-refresh mark is a pure, deterministic Skia path -- no asset
 * decode, no per-frame math). Asserts the path's structure, bounds, and
 * linear scaling rather than its artistic merit.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { goldfinchMarkPath } from '../motion/goldfinchMark';

function numbersIn(path: string): number[] {
  return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function commandsIn(path: string): string[] {
  return path.match(/[A-Z]/g) ?? [];
}

describe('goldfinchMarkPath', () => {
  it('is one closed silhouette: M start, Z end, only M/L/C commands', () => {
    const path = goldfinchMarkPath(100);
    const commands = commandsIn(path);
    assert.equal(commands[0], 'M');
    assert.equal(commands[commands.length - 1], 'Z');
    assert.ok(path.startsWith('M '));
    assert.ok(path.endsWith(' Z'));
    for (const command of commands) {
      assert.ok(['M', 'L', 'C', 'Z'].includes(command));
    }
    // The traced outline: beak, crown/nape/back curves, three tail lines,
    // belly/chest/throat curves -- 12 drawing commands plus the close.
    assert.equal(commands.length, 13);
  });

  it('keeps every coordinate inside the size box', () => {
    for (const size of [16, 30, 100]) {
      for (const value of numbersIn(goldfinchMarkPath(size))) {
        assert.ok(value >= 0 && value <= size, `${value} outside 0..${size}`);
      }
    }
  });

  it('scales linearly (size 200 doubles every size-100 coordinate)', () => {
    const base = numbersIn(goldfinchMarkPath(100));
    const doubled = numbersIn(goldfinchMarkPath(200));
    assert.equal(base.length, doubled.length);
    base.forEach((value, index) => {
      assert.ok(Math.abs(value * 2 - (doubled[index] as number)) < 0.02);
    });
  });

  it('is deterministic and rounds to at most 2 decimals', () => {
    assert.equal(goldfinchMarkPath(30), goldfinchMarkPath(30));
    for (const value of numbersIn(goldfinchMarkPath(33))) {
      assert.equal(Math.round(value * 100) / 100, value);
    }
  });

  it('degrades junk sizes to an all-zero (still valid) path', () => {
    for (const size of [0, -10, Number.NaN]) {
      const values = numbersIn(goldfinchMarkPath(size));
      assert.ok(values.length > 0);
      for (const value of values) assert.equal(value, 0);
    }
  });
});
