/**
 * Parameterized-message tests (shell.md 8.3). Every function is asserted in
 * both languages with exact expected strings (the Korean wording is verbatim
 * from the prototype's inline GF_LANG branches), including the plural and
 * time-of-day boundaries Stryker mutates.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  alwaysTagAs,
  categorizedAs,
  createsRuleAndRetags,
  createsRuleForFuture,
  greeting,
  matchesRuleFor,
  periodLimitLabel,
  periodPickerLabel,
  rulesExplainer,
  spentThisMonth,
  taggedCount,
} from '../messages';

describe('taggedCount', () => {
  it('pluralizes English on the n === 1 boundary', () => {
    assert.equal(taggedCount('en', 0), '0 transactions tagged');
    assert.equal(taggedCount('en', 1), '1 transaction tagged');
    assert.equal(taggedCount('en', 2), '2 transactions tagged');
  });

  it('uses the Korean counter for any n', () => {
    assert.equal(taggedCount('ko', 0), '0건 적용됨');
    assert.equal(taggedCount('ko', 1), '1건 적용됨');
    assert.equal(taggedCount('ko', 7), '7건 적용됨');
  });
});

describe('categorizedAs', () => {
  it('renders both languages with the category interpolated verbatim', () => {
    assert.equal(categorizedAs('en', 'Dining'), 'Categorized as Dining');
    assert.equal(categorizedAs('ko', '외식'), '외식(으)로 분류됨');
    // Category names are user/API data: never translated by this function.
    assert.equal(categorizedAs('ko', 'Dining'), 'Dining(으)로 분류됨');
  });
});

describe('matchesRuleFor', () => {
  it('renders both languages with the payee verbatim', () => {
    assert.equal(
      matchesRuleFor('en', 'Blue Bottle'),
      'Matches your rule for Blue Bottle',
    );
    assert.equal(matchesRuleFor('ko', 'Blue Bottle'), 'Blue Bottle 규칙과 일치');
  });
});

describe('alwaysTagAs', () => {
  it('renders both languages with payee and category verbatim', () => {
    assert.equal(
      alwaysTagAs('en', 'Blue Bottle', 'Dining'),
      'Always tag Blue Bottle as Dining',
    );
    assert.equal(
      alwaysTagAs('ko', 'Blue Bottle', '외식'),
      'Blue Bottle → 항상 외식',
    );
  });
});

describe('createsRuleAndRetags', () => {
  it('pluralizes English on the n === 1 boundary', () => {
    assert.equal(
      createsRuleAndRetags('en', 1),
      'Creates a rule and re-tags 1 past transaction',
    );
    assert.equal(
      createsRuleAndRetags('en', 3),
      'Creates a rule and re-tags 3 past transactions',
    );
  });

  it('uses the Korean counter for any n', () => {
    assert.equal(createsRuleAndRetags('ko', 1), '규칙 생성 및 과거 거래 1건 재분류');
    assert.equal(createsRuleAndRetags('ko', 3), '규칙 생성 및 과거 거래 3건 재분류');
  });
});

describe('createsRuleForFuture', () => {
  it('renders both languages', () => {
    assert.equal(
      createsRuleForFuture('en'),
      'Creates a rule for future transactions',
    );
    assert.equal(createsRuleForFuture('ko'), '향후 거래에 규칙 적용');
  });
});

describe('spentThisMonth', () => {
  it('wraps a pre-formatted amount without reformatting it', () => {
    assert.equal(spentThisMonth('en', '$420.10'), '$420.10 spent this month');
    assert.equal(spentThisMonth('ko', '₩550,000'), '이번 달 ₩550,000 지출');
  });
});

describe('rulesExplainer', () => {
  it('ships the restructured single-sentence explainer in both languages', () => {
    assert.equal(
      rulesExplainer('en'),
      'GoldFinch auto-categorizes new transactions with these rules. Each time you set a category and keep Always tag on, it learns a new one.',
    );
    assert.equal(
      rulesExplainer('ko'),
      'GoldFinch는 이 규칙으로 새 거래를 자동 분류합니다. 카테고리를 지정할 때 항상 태그를 켜두면 새 규칙을 학습합니다.',
    );
  });
});

describe('greeting', () => {
  it('switches at the 12:00 and 18:00 boundaries in English', () => {
    assert.equal(greeting('en', 0), 'Good morning');
    assert.equal(greeting('en', 11), 'Good morning');
    assert.equal(greeting('en', 12), 'Good afternoon');
    assert.equal(greeting('en', 17), 'Good afternoon');
    assert.equal(greeting('en', 18), 'Good evening');
    assert.equal(greeting('en', 23), 'Good evening');
  });

  it('switches at the same boundaries in Korean', () => {
    assert.equal(greeting('ko', 11), '좋은 아침이에요');
    assert.equal(greeting('ko', 12), '좋은 오후예요');
    assert.equal(greeting('ko', 17), '좋은 오후예요');
    assert.equal(greeting('ko', 18), '좋은 저녁이에요');
  });

  it('appends the name verbatim in both languages', () => {
    assert.equal(greeting('en', 9, 'Aaron'), 'Good morning, Aaron');
    assert.equal(greeting('ko', 9, 'Aaron'), '좋은 아침이에요, Aaron');
  });

  it('omits the name suffix when absent or empty', () => {
    assert.equal(greeting('en', 9), 'Good morning');
    assert.equal(greeting('en', 9, ''), 'Good morning');
    assert.equal(greeting('ko', 20, ''), '좋은 저녁이에요');
  });
});

describe('periodPickerLabel', () => {
  it('returns the period-picker eyebrow in both languages', () => {
    assert.equal(periodPickerLabel('en'), 'Period');
    assert.equal(periodPickerLabel('ko'), '기간');
  });
});

describe('periodLimitLabel', () => {
  it('qualifies the limit eyebrow by cadence in English', () => {
    assert.equal(periodLimitLabel('en', 'weekly'), 'Weekly limit');
    assert.equal(periodLimitLabel('en', 'monthly'), 'Monthly limit');
    assert.equal(periodLimitLabel('en', 'yearly'), 'Yearly limit');
  });

  it('qualifies the limit eyebrow by cadence in Korean', () => {
    assert.equal(periodLimitLabel('ko', 'weekly'), '주간 한도');
    assert.equal(periodLimitLabel('ko', 'monthly'), '월 한도');
    assert.equal(periodLimitLabel('ko', 'yearly'), '연간 한도');
  });
});
