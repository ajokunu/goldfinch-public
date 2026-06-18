/**
 * Rule storage adapter for the shared RULE# contract (P7-5).
 *
 * Matching itself lives in @goldfinch/shared/rules (the single matcher for
 * the API CRUD/apply routes, this Lambda, and the client preview) -- this
 * module only converts what a `begins_with(SK, RULE#)` query returns into the
 * shared RuleSpec shape:
 *
 *   - entityType 'RULE'           the shared contract (RULE#<ruleId>); used
 *                                 as-is.
 *   - entityType 'CATEGORY_RULE'  this service's legacy items
 *                                 (RULE#<matchType>#<pattern>, uppercase
 *                                 normalized patterns). Both kinds share the
 *                                 RULE# SK namespace during the migration
 *                                 window, so readers MUST discriminate on
 *                                 entityType. Legacy patterns are lowercased
 *                                 here because the shared matcher compares
 *                                 against payeeLower.
 *
 * Legacy precedence is preserved exactly: all legacy rules get the same
 * priority, so within one matchType the shared tiebreak (longer pattern, then
 * ruleId == RULE#<matchType>#<pattern>, i.e. lexicographic by pattern) is
 * byte-for-byte the old "longest pattern, ties lexicographic" rule.
 *
 * Pure module (no AWS imports) so conversion is unit-testable in isolation.
 */

import type { RuleSpec } from '@goldfinch/shared/rules';
import type { MinorUnits, RuleItem, RuleMatchType } from '@goldfinch/shared/types';

/**
 * Priority assigned to legacy CATEGORY_RULE items (lower value = higher
 * precedence). New shared-contract rules created with a priority below this
 * outrank the seeded legacy map; rules above it defer to it.
 */
export const LEGACY_RULE_PRIORITY = 1000;

const MATCH_TYPES: ReadonlySet<string> = new Set(['exact', 'prefix', 'contains']);

/**
 * Legacy categorization rule shape (pre-P7-5). Kept only so the migration
 * window reads cleanly; no new writers exist.
 */
export interface LegacyCategoryRuleItem {
  SK: string;
  entityType: 'CATEGORY_RULE';
  matchType: RuleMatchType;
  /** Normalized UPPERCASE payee pattern (legacy normalizer). */
  pattern: string;
  categoryId: string;
}

/** What a RULE#-prefix query can return during the migration window. */
export type RuleRecord = RuleItem | LegacyCategoryRuleItem;

export interface ConvertedRules {
  specs: RuleSpec[];
  /** Records that were structurally invalid or of an unknown entityType. */
  dropped: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asOptionalBound(value: unknown): MinorUnits | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }
  return Number.isSafeInteger(value) ? (value as MinorUnits) : undefined;
}

function fromSharedRule(record: RuleItem): RuleSpec | null {
  if (
    !isNonEmptyString(record.ruleId) ||
    !MATCH_TYPES.has(record.matchType) ||
    !isNonEmptyString(record.pattern) ||
    !isNonEmptyString(record.categoryId) ||
    typeof record.priority !== 'number' ||
    !Number.isFinite(record.priority)
  ) {
    return null;
  }
  return {
    ruleId: record.ruleId,
    matchType: record.matchType,
    pattern: record.pattern,
    amountMinMinor: asOptionalBound(record.amountMinMinor) ?? null,
    amountMaxMinor: asOptionalBound(record.amountMaxMinor) ?? null,
    categoryId: record.categoryId,
    priority: record.priority,
    // The matcher treats undefined as enabled; pass through explicitly.
    enabled: record.enabled !== false,
    // Carry the transfer-marking ACTION so the daily-sync apply path can honor
    // it (parity with the API apply-now route). Absent == false; legacy rules
    // never set it, so fromLegacyRule deliberately omits it.
    markTransfer: record.markTransfer === true,
  };
}

function fromLegacyRule(record: LegacyCategoryRuleItem): RuleSpec | null {
  if (
    !MATCH_TYPES.has(record.matchType) ||
    !isNonEmptyString(record.pattern) ||
    !isNonEmptyString(record.categoryId)
  ) {
    return null;
  }
  const pattern = record.pattern.toLowerCase().trim();
  return {
    // The legacy SK (RULE#<matchType>#<pattern>) is unique per household and
    // makes the shared ruleId tiebreak reproduce legacy pattern ordering.
    ruleId: isNonEmptyString(record.SK)
      ? record.SK
      : `RULE#${record.matchType}#${pattern}`,
    matchType: record.matchType,
    pattern,
    amountMinMinor: null,
    amountMaxMinor: null,
    categoryId: record.categoryId,
    priority: LEGACY_RULE_PRIORITY,
    enabled: true,
  };
}

/**
 * Convert raw RULE#-namespace records into shared RuleSpecs, discriminating
 * on entityType. Anything structurally invalid or of an unknown entityType is
 * counted in `dropped` (the caller logs it; nothing fails silently).
 */
export function convertRuleRecords(records: readonly RuleRecord[]): ConvertedRules {
  const specs: RuleSpec[] = [];
  let dropped = 0;
  for (const record of records) {
    let spec: RuleSpec | null = null;
    if (record.entityType === 'RULE') {
      spec = fromSharedRule(record);
    } else if (record.entityType === 'CATEGORY_RULE') {
      spec = fromLegacyRule(record);
    }
    if (spec === null) {
      dropped += 1;
    } else {
      specs.push(spec);
    }
  }
  return { specs, dropped };
}
