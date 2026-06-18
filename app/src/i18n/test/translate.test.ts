/**
 * Pure-lookup tests for translate() and the string table (shell.md 8.2/8.5).
 * The exhaustive sweeps lock the table contract; the literal spot-checks pin
 * the shell-critical strings so a silently edited table cannot pass.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ko, type I18nKey } from '../strings';
import { translate } from '../translate';

const ALL_KEYS = Object.keys(ko) as I18nKey[];

describe('translate', () => {
  it('returns the key itself for every English lookup', () => {
    for (const key of ALL_KEYS) {
      assert.equal(translate('en', key), key);
    }
  });

  it('returns the table value for every Korean lookup', () => {
    for (const key of ALL_KEYS) {
      assert.equal(translate('ko', key), ko[key]);
    }
  });

  it('pins the tab labels exactly (shell.md 1.1)', () => {
    assert.equal(translate('ko', 'Home'), '홈');
    assert.equal(translate('ko', 'Activity'), '활동');
    assert.equal(translate('ko', 'Budget'), '예산');
    assert.equal(translate('ko', 'Reports'), '리포트');
    assert.equal(translate('ko', 'More'), '더보기');
    assert.equal(translate('en', 'Home'), 'Home');
    assert.equal(translate('en', 'Activity'), 'Activity');
  });

  it('pins the nav/desktop titles exactly (shell.md 4.2)', () => {
    assert.equal(translate('ko', 'Dashboard'), '대시보드');
    assert.equal(translate('ko', 'Transactions'), '거래내역');
    assert.equal(translate('ko', 'Goals'), '목표');
    assert.equal(translate('ko', 'Recurring'), '정기결제');
    assert.equal(translate('ko', 'Rules'), '규칙');
    assert.equal(translate('ko', 'Import'), '가져오기');
    assert.equal(translate('ko', 'Settings'), '설정');
  });

  it('pins the FAB/add-sheet strings exactly (shell.md 2.2)', () => {
    assert.equal(translate('ko', 'Add'), '추가');
    assert.equal(translate('ko', 'Add transaction'), '거래 추가');
    assert.equal(translate('ko', 'Connect a bank via SimpleFIN'), 'SimpleFIN으로 은행 연결');
    assert.equal(translate('ko', 'Import CSV'), 'CSV 가져오기');
  });
});

describe('string table integrity', () => {
  it('has a non-empty Korean value for every key', () => {
    for (const key of ALL_KEYS) {
      const value = ko[key];
      assert.equal(typeof value, 'string');
      assert.ok(value.length > 0, `empty ko value for ${key}`);
    }
  });

  it('contains no emoji or [PARAM]/[DATA] placeholder leakage', () => {
    // House rule: no emojis anywhere. Middle dots, arrows, and em dashes used
    // by the Korean copy are explicitly allowed punctuation, not emoji.
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const key of ALL_KEYS) {
      assert.ok(!emoji.test(key), `emoji in key ${key}`);
      assert.ok(!emoji.test(ko[key]), `emoji in ko value for ${key}`);
      assert.ok(!key.includes('{'), `template placeholder in key ${key}`);
    }
  });

  it('excludes the prototype [PARAM] and [DATA] rows from the table', () => {
    // [PARAM] rows ship as messages.ts functions / locale date formatting;
    // [DATA] rows are API content rendered verbatim (shell.md 8.5).
    const excluded = [
      'Good morning',
      'Good morning, Alex',
      'Tuesday, June 10',
      'June spending',
      'Due in June',
      '6 months',
      'Where June went',
      'June 2026',
      'transactions tagged',
      'transaction tagged',
      'Categorized as',
      'Always tag',
      'Groceries',
      'Dining & Coffee',
      'Emergency Fund',
      'Japan Trip',
    ];
    const keySet = new Set<string>(ALL_KEYS);
    for (const key of excluded) {
      assert.ok(!keySet.has(key), `forbidden literal key shipped: ${key}`);
    }
  });
});
