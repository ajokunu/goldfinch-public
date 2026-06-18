/**
 * mixColor / withAlpha unit tests (design-spec components.md section 2: the
 * pure color-mix helpers are StrykerJS targets per decisions item 6).
 *
 * Every expected value is a hand-computed LITERAL (never recomputed with the
 * helpers under test) so arithmetic mutants cannot survive by symmetry.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mixColor, withAlpha } from '../mixColor';

describe('mixColor', () => {
  it('blends 50/50 black over white to mid gray', () => {
    // round(0*0.5 + 255*0.5) = 128 = 0x80 per channel.
    assert.equal(mixColor('#000000', 0.5, '#FFFFFF'), '#808080');
  });

  it('blends per channel with rounding (prototype 18% well tint)', () => {
    // round(0*0.18 + 255*0.82) = round(209.1) = 209 = 0xd1 per channel.
    assert.equal(mixColor('#000000', 0.18, '#FFFFFF'), '#d1d1d1');
  });

  it('returns the foreground exactly at pct 1', () => {
    assert.equal(mixColor('#112233', 1, '#445566'), '#112233');
  });

  it('returns the background exactly at pct 0', () => {
    assert.equal(mixColor('#112233', 0, '#445566'), '#445566');
  });

  it('blends asymmetric channels exactly', () => {
    // r: round(0x10*0.25 + 0x20*0.75) = round(28) = 0x1c
    // g: round(0x40*0.25 + 0x80*0.75) = round(112) = 0x70
    // b: round(0xFF*0.25 + 0x00*0.75) = round(63.75) = 64 = 0x40
    assert.equal(mixColor('#1040FF', 0.25, '#208000'), '#1c7040');
  });

  it('zero-pads single-digit channel values', () => {
    // r: round(10*0.5 + 0*0.5) = 5; g: round(11*0.5 + 1*0.5) = 6;
    // b: round(12*0.5 + 2*0.5) = 7.
    assert.equal(mixColor('#0a0b0c', 0.5, '#000102'), '#050607');
  });

  it('clamps pct above 1 to the foreground', () => {
    assert.equal(mixColor('#112233', 2, '#445566'), '#112233');
  });

  it('clamps negative pct to the background', () => {
    assert.equal(mixColor('#112233', -1, '#445566'), '#445566');
  });

  it('treats NaN pct as 0 (background)', () => {
    assert.equal(mixColor('#112233', Number.NaN, '#445566'), '#445566');
  });

  it('expands 3-digit hex (#19f = #1199ff)', () => {
    assert.equal(mixColor('#19f', 1, '#000000'), '#1199ff');
    assert.equal(mixColor('#000000', 0, '#19f'), '#1199ff');
  });

  it('ignores the alpha component of 8-digit hex', () => {
    assert.equal(mixColor('#11223380', 1, '#445566'), '#112233');
    assert.equal(mixColor('#000000', 0.5, '#FFFFFF00'), '#808080');
  });

  it('trims surrounding whitespace', () => {
    assert.equal(mixColor(' #112233 ', 1, '#445566'), '#112233');
  });

  it('falls back to the background when fg is unparsable', () => {
    assert.equal(mixColor('tomato', 0.5, '#445566'), '#445566');
    assert.equal(mixColor('#1234', 0.5, '#445566'), '#445566');
  });

  it('rejects hex with junk before or after the token (regex anchors)', () => {
    assert.equal(mixColor('x#112233', 0.5, '#445566'), '#445566');
    assert.equal(mixColor('#112233x', 0.5, '#445566'), '#445566');
    assert.equal(mixColor('##fff', 0.5, '#445566'), '#445566');
    assert.equal(mixColor('#112233', 0.5, 'x#445566'), '#112233');
  });

  it('falls back to the foreground when bg is unparsable', () => {
    assert.equal(mixColor('#112233', 0.5, 'transparent'), '#112233');
    assert.equal(mixColor('#112233', 0.5, '#12345'), '#112233');
  });

  it('returns fg verbatim when both are unparsable', () => {
    assert.equal(mixColor('nope', 0.5, 'also-nope'), 'nope');
    assert.equal(mixColor('', 0.5, ''), '');
  });
});

describe('withAlpha', () => {
  it('produces an rgba string from 6-digit hex', () => {
    assert.equal(withAlpha('#FF0000', 0.16), 'rgba(255, 0, 0, 0.16)');
    assert.equal(withAlpha('#112233', 0.5), 'rgba(17, 34, 51, 0.5)');
  });

  it('expands 3-digit hex before converting', () => {
    assert.equal(withAlpha('#fff', 0.5), 'rgba(255, 255, 255, 0.5)');
  });

  it('ignores the alpha digits of 8-digit hex input', () => {
    assert.equal(withAlpha('#11223300', 1), 'rgba(17, 34, 51, 1)');
  });

  it('clamps alpha into [0, 1]', () => {
    assert.equal(withAlpha('#000000', 5), 'rgba(0, 0, 0, 1)');
    assert.equal(withAlpha('#000000', -2), 'rgba(0, 0, 0, 0)');
    assert.equal(withAlpha('#000000', Number.NaN), 'rgba(0, 0, 0, 0)');
  });

  it('returns malformed input verbatim', () => {
    assert.equal(withAlpha('not-a-color', 0.5), 'not-a-color');
    assert.equal(withAlpha('#12345', 0.5), '#12345');
    assert.equal(withAlpha('', 0.5), '');
    assert.equal(withAlpha('x#112233', 0.5), 'x#112233');
    assert.equal(withAlpha('#112233x', 0.5), '#112233x');
  });

  it('trims surrounding whitespace', () => {
    assert.equal(withAlpha(' #102030 ', 0.25), 'rgba(16, 32, 48, 0.25)');
  });
});
