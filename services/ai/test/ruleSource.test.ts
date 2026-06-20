/**
 * Conversion of raw RULE#-namespace records into shared RuleSpecs: entityType
 * discrimination (RULE vs legacy CATEGORY_RULE), legacy pattern lowercasing,
 * legacy precedence preservation, and structural validation. Matching itself
 * is tested in @goldfinch/shared (the single matcher implementation).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareRulePrecedence, findMatchingRule } from '@goldfinch/shared/rules';
import type { RuleItem } from '@goldfinch/shared/types';

import {
  LEGACY_RULE_PRIORITY,
  convertRuleRecords,
} from '../src/ruleSource.js';
import type { LegacyCategoryRuleItem, RuleRecord } from '../src/ruleSource.js';

const PK = 'USER#goldfinch-home';

function sharedRule(overrides: Partial<RuleItem> & { ruleId: string }): RuleItem {
  return {
    PK,
    SK: `RULE#${overrides.ruleId}`,
    entityType: 'RULE',
    schemaVersion: 1,
    matchType: 'contains',
    pattern: 'coffee',
    categoryId: 'dining',
    priority: 100,
    enabled: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as RuleItem;
}

function legacyRule(
  matchType: LegacyCategoryRuleItem['matchType'],
  pattern: string,
  categoryId: string,
): LegacyCategoryRuleItem {
  return {
    SK: `RULE#${matchType}#${pattern}`,
    entityType: 'CATEGORY_RULE',
    matchType,
    pattern,
    categoryId,
  };
}

describe('convertRuleRecords entityType discrimination', () => {
  it('passes shared RULE items through with all matcher-relevant fields', () => {
    const { specs, dropped } = convertRuleRecords([
      sharedRule({
        ruleId: 'r1',
        matchType: 'exact',
        pattern: 'blue bottle coffee',
        categoryId: 'coffee',
        priority: 5,
        amountMinMinor: 100,
        amountMaxMinor: 900,
        enabled: true,
      }),
    ]);
    assert.equal(dropped, 0);
    assert.deepEqual(specs, [
      {
        ruleId: 'r1',
        matchType: 'exact',
        pattern: 'blue bottle coffee',
        amountMinMinor: 100,
        amountMaxMinor: 900,
        categoryId: 'coffee',
        priority: 5,
        enabled: true,
      },
    ]);
  });

  it('preserves enabled=false so disabled rules stay disabled', () => {
    const { specs } = convertRuleRecords([
      sharedRule({ ruleId: 'r1', enabled: false }),
    ]);
    assert.equal(specs[0]!.enabled, false);
  });

  it('converts legacy CATEGORY_RULE items, lowercasing the uppercase patterns', () => {
    const { specs, dropped } = convertRuleRecords([
      legacyRule('contains', 'WHOLE FOODS', 'groceries'),
    ]);
    assert.equal(dropped, 0);
    assert.equal(specs.length, 1);
    const spec = specs[0]!;
    assert.equal(spec.pattern, 'whole foods');
    assert.equal(spec.matchType, 'contains');
    assert.equal(spec.categoryId, 'groceries');
    assert.equal(spec.priority, LEGACY_RULE_PRIORITY);
    assert.equal(spec.enabled, true);
    assert.equal(spec.amountMinMinor, null);
    assert.equal(spec.amountMaxMinor, null);
    // The legacy SK doubles as a stable, unique ruleId.
    assert.equal(spec.ruleId, 'RULE#contains#WHOLE FOODS');
  });

  it('drops unknown entityTypes and structurally invalid records, counting them', () => {
    const records: RuleRecord[] = [
      { entityType: 'TRANSACTION' } as unknown as RuleRecord,
      sharedRule({ ruleId: 'ok', pattern: 'coffee' }),
      sharedRule({ ruleId: '', pattern: 'x' }), // empty ruleId
      sharedRule({ ruleId: 'bad-type', matchType: 'regex' as never }),
      sharedRule({ ruleId: 'bad-pattern', pattern: '   ' }),
      sharedRule({ ruleId: 'bad-priority', priority: Number.NaN }),
      legacyRule('contains', '', 'x'), // empty legacy pattern
      legacyRule('regex' as never, 'X', 'x'), // invalid legacy matchType
    ];
    const { specs, dropped } = convertRuleRecords(records);
    assert.equal(specs.length, 1);
    assert.equal(specs[0]!.ruleId, 'ok');
    assert.equal(dropped, 7);
  });

  it('sanitizes non-integer amount bounds to unbounded rather than crashing the matcher', () => {
    const { specs } = convertRuleRecords([
      sharedRule({
        ruleId: 'r1',
        amountMinMinor: 10.5 as never,
        amountMaxMinor: null,
      }),
    ]);
    assert.equal(specs[0]!.amountMinMinor, null);
    assert.equal(specs[0]!.amountMaxMinor, null);
    // Must be safe to feed straight into the shared matcher.
    assert.ok(
      findMatchingRule(specs, { payeeLower: 'blue bottle coffee', amountMinor: -1 }),
    );
  });
});

describe('legacy precedence preservation under the shared matcher', () => {
  it('within one matchType, longest legacy pattern wins (old tie rule)', () => {
    const { specs } = convertRuleRecords([
      legacyRule('contains', 'TRADER', 'short'),
      legacyRule('contains', "TRADER JOE'S", 'long'),
    ]);
    const winner = findMatchingRule(specs, {
      payeeLower: "trader joe's 123",
      amountMinor: -500,
    });
    assert.equal(winner?.categoryId, 'long');
  });

  it('equal-length legacy patterns tie-break lexicographically via the SK ruleId', () => {
    const { specs } = convertRuleRecords([
      legacyRule('contains', 'BB', 'second'),
      legacyRule('contains', 'AB', 'first'),
    ]);
    // Both match 'xabbx'; same priority and length, so ruleId
    // (RULE#contains#AB < RULE#contains#BB) decides -- the legacy
    // lexicographic-by-pattern rule, byte-for-byte.
    const winner = findMatchingRule(specs, { payeeLower: 'xabbx', amountMinor: -1 });
    assert.equal(winner?.categoryId, 'first');
    assert.ok(compareRulePrecedence(specs[1]!, specs[0]!) < 0);
  });

  it('legacy exact still beats legacy contains', () => {
    const { specs } = convertRuleRecords([
      legacyRule('contains', 'BLUE BOTTLE', 'contains-cat'),
      legacyRule('exact', 'BLUE BOTTLE COFFEE', 'exact-cat'),
    ]);
    const winner = findMatchingRule(specs, {
      payeeLower: 'blue bottle coffee',
      amountMinor: -650,
    });
    assert.equal(winner?.categoryId, 'exact-cat');
  });

  it('a new shared rule with a lower priority value outranks legacy seeds of the same matchType', () => {
    const { specs } = convertRuleRecords([
      legacyRule('contains', 'BLUE BOTTLE LONGER PATTERN', 'legacy-cat'),
      sharedRule({
        ruleId: 'user-rule',
        matchType: 'contains',
        pattern: 'blue bottle',
        categoryId: 'user-cat',
        priority: 100,
      }),
    ]);
    const winner = findMatchingRule(specs, {
      payeeLower: 'blue bottle longer pattern',
      amountMinor: -650,
    });
    // priority 100 < LEGACY_RULE_PRIORITY, so the user's rule wins even
    // though the legacy pattern is longer.
    assert.equal(winner?.categoryId, 'user-cat');
    assert.ok(100 < LEGACY_RULE_PRIORITY);
  });
});
