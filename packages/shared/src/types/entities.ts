/**
 * DynamoDB item shapes for the GoldFinch single table (master plan section 6),
 * adjusted to the locked decisions: PK = USER#<household>, GSI2SK = <date>#<txnId>,
 * sort-key pattern TXNPTR#<txnId> for the transaction pointer, CATEGORY#<categoryId>
 * for category definitions.
 *
 * Money on items is ALWAYS integer minor units (`*Minor` attributes). Decimal strings
 * appear only at the API boundary (see types/api.ts).
 */

import type {
  AcctSk,
  AttachSk,
  BudgetSk,
  CategorySk,
  ContribSk,
  GoalSk,
  Gsi1Pk,
  Gsi1Sk,
  Gsi2Pk,
  Gsi2Sk,
  HoldingSk,
  ImportTxnPointerSk,
  NetWorthSk,
  ProfileSk,
  PushTokenSk,
  RecurringSk,
  RuleSk,
  SyncRunningSk,
  SyncStateSk,
  TxnPointerSk,
  TxnSk,
  UserPk,
} from '../keys.js';
import type {
  CurrencyCode,
  DecimalString,
  EpochSeconds,
  IsoDate,
  IsoTimestamp,
  MinorUnits,
} from './common.js';
// Type-only (erased at emit), so the api<->entities cycle stays types-only.
import type { BudgetPeriod } from './api.js';

/** Discriminator stored on every item as `entityType`. */
export type EntityType =
  | 'USER'
  | 'ACCOUNT'
  | 'TRANSACTION'
  | 'TXN_POINTER'
  | 'BUDGET'
  | 'CATEGORY'
  | 'SYNC_STATE'
  | 'SYNC_RUNNING'
  // Phase 7 additions (PHASE7-DECISIONS.md), additive only.
  | 'RECURRING_SERIES'
  | 'GOAL'
  | 'GOAL_CONTRIBUTION'
  | 'HOLDING'
  | 'NETWORTH_SNAPSHOT'
  | 'RULE'
  | 'IMPORT_TXN_POINTER'
  | 'ATTACHMENT'
  | 'PUSH_TOKEN';

interface BaseItem {
  PK: UserPk;
  entityType: EntityType;
  /** Single-digit forward-migration marker. */
  schemaVersion: number;
}

/** Per-user preferences carried on the profile item. */
export interface UserSettings {
  theme?: 'light' | 'dark' | 'system';
  notificationsEnabled?: boolean;
  [key: string]: unknown;
}

/** One per Cognito user; both users live in the same household partition. */
export interface UserProfileItem extends BaseItem {
  SK: ProfileSk;
  entityType: 'USER';
  cognitoSub: string;
  displayName: string;
  baseCurrency: CurrencyCode;
  householdId: string;
  settings?: UserSettings;
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
  /**
   * Optimistic-concurrency counter bumped by PATCH /profile. Optional because
   * it is absent on items written before the display-name feature; the first
   * versioned write conditions on its absence and sets 1.
   */
  version?: number;
}

export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'investment'
  | 'loan'
  | 'other';

/**
 * P8-4 (PHASE8-DECISIONS.md): the user-facing account-type vocabulary. A
 * superset of the synced {@link AccountType} union (note 'credit-card' is the
 * id for the synced 'credit'; 'business' and 'cash' exist only as user
 * overrides). Per-type metadata (label, phosphor iconKey, isLiability
 * default) lives in `../accountTypes.js` (ACCOUNT_TYPES), and ALL precedence
 * between overrides and synced values is computed there — never inline.
 */
export type AccountTypeId =
  | 'checking'
  | 'savings'
  | 'credit-card'
  | 'investment'
  | 'business'
  | 'loan'
  | 'cash'
  | 'other';

/** Account types that subtract from net worth. */
export const LIABILITY_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set([
  'credit',
  'loan',
]);

/**
 * Liability classification of a SYNCED type only. When the account ITEM is at
 * hand, use `effectiveIsLiability()` from `../accountTypes.js` instead — it
 * honors the P8-4 user overrides and agrees with this function when none are
 * set (the ACCOUNT_TYPES metadata defaults are locked to it by test).
 */
export function isLiabilityType(type: AccountType): boolean {
  return LIABILITY_ACCOUNT_TYPES.has(type);
}

/**
 * Where an account came from (P7-6). Absent on items written before Phase 7,
 * which are all SimpleFIN-synced — readers MUST treat absent as 'simplefin'.
 */
export type AccountSource = 'simplefin' | 'manual';

/**
 * SimpleFIN accounts are refreshed on every sync run via an attribute-scoped
 * update that touches sync-owned fields only (P8-4) — the user-owned override
 * fields below survive every sync by construction. Manual accounts
 * (source 'manual', P7-6) are created via POST /accounts and never touched by
 * sync; their balance is maintained from imported/manual transactions.
 */
export interface AccountItem extends BaseItem {
  SK: AcctSk;
  entityType: 'ACCOUNT';
  name: string;
  accountType: AccountType;
  /** SimpleFIN org.name (falls back to org.domain); user-supplied or "Manual" for manual accounts. */
  institution: string;
  balanceMinor: MinorUnits;
  availableBalanceMinor?: MinorUnits;
  currency: CurrencyCode;
  /** SimpleFIN `balance-date` (epoch seconds); for manual accounts, the last balance write. */
  balanceDate: EpochSeconds;
  /**
   * Stable external id: the SimpleFIN account id for synced accounts; for
   * manual accounts (P7-6) the writer sets the synthetic value
   * `manual:<accountId>`, which can never match a bridge id, so sync's
   * account matching is unaffected. Kept required for compile compatibility
   * with pre-Phase-7 consumers.
   */
  simplefinAccountId: string;
  /** SimpleFIN org.id when present. */
  simplefinOrgId?: string;
  /** Last sync run for SimpleFIN accounts; last write for manual accounts. */
  lastSyncedAt: IsoTimestamp;
  /** Absent == 'simplefin' (pre-Phase-7 items). */
  source?: AccountSource;
  /**
   * P7-3: set by sync on investment accounts — true once the bridge has ever
   * returned a holdings array for this account, false when the institution
   * does not provide holdings via SimpleFIN. Absent == unknown (never synced
   * since Phase 7); the UI must render the explicit unsupported state on
   * false, never a silent blank.
   */
  holdingsSupported?: boolean;
  /**
   * P8-4 USER-OWNED account-type override, set only by
   * PATCH /accounts/{accountId}. Sync must NEVER write or clear it (preserve
   * it through the attribute-scoped update path). Absent == no override.
   * Readers must NOT apply precedence themselves — go through
   * `effectiveAccountType()` in `../accountTypes.js`, the sole precedence
   * source.
   */
  typeOverride?: AccountTypeId;
  /**
   * P8-4 USER-OWNED liability-classification override, set only by
   * PATCH /accounts/{accountId}. Sync must NEVER write or clear it. Absent ==
   * no override. Flipping it immediately changes net-worth classification.
   * Readers must NOT apply precedence themselves — go through
   * `effectiveIsLiability()` in `../accountTypes.js`, the sole precedence
   * source.
   */
  isLiabilityOverride?: boolean;
}

export type CategorizedBy = 'rule' | 'ai' | 'user' | null;

/**
 * Sparse GSI keys: GSI1PK/GSI1SK are always present on transactions; GSI2PK/GSI2SK
 * exist ONLY when the transaction is a categorized, non-transfer expense, so income,
 * transfers, and uncategorized rows never pollute the spend index.
 */
export interface TransactionItem extends BaseItem {
  SK: TxnSk;
  entityType: 'TRANSACTION';
  /** Integer minor units; sign convention matches SimpleFIN (expense negative). */
  amountMinor: MinorUnits;
  currency: CurrencyCode;
  payee: string;
  /** Raw memo / description from SimpleFIN. */
  description?: string;
  memo?: string;
  /** User-attached note. */
  note?: string;
  /** Lowercased copies for server-side contains() search. */
  payeeLower?: string;
  noteLower?: string;
  /** Canonical category slug; null while uncategorized. */
  categoryId: string | null;
  accountId: string;
  pending: boolean;
  isTransfer: boolean;
  /** Posted date (== SK date once posted); null while pending. */
  postedDate: IsoDate | null;
  /** SimpleFIN `transacted_at`, epoch seconds, when provided. */
  transactedAt?: EpochSeconds;
  /**
   * The stable dedupe/idempotency id (also the SK txnId component): the
   * SimpleFIN transaction id for synced rows; for imported rows (P7-6) the
   * writer sets `import:<importId>:<rowHash>` — note TXNPTR#<that id> is then
   * exactly the importTxnPointerSk, i.e. the same pointer machinery as sync.
   */
  simplefinTxnId: string;
  /** Absent == 'simplefin' (every pre-Phase-7 item was written by sync). */
  source?: TransactionSource;
  /** Set on source 'import' rows: the batch that created this transaction. */
  importId?: string;
  categorizedBy: CategorizedBy;
  /** True once a user manually set the category; AI/rules must never overwrite. */
  userCategorized: boolean;
  /** Cognito sub of the last manual editor; null if untouched. */
  lastEditedBy: string | null;
  /** Bumped on every write for client cache reconciliation. */
  version: number;
  GSI1PK: Gsi1Pk;
  GSI1SK: Gsi1Sk;
  GSI2PK?: Gsi2Pk;
  GSI2SK?: Gsi2Sk;
  createdAt?: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}

/**
 * Pointer from the immutable SimpleFIN txn id to the transaction's current SK.
 * Lets the sync writer relocate an item when its date shifts on pending -> posted
 * without orphaning the stale-dated copy.
 */
export interface TxnPointerItem extends BaseItem {
  SK: TxnPointerSk;
  entityType: 'TXN_POINTER';
  simplefinTxnId: string;
  currentSk: TxnSk;
}

export type CategoryType = 'INCOME' | 'EXPENSE' | 'TRANSFER';

/** Category definitions are stable slugs (e.g. "groceries"), never free text. */
export interface CategoryItem extends BaseItem {
  SK: CategorySk;
  entityType: 'CATEGORY';
  /** Stable slug; GSI2PK and BUDGET#<categoryId> both key on it. */
  categoryId: string;
  name: string;
  type: CategoryType;
  /** Optional grouping (e.g. "food-dining"); null when ungrouped. */
  groupId?: string | null;
  sortOrder: number;
  /** Soft delete. Archived categories stay resolvable for historical transactions. */
  archived: boolean;
  isDefault?: boolean;
  /**
   * P10-1: USER-OWNED curated glyph key (a member of GLYPH_KEYS from
   * `@goldfinch/shared/categoryStyle`). Optional/additive: absent means today's
   * auto keyword/slug glyph. The route validates it with `isGlyphKey` before
   * persisting; sync never writes categories so it is never derived/overwritten.
   */
  iconKey?: string;
  /**
   * P10-1: USER-OWNED category palette KEY ('c1'..'c0' | 'other' — a member of
   * CATEGORY_COLOR_KEYS), NOT a raw hex. Optional/additive: absent means the
   * deterministic hash pick (`resolveCategoryColorKey`). The route validates it
   * with `isCategoryColorKey` before persisting; never derived/overwritten.
   */
  color?: string;
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}

/** Per-category budget target for one period. */
export interface BudgetItem extends BaseItem {
  SK: BudgetSk;
  entityType: 'BUDGET';
  categoryId: string;
  /**
   * Budget cadence (P11-1). USER-OWNED: written from CreateBudgetRequest/
   * PatchBudgetRequest, never derived or overwritten by sync. Optional and
   * additive — absent means `'monthly'` (back-compat for the pre-Phase-11
   * budgets seeded earlier). `limitMinor` is the cap for ONE period.
   */
  period?: BudgetPeriod;
  limitMinor: MinorUnits;
  rollover: boolean;
  /** Optimistic-locking counter; conditional writes return 409 on mismatch. */
  version: number;
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}

export type SyncRunStatus = 'success' | 'partial' | 'error';

export interface SyncAccountStatus {
  lastSyncedAt: IsoTimestamp;
  status: SyncRunStatus;
  txnCount: number;
  /**
   * Human-readable reason when `status` is 'error' (SimpleFIN errlist text
   * when available). Written by services/sync (state.ts); surfaced through
   * GET /sync/status. Absent on healthy accounts and on pre-Phase-8 records.
   */
  errorReason?: string;
}

/** Structurally identical to a SimpleFIN errlist entry; redefined here to keep entity types dependency-free. */
export interface SyncErrorEntry {
  code: string;
  msg: string;
}

/** Singleton item written by the sync Lambda after each run. */
export interface SyncStateItem extends BaseItem {
  SK: SyncStateSk;
  entityType: 'SYNC_STATE';
  lastRunAt: IsoTimestamp;
  lastRunStatus: SyncRunStatus;
  perAccount: Record<string, SyncAccountStatus>;
  /** Errors from the most recent SimpleFIN response, if any. */
  lastErrlist?: SyncErrorEntry[];
  /** Start of the sync window used on the last run, epoch seconds. */
  windowStartEpoch?: EpochSeconds;
  /**
   * Conservative record-level success cursor, epoch seconds: the MIN over the
   * per-account cursors — the point before which every account's data is
   * known persisted. Written by services/sync (state.ts); absent until the
   * first fully persisted run. Surfaced as SyncStatusResponse.lastSuccessAt.
   */
  lastSuccessEpoch?: EpochSeconds;
}

/**
 * Singleton in-flight marker for on-demand sync (security hardening). The API
 * writes it at PK = USER#<household>, SK = SYNC#RUNNING BEFORE it async-invokes
 * the sync Lambda, conditioned so a fresh marker refuses a concurrent
 * POST /sync/run; the sync handler deletes it when its run finishes. A run that
 * crashed before clearing the marker self-heals: `runningSince` older than
 * SYNC_RUNNING_TTL_SECONDS is treated as stale and overwritten by the next tap.
 */
export interface SyncRunningItem extends BaseItem {
  SK: SyncRunningSk;
  entityType: 'SYNC_RUNNING';
  /** When the dispatching API request claimed the marker (ISO-8601). */
  runningSince: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Phase 7 items (PHASE7-DECISIONS.md P7-1..P7-9, additive only)
// ---------------------------------------------------------------------------

/**
 * Where a transaction came from (P7-6). Absent on items written before
 * Phase 7, which were all sync-written — readers MUST treat absent as
 * 'simplefin'.
 */
export type TransactionSource = 'simplefin' | 'import' | 'manual';

export type RecurringCadence = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

/**
 * detected: written by the detector, awaiting user review.
 * confirmed: user confirmed; survives re-detection.
 * ignored:   user dismissed; the detector must not resurrect it.
 */
export type RecurringStatus = 'detected' | 'confirmed' | 'ignored';

/**
 * How a recurring series was found (P8-5.3, ops/PHASE8-DECISIONS.md):
 *
 *   detector:      cadence-classified by the shared detection pipeline
 *                  (amount cluster + cadence window + minimum occurrences).
 *   category-hint: cross-seeded from the 'subscriptions' category — a payee
 *                  with >= 2 subscription-categorized occurrences is surfaced
 *                  as a low-confidence detected series for user review even
 *                  when cadence confidence is too low for the detector.
 *
 * Absent on items written before Phase 8 — readers MUST treat absent as
 * 'detector'.
 */
export type RecurringSeriesSource = 'detector' | 'category-hint';

/**
 * Recurring/subscription series (P7-1), upserted by the daily sync Lambda
 * after transaction upsert. `seriesId` is the deterministic hash from
 * `@goldfinch/shared/recurrence` so re-detection updates in place. User
 * `status` is never overwritten by the detector (conditional update).
 */
export interface RecurringSeriesItem extends BaseItem {
  SK: RecurringSk;
  entityType: 'RECURRING_SERIES';
  seriesId: string;
  /** Representative display payee (most recent occurrence's original payee). */
  payee: string;
  /** Normalized grouping key (see normalizePayeeForRecurrence). */
  payeeNormalized: string;
  cadence: RecurringCadence;
  /** Rounded integer mean of the matched occurrences. */
  avgAmountMinor: MinorUnits;
  currency: CurrencyCode;
  /** Date of the most recent occurrence. */
  lastDate: IsoDate;
  nextExpectedDate: IsoDate;
  accountId: string;
  status: RecurringStatus;
  occurrenceCount: number;
  /**
   * P8-5.3: how the series was found. Refreshed on every detection pass (a
   * category-hint series upgrades to 'detector' once cadence confidence is
   * reached). Absent == 'detector' (pre-Phase-8 items).
   */
  source?: RecurringSeriesSource;
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}

/**
 * linked-account: progress == the linked account's current balance.
 * manual:         progress == sum of CONTRIB# items for the goal.
 */
export type GoalFundingMode = 'linked-account' | 'manual';

/** Savings goal (P7-2). */
export interface GoalItem extends BaseItem {
  SK: GoalSk;
  entityType: 'GOAL';
  goalId: string;
  name: string;
  targetMinor: MinorUnits;
  currency: CurrencyCode;
  /** Optional deadline; null/absent when open-ended. */
  targetDate?: IsoDate | null;
  fundingMode: GoalFundingMode;
  /** Required when fundingMode is 'linked-account'; null/absent otherwise. */
  linkedAccountId?: string | null;
  /** Optimistic-locking counter (same convention as BudgetItem). */
  version: number;
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}

/** Manual goal contribution (P7-2); SK timestamp gives chronological order. */
export interface GoalContributionItem extends BaseItem {
  SK: ContribSk;
  entityType: 'GOAL_CONTRIBUTION';
  goalId: string;
  /** Matches the SK timestamp component. */
  contributedAt: IsoTimestamp;
  /** Positive = deposit; negative = withdrawal/correction. */
  amountMinor: MinorUnits;
  currency: CurrencyCode;
  note?: string;
  /** Cognito sub of the contributing user. */
  createdBy: string;
  createdAt: IsoTimestamp;
}

/**
 * Investment holding (P7-3), overwritten per sync run from the SimpleFIN beta
 * `holdings` array. `shares` is a DecimalString (fractional shares are not
 * money — never a float, never minor units).
 */
export interface HoldingItem extends BaseItem {
  SK: HoldingSk;
  entityType: 'HOLDING';
  accountId: string;
  holdingId: string;
  symbol?: string;
  description: string;
  shares: DecimalString;
  costBasisMinor?: MinorUnits;
  marketValueMinor: MinorUnits;
  currency: CurrencyCode;
  /** SimpleFIN holding timestamp, epoch seconds. */
  asOf: EpochSeconds;
  lastSyncedAt: IsoTimestamp;
}

/** One currency's slice of a net-worth snapshot. Pure minor-unit integers. */
export interface NetWorthCurrencySlice {
  assetsMinor: MinorUnits;
  liabilitiesMinor: MinorUnits;
  netMinor: MinorUnits;
}

/**
 * Daily net-worth snapshot (P7-4), written by sync after each successful run
 * (idempotent overwrite per calendar day). Per P7-7 there is NO synthetic
 * mixed-currency total: the top-level totals are the slice for `currency`
 * (the household base currency); `perCurrency` carries every currency,
 * including the base one.
 */
export interface NetWorthSnapshotItem extends BaseItem {
  SK: NetWorthSk;
  entityType: 'NETWORTH_SNAPSHOT';
  date: IsoDate;
  /** The base currency whose slice the top-level totals duplicate. */
  currency: CurrencyCode;
  assetsMinor: MinorUnits;
  liabilitiesMinor: MinorUnits;
  netMinor: MinorUnits;
  perCurrency: Record<CurrencyCode, NetWorthCurrencySlice>;
  createdAt: IsoTimestamp;
}

export type RuleMatchType = 'exact' | 'prefix' | 'contains';

/**
 * Categorization rule, the Phase-7 shared contract (P7-5): RULE#<ruleId>.
 * The API CRUD routes and the services/ai daily rules pass consume the SAME
 * items. Matching semantics live in `@goldfinch/shared/rules` (the single
 * matcher implementation). Legacy services/ai items
 * (RULE#<matchType>#<pattern>, entityType 'CATEGORY_RULE') share the SK
 * namespace until migrated — always discriminate on entityType.
 */
export interface RuleItem extends BaseItem {
  SK: RuleSk;
  entityType: 'RULE';
  ruleId: string;
  matchType: RuleMatchType;
  /** Matched against the transaction's payeeLower; stored lowercased. */
  pattern: string;
  /** Inclusive bound on abs(amountMinor); null/absent = unbounded. */
  amountMinMinor?: MinorUnits | null;
  /** Inclusive bound on abs(amountMinor); null/absent = unbounded. */
  amountMaxMinor?: MinorUnits | null;
  categoryId: string;
  /** Lower value = higher precedence within the same matchType. */
  priority: number;
  /** Disabled rules are kept but never match. */
  enabled: boolean;
  /** Optimistic-locking counter. */
  version: number;
  /** Cognito sub of the creator. */
  createdBy?: string;
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}

/**
 * CSV-import idempotency pointer (P7-6) — the import-side analogue of
 * TxnPointerItem; a conditional put on this item is what makes batch retries
 * safe. `currentSk` locates the transaction the row created.
 */
export interface ImportTxnPointerItem extends BaseItem {
  SK: ImportTxnPointerSk;
  entityType: 'IMPORT_TXN_POINTER';
  importId: string;
  rowHash: string;
  currentSk: TxnSk;
  createdAt: IsoTimestamp;
}

/** Attachment object lifecycle: metadata exists from presign; `uploaded` once confirmed. */
export type AttachmentStatus = 'pending' | 'uploaded';

/**
 * Attachment metadata (P7-9); the bytes live in the private attachments
 * bucket under `s3Key`. Size/content-type limits are enforced server-side
 * against ATTACHMENT_MAX_BYTES / ATTACHMENT_ALLOWED_CONTENT_TYPES.
 */
export interface AttachmentItem extends BaseItem {
  SK: AttachSk;
  entityType: 'ATTACHMENT';
  txnId: string;
  attachId: string;
  /** Original client file name (display only; never used as the S3 key). */
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** Full object key in the attachments bucket. */
  s3Key: string;
  status: AttachmentStatus;
  /** Cognito sub of the uploader. */
  uploadedBy: string;
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}

export type PushPlatform = 'ios' | 'android' | 'web';

/**
 * Expo push-token registration (P7-8), upserted by POST /devices/push-token.
 * `disabledAt` is set (never deleted) when the Expo relay reports
 * DeviceNotRegistered so the sender can skip dead tokens without losing the
 * registration history.
 */
export interface PushTokenItem extends BaseItem {
  SK: PushTokenSk;
  entityType: 'PUSH_TOKEN';
  deviceId: string;
  expoPushToken: string;
  platform: PushPlatform;
  /** Cognito sub of the user who registered the device. */
  ownerSub: string;
  createdAt: IsoTimestamp;
  updatedAt?: IsoTimestamp;
  disabledAt?: IsoTimestamp | null;
}

/** Discriminated union over `entityType` of everything in the table. */
export type GoldFinchItem =
  | UserProfileItem
  | AccountItem
  | TransactionItem
  | TxnPointerItem
  | CategoryItem
  | BudgetItem
  | SyncStateItem
  | SyncRunningItem
  | RecurringSeriesItem
  | GoalItem
  | GoalContributionItem
  | HoldingItem
  | NetWorthSnapshotItem
  | RuleItem
  | ImportTxnPointerItem
  | AttachmentItem
  | PushTokenItem;
