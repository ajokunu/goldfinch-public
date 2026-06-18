/**
 * Live-preview computation (P7-5): evaluate a draft rule against recent
 * transactions CLIENT-SIDE using the shared matcher -- the exact functions
 * the API's apply-now route and the services/ai daily pass run, so the
 * preview can never disagree with the server about what matches.
 *
 * Two server behaviors are mirrored here:
 * - Apply-now (POST /rules/{ruleId}/apply) uses ruleMatches on each
 *   transaction and only updates rows that are uncategorized and not
 *   user-categorized -- it does NOT consult other rules.
 * - The daily rules pass uses findMatchingRule across ALL rules, so a match
 *   here can still lose to a stronger rule; those rows are flagged
 *   `outrankedBy` so the user understands why a new transaction might land
 *   in a different category.
 */
import type { TransactionDto } from '@goldfinch/shared/types';
import {
  findMatchingRule,
  ruleMatches,
  type RuleMatchInput,
  type RuleSpec,
} from '@goldfinch/shared/rules';

export interface PreviewMatch {
  txn: TransactionDto;
  /** Apply-now eligibility: uncategorized and never user-categorized. */
  eligible: boolean;
  /** A different rule that beats this one in the daily pass, if any. */
  outrankedBy: RuleSpec | null;
}

export interface RulePreviewResult {
  /** How many recent transactions were evaluated. */
  sampleSize: number;
  matches: PreviewMatch[];
  matchedCount: number;
  /** Matches apply-now would actually recategorize (matched and eligible). */
  applyEligibleCount: number;
}

/**
 * Pure: spec is the draft rule (already forced enabled by the form layer);
 * otherRules must exclude any persisted copy of the same ruleId so a stale
 * stored version never competes with its own edit.
 */
export function computeRulePreview(
  spec: RuleSpec,
  otherRules: readonly RuleSpec[],
  transactions: readonly TransactionDto[],
): RulePreviewResult {
  const candidates: readonly RuleSpec[] = [spec, ...otherRules];
  const matches: PreviewMatch[] = [];
  let applyEligibleCount = 0;

  for (const txn of transactions) {
    const input: RuleMatchInput = {
      payeeLower: txn.payee.toLowerCase(),
      amountMinor: txn.amountMinor,
    };
    if (!ruleMatches(spec, input)) continue;

    const winner = findMatchingRule(candidates, input);
    const outrankedBy =
      winner !== null && winner.ruleId !== spec.ruleId ? winner : null;
    const eligible = txn.categoryId === null && !txn.userCategorized;
    if (eligible) applyEligibleCount += 1;
    matches.push({ txn, eligible, outrankedBy });
  }

  return {
    sampleSize: transactions.length,
    matches,
    matchedCount: matches.length,
    applyEligibleCount,
  };
}
