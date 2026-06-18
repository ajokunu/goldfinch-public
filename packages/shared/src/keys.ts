/**
 * DynamoDB key builders — the single source of truth for every key string in the
 * GoldFinch single table. No key literal may be assembled outside this module.
 *
 * Partition: PK = USER#<household> (the `household` access-token claim, value
 * "goldfinch-home"), LOCKED by the Resolved Decisions Log. Identity is always
 * re-derived server-side from the JWT.
 *
 * Sort-key patterns:
 *   PROFILE#<cognitoSub>            user profile (one per Cognito user)
 *   ACCT#<accountId>                account
 *   TXN#<yyyy-mm-dd>#<txnId>        transaction (date-first => native range queries)
 *   TXNPTR#<txnId>                  pointer to the transaction's current SK
 *   BUDGET#<categoryId>             budget / category target
 *   CATEGORY#<categoryId>           category definition
 *   SYNC#STATE                      singleton sync state
 *   SYNC#RUNNING                    singleton in-flight marker (on-demand sync debounce)
 *
 * Phase 7 additions (PHASE7-DECISIONS.md, additive only):
 *   RECURRING#<seriesId>            detected recurring/subscription series (P7-1)
 *   GOAL#<goalId>                   savings goal (P7-2)
 *   CONTRIB#<goalId>#<ts>           manual goal contribution, timestamp-sorted (P7-2)
 *   HOLDING#<accountId>#<holdingId> investment holding snapshot (P7-3)
 *   HOLDINGBASIS#<accountId>#<symbol> user-owned manual cost basis (sync-safe)
 *   NETWORTH#<yyyy-mm-dd>           daily net-worth snapshot (P7-4)
 *   RULE#<ruleId>                   categorization rule, shared contract (P7-5)
 *   TXNPTR#import:<importId>:<rowHash>  CSV-import idempotency pointer (P7-6)
 *   ATTACH#<txnId>#<attachId>       transaction attachment metadata (P7-9)
 *   PUSHTOKEN#<deviceId>            Expo push token registration (P7-8)
 *
 * GSI1 (per-account transactions): GSI1PK = USER#<household>#ACCT#<accountId>,
 *   GSI1SK = <yyyy-mm-dd>#<txnId>.
 * GSI2 (per-category spend):       GSI2PK = USER#<household>#CAT#<categoryId>,
 *   GSI2SK = <yyyy-mm-dd>#<txnId>. The txnId suffix makes the key unique across
 *   multiple same-day transactions in one category (master plan section 6, decision 5).
 */

import type { IsoDate, IsoTimestamp } from './types/common.js';
// Type-only import; erased at emit, so no runtime cycle with entities.ts.
import type { CategoryType } from './types/entities.js';

export const GSI1_NAME = 'GSI1';
export const GSI2_NAME = 'GSI2';

export type UserPk = `USER#${string}`;
export type ProfileSk = `PROFILE#${string}`;
export type AcctSk = `ACCT#${string}`;
export type TxnSk = `TXN#${string}#${string}`;
export type TxnPointerSk = `TXNPTR#${string}`;
export type BudgetSk = `BUDGET#${string}`;
export type CategorySk = `CATEGORY#${string}`;
export type SyncStateSk = 'SYNC#STATE';
export type SyncRunningSk = 'SYNC#RUNNING';
export type RecurringSk = `RECURRING#${string}`;
export type GoalSk = `GOAL#${string}`;
export type ContribSk = `CONTRIB#${string}#${string}`;
export type HoldingSk = `HOLDING#${string}#${string}`;
export type HoldingBasisSk = `HOLDINGBASIS#${string}#${string}`;
export type HoldingPriceSnapshotSk = `HOLDINGPRICE#${string}#${string}#${string}`;
export type NetWorthSk = `NETWORTH#${string}`;
export type RuleSk = `RULE#${string}`;
export type ImportTxnPointerSk = `TXNPTR#import:${string}:${string}`;
export type AttachSk = `ATTACH#${string}#${string}`;
export type PushTokenSk = `PUSHTOKEN#${string}`;
export type Gsi1Pk = `USER#${string}#ACCT#${string}`;
export type Gsi1Sk = `${string}#${string}`;
export type Gsi2Pk = `USER#${string}#CAT#${string}`;
export type Gsi2Sk = `${string}#${string}`;

/** Prefixes for `begins_with` key conditions. */
export const KEY_PREFIX = {
  profile: 'PROFILE#',
  account: 'ACCT#',
  transaction: 'TXN#',
  txnPointer: 'TXNPTR#',
  budget: 'BUDGET#',
  category: 'CATEGORY#',
  recurring: 'RECURRING#',
  goal: 'GOAL#',
  contribution: 'CONTRIB#',
  holding: 'HOLDING#',
  holdingBasis: 'HOLDINGBASIS#',
  holdingPrice: 'HOLDINGPRICE#',
  netWorth: 'NETWORTH#',
  rule: 'RULE#',
  /**
   * Import pointers share the TXNPTR# namespace deliberately (same idempotency
   * machinery as sync, P7-6); the `import:` segment keeps them disjoint from
   * TXNPTR#<simplefinTxnId> pointers in any realistic id space.
   */
  importTxnPointer: 'TXNPTR#import:',
  attachment: 'ATTACH#',
  pushToken: 'PUSHTOKEN#',
} as const;

/**
 * Sort-key upper-bound sentinel: '~' (0x7E) sorts after '#' (0x23) and every
 * character used in ids/dates, so `BETWEEN "TXN#<from>" AND "TXN#<to>~"` includes
 * every transaction on the <to> day.
 */
export const SK_UPPER_BOUND = '~';

export class KeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyError';
  }
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Reject empty components and '#' injection that would corrupt composite keys. */
function assertComponent(label: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new KeyError(`${label} must be a non-empty string`);
  }
  if (value.includes('#')) {
    throw new KeyError(`${label} must not contain "#" (got "${value}")`);
  }
}

export function assertIsoDate(value: string): asserts value is IsoDate {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new KeyError(`expected yyyy-mm-dd date, got "${value}"`);
  }
}

/** PK for every item in the household partition. */
export function userPk(household: string): UserPk {
  assertComponent('household', household);
  return `USER#${household}`;
}

export function profileSk(cognitoSub: string): ProfileSk {
  assertComponent('cognitoSub', cognitoSub);
  return `PROFILE#${cognitoSub}`;
}

export function acctSk(accountId: string): AcctSk {
  assertComponent('accountId', accountId);
  return `ACCT#${accountId}`;
}

export function txnSk(date: IsoDate, txnId: string): TxnSk {
  assertIsoDate(date);
  assertComponent('txnId', txnId);
  return `TXN#${date}#${txnId}`;
}

export function txnPointerSk(txnId: string): TxnPointerSk {
  assertComponent('txnId', txnId);
  return `TXNPTR#${txnId}`;
}

export function budgetSk(categoryId: string): BudgetSk {
  assertComponent('categoryId', categoryId);
  return `BUDGET#${categoryId}`;
}

export function categorySk(categoryId: string): CategorySk {
  assertComponent('categoryId', categoryId);
  return `CATEGORY#${categoryId}`;
}

export function syncStateSk(): SyncStateSk {
  return 'SYNC#STATE';
}

/**
 * Singleton in-flight marker for on-demand sync. Written by the API before it
 * async-invokes the sync Lambda and deleted by the sync handler when the run
 * finishes, so a tap-spam burst cannot fan out multiple concurrent SimpleFIN
 * pulls (see SYNC_RUNNING_TTL_SECONDS for the soft-expiry contract).
 */
export function syncRunningSk(): SyncRunningSk {
  return 'SYNC#RUNNING';
}

export function gsi1Pk(household: string, accountId: string): Gsi1Pk {
  assertComponent('household', household);
  assertComponent('accountId', accountId);
  return `USER#${household}#ACCT#${accountId}`;
}

export function gsi1Sk(date: IsoDate, txnId: string): Gsi1Sk {
  assertIsoDate(date);
  assertComponent('txnId', txnId);
  return `${date}#${txnId}`;
}

export function gsi2Pk(household: string, categoryId: string): Gsi2Pk {
  assertComponent('household', household);
  assertComponent('categoryId', categoryId);
  return `USER#${household}#CAT#${categoryId}`;
}

export function gsi2Sk(date: IsoDate, txnId: string): Gsi2Sk {
  assertIsoDate(date);
  assertComponent('txnId', txnId);
  return `${date}#${txnId}`;
}

export interface Gsi2Keys {
  GSI2PK: Gsi2Pk;
  GSI2SK: Gsi2Sk;
}

export interface ComputeGsi2KeysArgs {
  household: string;
  categoryId: string;
  categoryType: CategoryType;
  /** The transaction's isTransfer flag (NOT the category type). */
  isTransfer: boolean;
  date: IsoDate;
  txnId: string;
}

/**
 * Single source of truth for the sparse GSI2 (per-category spend index) rule:
 * ONLY categorized, non-transfer EXPENSE transactions carry GSI2 keys.
 * Budgets sum GSI2, so anything else in the index inflates spend — in
 * particular transfers (e.g. credit-card payments) must never get keys even
 * when a user files them under an EXPENSE category.
 *
 * Returns the GSI2PK/GSI2SK pair to SET, or null when the transaction must
 * stay out of the index (callers REMOVE / omit the attributes). Every writer
 * (API PATCH, AI categorizer, sync) must derive GSI2 keys through this helper;
 * do not re-implement the rule inline.
 */
export function computeGsi2Keys(args: ComputeGsi2KeysArgs): Gsi2Keys | null {
  if (args.isTransfer || args.categoryType !== 'EXPENSE') {
    return null;
  }
  return {
    GSI2PK: gsi2Pk(args.household, args.categoryId),
    GSI2SK: gsi2Sk(args.date, args.txnId),
  };
}

export interface KeyRangeBounds {
  start: string;
  end: string;
}

/**
 * Inclusive base-table SK bounds for `SK BETWEEN :start AND :end` over the
 * transaction date range [from, to]. The trailing sentinel keeps the last day's
 * `#<txnId>` suffixes inside the range.
 */
export function txnDateRangeBounds(from: IsoDate, to: IsoDate): KeyRangeBounds {
  assertIsoDate(from);
  assertIsoDate(to);
  if (from > to) {
    throw new KeyError(`from (${from}) must not be after to (${to})`);
  }
  return { start: `TXN#${from}`, end: `TXN#${to}${SK_UPPER_BOUND}` };
}

/**
 * Inclusive GSI1/GSI2 sort-key bounds (`<date>#<txnId>` keys) over [from, to].
 */
export function gsiDateRangeBounds(from: IsoDate, to: IsoDate): KeyRangeBounds {
  assertIsoDate(from);
  assertIsoDate(to);
  if (from > to) {
    throw new KeyError(`from (${from}) must not be after to (${to})`);
  }
  return { start: from, end: `${to}${SK_UPPER_BOUND}` };
}

export interface ParsedTxnSk {
  date: IsoDate;
  txnId: string;
}

/** Inverse of `txnSk`; throws KeyError on anything that is not a transaction SK. */
export function parseTxnSk(sk: string): ParsedTxnSk {
  const parts = sk.split('#');
  if (parts.length !== 3 || parts[0] !== 'TXN') {
    throw new KeyError(`not a transaction SK: "${sk}"`);
  }
  const date = parts[1]!;
  const txnId = parts[2]!;
  assertIsoDate(date);
  if (txnId.length === 0) {
    throw new KeyError(`transaction SK has empty txnId: "${sk}"`);
  }
  return { date, txnId };
}

// ---------------------------------------------------------------------------
// Phase 7 key builders (additive; see PHASE7-DECISIONS.md P7-1..P7-9)
// ---------------------------------------------------------------------------

export function recurringSk(seriesId: string): RecurringSk {
  assertComponent('seriesId', seriesId);
  return `RECURRING#${seriesId}`;
}

export function goalSk(goalId: string): GoalSk {
  assertComponent('goalId', goalId);
  return `GOAL#${goalId}`;
}

/**
 * Contribution SK: CONTRIB#<goalId>#<isoTimestamp>. ISO-8601 UTC timestamps
 * sort lexicographically == chronologically, so a `begins_with(contribPrefix)`
 * query returns a goal's contributions in time order.
 */
export function contribSk(goalId: string, contributedAt: IsoTimestamp): ContribSk {
  assertComponent('goalId', goalId);
  assertComponent('contributedAt', contributedAt);
  return `CONTRIB#${goalId}#${contributedAt}`;
}

/** `begins_with` prefix over one goal's contributions. */
export function contribPrefix(goalId: string): `CONTRIB#${string}#` {
  assertComponent('goalId', goalId);
  return `CONTRIB#${goalId}#`;
}

export function holdingSk(accountId: string, holdingId: string): HoldingSk {
  assertComponent('accountId', accountId);
  assertComponent('holdingId', holdingId);
  return `HOLDING#${accountId}#${holdingId}`;
}

/** `begins_with` prefix over one account's holdings. */
export function holdingPrefix(accountId: string): `HOLDING#${string}#` {
  assertComponent('accountId', accountId);
  return `HOLDING#${accountId}#`;
}

/**
 * User-owned manual cost-basis SK: HOLDINGBASIS#<accountId>#<symbol>. Keyed on
 * the STABLE (accountId, symbol) identity, NOT holdingId (raw SimpleFIN wire.id
 * has no in-repo stability guarantee and can churn across syncs, orphaning the
 * entry). Written only by the API; sync never enumerates this SK, so the item
 * survives every holdings overwrite by construction (no allow-list entry).
 * `symbol` reuses `assertComponent`, which rejects '#' (the SET route mirrors
 * that guard); '.'/'-' are valid ticker characters and pass.
 */
export function holdingBasisSk(accountId: string, symbol: string): HoldingBasisSk {
  assertComponent('accountId', accountId);
  assertComponent('symbol', symbol);
  return `HOLDINGBASIS#${accountId}#${symbol}`;
}

/** `begins_with` prefix over one account's manual cost-basis items. */
export function holdingBasisPrefix(accountId: string): `HOLDINGBASIS#${string}#` {
  assertComponent('accountId', accountId);
  return `HOLDINGBASIS#${accountId}#`;
}

/**
 * Daily price-per-share snapshot SK: HOLDINGPRICE#<accountId>#<symbol>#<date>.
 * Keyed on the STABLE (accountId, symbol) identity (like holdingBasisSk) plus
 * the calendar date, so a begins_with(holdingPricePrefix) query returns one
 * position's price history in chronological order. Written only by sync and
 * never enumerated by the holdings-replace logic, so it survives every sync.
 */
export function holdingPriceSnapshotSk(
  accountId: string,
  symbol: string,
  date: IsoDate,
): HoldingPriceSnapshotSk {
  assertComponent('accountId', accountId);
  assertComponent('symbol', symbol);
  assertIsoDate(date);
  return `HOLDINGPRICE#${accountId}#${symbol}#${date}`;
}

/** `begins_with` prefix over one position's daily price snapshots. */
export function holdingPricePrefix(
  accountId: string,
  symbol: string,
): `HOLDINGPRICE#${string}#${string}#` {
  assertComponent('accountId', accountId);
  assertComponent('symbol', symbol);
  return `HOLDINGPRICE#${accountId}#${symbol}#`;
}

/**
 * Inclusive SK bounds for `SK BETWEEN :start AND :end` over one position's daily
 * price snapshots in [from, to] (same sentinel mechanics as
 * netWorthDateRangeBounds).
 */
export function holdingPriceHistoryBounds(
  accountId: string,
  symbol: string,
  from: IsoDate,
  to: IsoDate,
): KeyRangeBounds {
  assertComponent('accountId', accountId);
  assertComponent('symbol', symbol);
  assertIsoDate(from);
  assertIsoDate(to);
  if (from > to) {
    throw new KeyError(`from (${from}) must not be after to (${to})`);
  }
  return {
    start: `HOLDINGPRICE#${accountId}#${symbol}#${from}`,
    end: `HOLDINGPRICE#${accountId}#${symbol}#${to}${SK_UPPER_BOUND}`,
  };
}

export function netWorthSk(date: IsoDate): NetWorthSk {
  assertIsoDate(date);
  return `NETWORTH#${date}`;
}

/**
 * Inclusive SK bounds for `SK BETWEEN :start AND :end` over net-worth
 * snapshots in [from, to] (same sentinel mechanics as txnDateRangeBounds;
 * NETWORTH# SKs have no suffix but the sentinel is harmless and consistent).
 */
export function netWorthDateRangeBounds(from: IsoDate, to: IsoDate): KeyRangeBounds {
  assertIsoDate(from);
  assertIsoDate(to);
  if (from > to) {
    throw new KeyError(`from (${from}) must not be after to (${to})`);
  }
  return { start: `NETWORTH#${from}`, end: `NETWORTH#${to}${SK_UPPER_BOUND}` };
}

/**
 * Phase-7 shared rule contract: RULE#<ruleId> (P7-5). NOTE: services/ai's
 * legacy items use RULE#<matchType>#<pattern> in the same namespace; a
 * `begins_with(RULE#)` scan sees both during the migration window, so readers
 * must discriminate on `entityType` ('RULE' vs legacy 'CATEGORY_RULE').
 */
export function ruleSk(ruleId: string): RuleSk {
  assertComponent('ruleId', ruleId);
  return `RULE#${ruleId}`;
}

/**
 * CSV-import idempotency pointer (P7-6): TXNPTR#import:<importId>:<rowHash>.
 * ':' is the segment separator here, so importId and rowHash must not contain
 * ':' (or '#'); the canonical rowHash is lowercase hex from
 * `@goldfinch/shared/csv`, and importId is a client-generated UUID.
 */
export function importTxnPointerSk(importId: string, rowHash: string): ImportTxnPointerSk {
  assertImportComponent('importId', importId);
  assertImportComponent('rowHash', rowHash);
  return `TXNPTR#import:${importId}:${rowHash}`;
}

/** `begins_with` prefix over one import batch's pointers. */
export function importTxnPointerPrefix(importId: string): `TXNPTR#import:${string}:` {
  assertImportComponent('importId', importId);
  return `TXNPTR#import:${importId}:`;
}

export function attachSk(txnId: string, attachId: string): AttachSk {
  assertComponent('txnId', txnId);
  assertComponent('attachId', attachId);
  return `ATTACH#${txnId}#${attachId}`;
}

/** `begins_with` prefix over one transaction's attachments. */
export function attachPrefix(txnId: string): `ATTACH#${string}#` {
  assertComponent('txnId', txnId);
  return `ATTACH#${txnId}#`;
}

export function pushTokenSk(deviceId: string): PushTokenSk {
  assertComponent('deviceId', deviceId);
  return `PUSHTOKEN#${deviceId}`;
}

/** Import-pointer components additionally forbid ':' (it is the separator). */
function assertImportComponent(label: string, value: string): void {
  assertComponent(label, value);
  if (value.includes(':')) {
    throw new KeyError(`${label} must not contain ":" (got "${value}")`);
  }
}
