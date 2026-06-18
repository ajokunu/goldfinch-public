/** Rule matcher (P7-5): exact > prefix > contains, priority, amount bounds. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RULE_MATCH_PRECEDENCE,
  RuleMatchError,
  compareRulePrecedence,
  findMatchingRule,
  ruleMarksTransfer,
  ruleMatches,
  type RuleSpec,
} from '../src/rules.js';

function rule(overrides: Partial<RuleSpec> & { ruleId: string }): RuleSpec {
  return {
    matchType: 'contains',
    pattern: 'coffee',
    categoryId: 'dining',
    priority: 100,
    ...overrides,
  };
}

const input = { payeeLower: 'blue bottle coffee', amountMinor: -550 };

describe('ruleMatches', () => {
  it('exact requires the whole payee', () => {
    assert.equal(ruleMatches(rule({ ruleId: 'r', matchType: 'exact', pattern: 'blue bottle coffee' }), input), true);
    assert.equal(ruleMatches(rule({ ruleId: 'r', matchType: 'exact', pattern: 'blue bottle' }), input), false);
  });

  it('prefix matches the start only', () => {
    assert.equal(ruleMatches(rule({ ruleId: 'r', matchType: 'prefix', pattern: 'blue' }), input), true);
    assert.equal(ruleMatches(rule({ ruleId: 'r', matchType: 'prefix', pattern: 'bottle' }), input), false);
  });

  it('contains matches anywhere', () => {
    assert.equal(ruleMatches(rule({ ruleId: 'r', pattern: 'bottle' }), input), true);
    assert.equal(ruleMatches(rule({ ruleId: 'r', pattern: 'tea' }), input), false);
  });

  it('is defensively case-insensitive on both sides', () => {
    assert.equal(ruleMatches(rule({ ruleId: 'r', pattern: 'COFFEE' }), input), true);
    assert.equal(
      ruleMatches(rule({ ruleId: 'r', pattern: 'coffee' }), { ...input, payeeLower: 'BLUE BOTTLE COFFEE' }),
      true,
    );
  });

  it('disabled rules never match; undefined enabled counts as enabled', () => {
    assert.equal(ruleMatches(rule({ ruleId: 'r', enabled: false }), input), false);
    assert.equal(ruleMatches(rule({ ruleId: 'r', enabled: true }), input), true);
    assert.equal(ruleMatches(rule({ ruleId: 'r' }), input), true);
  });

  it('empty or whitespace patterns never match', () => {
    assert.equal(ruleMatches(rule({ ruleId: 'r', pattern: '' }), input), false);
    assert.equal(ruleMatches(rule({ ruleId: 'r', pattern: '   ' }), input), false);
  });

  it('trims pattern and payee before comparing (stored padding cannot break matching)', () => {
    assert.equal(ruleMatches(rule({ ruleId: 'r', pattern: '  coffee  ' }), input), true);
    assert.equal(
      ruleMatches(rule({ ruleId: 'r', matchType: 'exact', pattern: ' blue bottle coffee ' }), input),
      true,
    );
    assert.equal(
      ruleMatches(
        rule({ ruleId: 'r', matchType: 'exact', pattern: 'blue bottle coffee' }),
        { ...input, payeeLower: '  blue bottle coffee  ' },
      ),
      true,
    );
    assert.equal(
      ruleMatches(
        rule({ ruleId: 'r', matchType: 'prefix', pattern: 'blue' }),
        { ...input, payeeLower: '  blue bottle coffee' },
      ),
      true,
    );
  });

  it('amount bounds are inclusive on abs(amount) — expenses and income alike', () => {
    const bounded = rule({ ruleId: 'r', amountMinMinor: 500, amountMaxMinor: 600 });
    assert.equal(ruleMatches(bounded, { ...input, amountMinor: -550 }), true);
    assert.equal(ruleMatches(bounded, { ...input, amountMinor: 550 }), true);
    assert.equal(ruleMatches(bounded, { ...input, amountMinor: -500 }), true);
    assert.equal(ruleMatches(bounded, { ...input, amountMinor: -600 }), true);
    assert.equal(ruleMatches(bounded, { ...input, amountMinor: -499 }), false);
    assert.equal(ruleMatches(bounded, { ...input, amountMinor: -601 }), false);
  });

  it('null bounds are unbounded', () => {
    assert.equal(
      ruleMatches(rule({ ruleId: 'r', amountMinMinor: null, amountMaxMinor: null }), input),
      true,
    );
    assert.equal(ruleMatches(rule({ ruleId: 'r', amountMinMinor: 500 }), input), true);
    assert.equal(ruleMatches(rule({ ruleId: 'r', amountMaxMinor: 500 }), input), false);
  });

  it('throws loudly on unsafe amounts and unknown match types', () => {
    assert.throws(() => ruleMatches(rule({ ruleId: 'r' }), { ...input, amountMinor: 0.5 }), RuleMatchError);
    assert.throws(
      () => ruleMatches(rule({ ruleId: 'r', matchType: 'regex' as never }), input),
      RuleMatchError,
    );
    assert.throws(
      () => ruleMatches(rule({ ruleId: 'r', amountMinMinor: 0.5 }), input),
      RuleMatchError,
    );
  });
});

describe('compareRulePrecedence / findMatchingRule', () => {
  it('locks the precedence order exact > prefix > contains', () => {
    assert.deepEqual(RULE_MATCH_PRECEDENCE, ['exact', 'prefix', 'contains']);
  });

  it('a matching exact rule beats prefix and contains regardless of priority', () => {
    const rules: RuleSpec[] = [
      rule({ ruleId: 'contains', pattern: 'coffee', priority: 1 }),
      rule({ ruleId: 'prefix', matchType: 'prefix', pattern: 'blue', priority: 1 }),
      rule({ ruleId: 'exact', matchType: 'exact', pattern: 'blue bottle coffee', priority: 999 }),
    ];
    assert.equal(findMatchingRule(rules, input)?.ruleId, 'exact');
  });

  it('prefix beats contains', () => {
    const rules: RuleSpec[] = [
      rule({ ruleId: 'contains', pattern: 'coffee', priority: 1 }),
      rule({ ruleId: 'prefix', matchType: 'prefix', pattern: 'blue', priority: 999 }),
    ];
    assert.equal(findMatchingRule(rules, input)?.ruleId, 'prefix');
  });

  it('within one matchType, lower priority value wins', () => {
    const rules: RuleSpec[] = [
      rule({ ruleId: 'late', pattern: 'coffee', priority: 200 }),
      rule({ ruleId: 'early', pattern: 'bottle', priority: 10 }),
    ];
    assert.equal(findMatchingRule(rules, input)?.ruleId, 'early');
  });

  it('priority ties break to the longer (more specific) pattern, then ruleId', () => {
    const rules: RuleSpec[] = [
      rule({ ruleId: 'short', pattern: 'coffee' }),
      rule({ ruleId: 'long', pattern: 'bottle coffee' }),
    ];
    assert.equal(findMatchingRule(rules, input)?.ruleId, 'long');

    const tied: RuleSpec[] = [
      rule({ ruleId: 'b-rule', pattern: 'coffee' }),
      rule({ ruleId: 'a-rule', pattern: 'bottle' }),
    ];
    assert.equal(findMatchingRule(tied, input)?.ruleId, 'a-rule');
  });

  it('non-matching rules never win, even at the strongest precedence', () => {
    const rules: RuleSpec[] = [
      rule({ ruleId: 'exact-miss', matchType: 'exact', pattern: 'starbucks', priority: 1 }),
      rule({ ruleId: 'contains-hit', pattern: 'coffee', priority: 999 }),
    ];
    assert.equal(findMatchingRule(rules, input)?.ruleId, 'contains-hit');
  });

  it('amount bounds exclude rules from the contest', () => {
    const rules: RuleSpec[] = [
      rule({ ruleId: 'bounded', matchType: 'exact', pattern: 'blue bottle coffee', amountMinMinor: 10_000 }),
      rule({ ruleId: 'open', pattern: 'coffee' }),
    ];
    assert.equal(findMatchingRule(rules, input)?.ruleId, 'open');
  });

  it('returns null when nothing matches or the list is empty', () => {
    assert.equal(findMatchingRule([], input), null);
    assert.equal(findMatchingRule([rule({ ruleId: 'r', pattern: 'tea' })], input), null);
  });

  it('compareRulePrecedence is a deterministic total order', () => {
    const a = rule({ ruleId: 'a', matchType: 'exact', pattern: 'x' });
    const b = rule({ ruleId: 'b', matchType: 'prefix', pattern: 'x' });
    assert.ok(compareRulePrecedence(a, b) < 0);
    assert.ok(compareRulePrecedence(b, a) > 0);
    assert.equal(compareRulePrecedence(a, { ...a }), 0);
  });
});

describe('ruleMarksTransfer (transfer-detection action)', () => {
  it('reflects markTransfer true / false / absent', () => {
    assert.equal(ruleMarksTransfer(rule({ ruleId: 'r', markTransfer: true })), true);
    assert.equal(ruleMarksTransfer(rule({ ruleId: 'r', markTransfer: false })), false);
    // Absent == false (back-compat: pre-transfer-rule writers never set it).
    assert.equal(ruleMarksTransfer(rule({ ruleId: 'r' })), false);
  });

  it('is an ACTION, not a match condition — matching is unaffected', () => {
    // A markTransfer rule matches and wins exactly like an ordinary one.
    const marking = rule({
      ruleId: 'cc-payoff',
      matchType: 'exact',
      pattern: 'blue bottle coffee',
      categoryId: 'transfers',
      markTransfer: true,
    });
    assert.equal(ruleMatches(marking, input), true);
    assert.equal(findMatchingRule([marking], input)?.ruleId, 'cc-payoff');
  });

  it('does not alter precedence ordering', () => {
    // Same pattern/priority, one marks transfer: precedence must be identical
    // (ties break on pattern length then ruleId, never on markTransfer).
    const plain = rule({ ruleId: 'same-id', pattern: 'coffee' });
    const marking = rule({ ruleId: 'same-id', pattern: 'coffee', markTransfer: true });
    assert.equal(compareRulePrecedence(plain, marking), 0);
    // Across a real ruleId difference the order is the SAME with or without the
    // flag — markTransfer is invisible to compareRulePrecedence.
    const a = rule({ ruleId: 'a', pattern: 'coffee' });
    const b = rule({ ruleId: 'b', pattern: 'coffee', markTransfer: true });
    assert.equal(compareRulePrecedence(a, b), -1);
    assert.equal(compareRulePrecedence(b, a), 1);
  });

  it('a markTransfer rule still wins the contest by normal precedence', () => {
    const rules: RuleSpec[] = [
      rule({ ruleId: 'contains', pattern: 'coffee', priority: 1 }),
      rule({
        ruleId: 'exact',
        matchType: 'exact',
        pattern: 'blue bottle coffee',
        markTransfer: true,
        priority: 999,
      }),
    ];
    const winner = findMatchingRule(rules, input);
    assert.equal(winner?.ruleId, 'exact');
    assert.equal(ruleMarksTransfer(winner as RuleSpec), true);
  });
});

describe('mutation hardening (P7-10)', () => {
  it('RuleMatchError carries its name and a precise message', () => {
    try {
      ruleMatches(rule({ ruleId: 'r', matchType: 'regex' as never }), input);
      assert.fail('expected a throw');
    } catch (error) {
      assert.ok(error instanceof RuleMatchError);
      assert.equal(error.name, 'RuleMatchError');
      assert.match(error.message, /unknown rule matchType: "regex"/);
    }
  });

  it('names the offending field in every validation message', () => {
    assert.throws(
      () => ruleMatches(rule({ ruleId: 'r' }), { ...input, amountMinor: 0.5 }),
      /amountMinor must be a safe integer, got 0\.5/,
    );
    assert.throws(
      () => ruleMatches(rule({ ruleId: 'r', amountMinMinor: 0.5 }), input),
      /amountMinMinor must be a safe integer/,
    );
    assert.throws(
      () => ruleMatches(rule({ ruleId: 'r', amountMaxMinor: 0.5 }), input),
      /amountMaxMinor must be a safe integer/,
    );
  });

  it('compareRulePrecedence rejects unknown matchTypes loudly', () => {
    assert.throws(
      () => compareRulePrecedence(rule({ ruleId: 'a', matchType: 'regex' as never }), rule({ ruleId: 'b' })),
      /unknown rule matchType: "regex"/,
    );
  });

  it('ruleId is the final asymmetric tie-breaker', () => {
    const a = rule({ ruleId: 'a' });
    const b = rule({ ruleId: 'b' });
    assert.equal(compareRulePrecedence(a, b), -1);
    assert.equal(compareRulePrecedence(b, a), 1);
  });

  it('findMatchingRule keeps the FIRST rule on an exact precedence tie and is order-independent otherwise', () => {
    // Same ruleId (a degenerate duplicate): compare() is 0, the first wins.
    const first = rule({ ruleId: 'same', categoryId: 'cat-first' });
    const second = rule({ ruleId: 'same', categoryId: 'cat-second' });
    assert.equal(findMatchingRule([first, second], input)?.categoryId, 'cat-first');
    // A decided ruleId tie-break cannot be flipped by input order.
    const winner = rule({ ruleId: 'a-wins' });
    const loser = rule({ ruleId: 'b-loses' });
    assert.equal(findMatchingRule([loser, winner], input)?.ruleId, 'a-wins');
    assert.equal(findMatchingRule([winner, loser], input)?.ruleId, 'a-wins');
  });
});
