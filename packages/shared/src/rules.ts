/**
 * Rule matcher (P7-5) — the single matching implementation for the shared
 * RULE#<ruleId> contract. The API routes (CRUD + apply-now), the services/ai
 * daily rules pass, and the client's "test against recent" preview all call
 * THIS module; nobody re-implements precedence.
 *
 * Matching semantics:
 *   - Patterns match against the transaction's payeeLower; both sides are
 *     defensively lowercased here so a stored mixed-case pattern cannot
 *     silently never-match.
 *   - matchType precedence: exact > prefix > contains.
 *   - Within one matchType: lower `priority` value wins; ties break to the
 *     LONGER pattern (more specific), then ruleId — fully deterministic.
 *   - Amount bounds (when set) are INCLUSIVE and compared against
 *     abs(amountMinor): "between $10 and $20" means the bill's magnitude,
 *     for expenses (negative) and income (positive) alike.
 *   - Disabled rules and empty patterns never match.
 */

import type { RuleMatchType } from './types/entities.js';
import type { MinorUnits } from './types/common.js';

export class RuleMatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleMatchError';
  }
}

/** Precedence order, strongest first. */
export const RULE_MATCH_PRECEDENCE: readonly RuleMatchType[] = [
  'exact',
  'prefix',
  'contains',
];

/** The minimal rule shape the matcher needs; full RuleItem/RuleDto satisfy it. */
export interface RuleSpec {
  ruleId: string;
  matchType: RuleMatchType;
  /** Compared lowercased. */
  pattern: string;
  /** Inclusive bound on abs(amountMinor); null/undefined = unbounded. */
  amountMinMinor?: MinorUnits | null;
  /** Inclusive bound on abs(amountMinor); null/undefined = unbounded. */
  amountMaxMinor?: MinorUnits | null;
  categoryId: string;
  /** Lower value = higher precedence within the same matchType. */
  priority: number;
  /** undefined counts as enabled (pre-Phase-7 writers never set it). */
  enabled?: boolean;
}

/** The minimal transaction shape the matcher needs. */
export interface RuleMatchInput {
  /** Lowercased payee (TransactionItem.payeeLower). */
  payeeLower: string;
  /** Signed minor units; bounds compare against the absolute value. */
  amountMinor: MinorUnits;
}

function precedenceRank(matchType: RuleMatchType): number {
  const rank = RULE_MATCH_PRECEDENCE.indexOf(matchType);
  if (rank === -1) {
    throw new RuleMatchError(`unknown rule matchType: "${String(matchType)}"`);
  }
  return rank;
}

/** True when `rule` matches `input` (enabled, pattern hit, amount in bounds). */
export function ruleMatches(rule: RuleSpec, input: RuleMatchInput): boolean {
  if (rule.enabled === false) {
    return false;
  }
  const pattern = rule.pattern.toLowerCase().trim();
  if (pattern.length === 0) {
    return false;
  }
  if (!Number.isSafeInteger(input.amountMinor)) {
    throw new RuleMatchError(
      `amountMinor must be a safe integer, got ${String(input.amountMinor)}`,
    );
  }
  const payee = input.payeeLower.toLowerCase().trim();

  let patternHit: boolean;
  switch (rule.matchType) {
    case 'exact':
      patternHit = payee === pattern;
      break;
    case 'prefix':
      patternHit = payee.startsWith(pattern);
      break;
    case 'contains':
      patternHit = payee.includes(pattern);
      break;
    default:
      throw new RuleMatchError(`unknown rule matchType: "${String(rule.matchType)}"`);
  }
  if (!patternHit) {
    return false;
  }

  const magnitude = Math.abs(input.amountMinor);
  if (rule.amountMinMinor !== undefined && rule.amountMinMinor !== null) {
    if (!Number.isSafeInteger(rule.amountMinMinor)) {
      throw new RuleMatchError('amountMinMinor must be a safe integer');
    }
    if (magnitude < rule.amountMinMinor) {
      return false;
    }
  }
  if (rule.amountMaxMinor !== undefined && rule.amountMaxMinor !== null) {
    if (!Number.isSafeInteger(rule.amountMaxMinor)) {
      throw new RuleMatchError('amountMaxMinor must be a safe integer');
    }
    if (magnitude > rule.amountMaxMinor) {
      return false;
    }
  }
  return true;
}

/**
 * Deterministic total order over rules: matchType precedence, then priority
 * ascending, then pattern length descending, then ruleId ascending. Exported
 * so list UIs can show rules in evaluation order.
 */
export function compareRulePrecedence(a: RuleSpec, b: RuleSpec): number {
  return (
    precedenceRank(a.matchType) - precedenceRank(b.matchType) ||
    a.priority - b.priority ||
    b.pattern.length - a.pattern.length ||
    (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0)
  );
}

/**
 * The single winning rule for a transaction, or null when nothing matches.
 * Evaluation order is compareRulePrecedence over the MATCHING rules, so a
 * matching exact rule always beats any prefix/contains rule regardless of
 * priority values.
 */
export function findMatchingRule(
  rules: readonly RuleSpec[],
  input: RuleMatchInput,
): RuleSpec | null {
  let winner: RuleSpec | null = null;
  for (const rule of rules) {
    if (!ruleMatches(rule, input)) {
      continue;
    }
    if (winner === null || compareRulePrecedence(rule, winner) < 0) {
      winner = rule;
    }
  }
  return winner;
}
