/**
 * Pure language-resolution tests (shell.md 8.4): explicit settings win, the
 * 'system' setting maps the device locale's primary subtag, and detection
 * failure (null) falls back to English.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { localeTag, resolveLang } from '../resolve';

describe('resolveLang', () => {
  it('honors an explicit preference regardless of the device locale', () => {
    assert.equal(resolveLang('en', 'ko-KR'), 'en');
    assert.equal(resolveLang('en', null), 'en');
    assert.equal(resolveLang('ko', 'en-US'), 'ko');
    assert.equal(resolveLang('ko', null), 'ko');
  });

  it('resolves system to ko for Korean locales', () => {
    assert.equal(resolveLang('system', 'ko'), 'ko');
    assert.equal(resolveLang('system', 'ko-KR'), 'ko');
    assert.equal(resolveLang('system', 'ko-Kore-KR'), 'ko');
    assert.equal(resolveLang('system', 'ko_KR'), 'ko');
    assert.equal(resolveLang('system', 'KO-KR'), 'ko');
    assert.equal(resolveLang('system', '  ko-KR  '), 'ko');
  });

  it('resolves system to en for everything else', () => {
    assert.equal(resolveLang('system', 'en-US'), 'en');
    assert.equal(resolveLang('system', 'en'), 'en');
    assert.equal(resolveLang('system', 'ja-JP'), 'en');
    assert.equal(resolveLang('system', ''), 'en');
    assert.equal(resolveLang('system', '-'), 'en');
  });

  it('does not match lookalike primary subtags such as kok (Konkani)', () => {
    assert.equal(resolveLang('system', 'kok'), 'en');
    assert.equal(resolveLang('system', 'kok-IN'), 'en');
    assert.equal(resolveLang('system', 'k'), 'en');
  });

  it('falls back to en when locale detection failed (null)', () => {
    assert.equal(resolveLang('system', null), 'en');
  });
});

describe('localeTag', () => {
  it('maps each language to its Intl BCP-47 tag', () => {
    assert.equal(localeTag('en'), 'en-US');
    assert.equal(localeTag('ko'), 'ko-KR');
  });
});
