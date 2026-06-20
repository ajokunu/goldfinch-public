/**
 * Project-wide contract constants.
 *
 * Values here are LOCKED by the "Resolved Decisions Log (AUTHORITATIVE)" section of
 * GoldFinch-MASTER-PLAN.md. Do not change them without updating that log first.
 */

/**
 * The shared household identifier. It is the value of the `household` custom claim on
 * the Cognito ACCESS token and the only partition discriminator in DynamoDB
 * (`PK = USER#<household>`). Identity is always re-derived server-side from the JWT,
 * never from client input.
 */
export const HOUSEHOLD_ID = 'goldfinch-home';

/** Name of the custom claim on the Cognito access token carrying the household id. */
export const HOUSEHOLD_CLAIM = 'household';

/**
 * OAuth scope exposed by the Cognito resource server. The API Gateway JWT authorizer
 * (audience = appClientId) enforces this scope per-route. The ID token is never sent
 * to the API.
 */
export const API_SCOPE = 'goldfinch/api';

/**
 * SSM SecureString parameter holding the claimed SimpleFIN access URL, encrypted with
 * the customer-managed CMK. Readable ONLY by the sync Lambda role. The value never
 * reaches the client or any other Lambda.
 */
export const SIMPLEFIN_PARAM_NAME = '/goldfinch/prod/simplefin/access-url';

/** SimpleFIN protocol version pin; always sent as `?version=2`. */
export const SIMPLEFIN_API_VERSION = '2';

/**
 * Household calendar time zone. Transaction SK date bucketing AND every API
 * date window (cashflow, budgets, "current month") use this same calendar so
 * a transaction can never escape its own month's window.
 */
export const DEFAULT_TZ = 'America/New_York';

/** Current item schema version stamped on every DynamoDB item. */
export const SCHEMA_VERSION = 1;

/**
 * Category slug for retirement/investment contributions. Brokerage feeds report
 * a 401k/IRA contribution as a NEGATIVE (cash-deployed-to-buy) amount on an
 * investment account; the sync records those as POSITIVE income under this
 * category so they show as income (and, being positive, never as spend). The
 * matching CATEGORY row is type INCOME.
 */
export const RETIREMENT_CONTRIBUTIONS_CATEGORY_ID = 'retirement-contributions';

/** Cursor pagination defaults (transactions list). */
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

/** Maximum allowed transactions date-range span in days (400 RANGE_TOO_LARGE beyond). */
export const MAX_RANGE_DAYS = 366;

/**
 * API Gateway HTTP API route keys served by the app API Lambda. The handler's router
 * switches on `event.routeKey`, which is exactly these strings.
 */
export const API_ROUTES = {
  health: 'GET /health',
  listAccounts: 'GET /accounts',
  getAccount: 'GET /accounts/{accountId}',
  listAccountTransactions: 'GET /accounts/{accountId}/transactions',
  summary: 'GET /summary',
  listTransactions: 'GET /transactions',
  patchTransaction: 'PATCH /transactions/{txnId}',
  listBudgets: 'GET /budgets',
  createBudget: 'POST /budgets',
  patchBudget: 'PATCH /budgets/{categoryId}',
  deleteBudget: 'DELETE /budgets/{categoryId}',
  listCategories: 'GET /categories',
  createCategory: 'POST /categories',
  patchCategory: 'PATCH /categories/{categoryId}',
  deleteCategory: 'DELETE /categories/{categoryId}',
  cashflow: 'GET /cashflow',
  // --- Phase 7 (PHASE7-DECISIONS.md). Adding a key here auto-registers a
  // --- JWT-gated gateway route; the infra route table is DERIVED from this
  // --- manifest and a parity test enforces it. Never hand-add routes to infra.
  // P7-1 recurring/subscriptions
  listRecurring: 'GET /recurring',
  patchRecurring: 'PATCH /recurring/{seriesId}',
  // P7-2 savings goals
  listGoals: 'GET /goals',
  createGoal: 'POST /goals',
  patchGoal: 'PATCH /goals/{goalId}',
  deleteGoal: 'DELETE /goals/{goalId}',
  createGoalContribution: 'POST /goals/{goalId}/contributions',
  // P7-3 investment holdings
  listAccountHoldings: 'GET /accounts/{accountId}/holdings',
  // P7-4 reports + net-worth history
  netWorthHistory: 'GET /networth/history',
  reportsTrends: 'GET /reports/trends',
  reportsFlow: 'GET /reports/flow',
  // P7-5 rules engine
  listRules: 'GET /rules',
  createRule: 'POST /rules',
  patchRule: 'PATCH /rules/{ruleId}',
  deleteRule: 'DELETE /rules/{ruleId}',
  applyRule: 'POST /rules/{ruleId}/apply',
  // P7-6 CSV import + manual accounts
  importTransactions: 'POST /import/transactions',
  createAccount: 'POST /accounts',
  // P7-8 push-token registration
  registerPushToken: 'POST /devices/push-token',
  deletePushToken: 'DELETE /devices/push-token/{deviceId}',
  // P7-9 attachments (S3 presign flow)
  createAttachment: 'POST /transactions/{txnId}/attachments',
  listAttachments: 'GET /transactions/{txnId}/attachments',
  getAttachmentDownload: 'GET /transactions/{txnId}/attachments/{attachId}',
  deleteAttachment: 'DELETE /transactions/{txnId}/attachments/{attachId}',
  // User profile (per Cognito sub within the household; PROFILE#<sub> items)
  getProfile: 'GET /profile',
  patchProfile: 'PATCH /profile',
  // --- Phase 8 (ops/PHASE8-DECISIONS.md)
  // P8-4 account type editing: sets the USER-OWNED typeOverride /
  // isLiabilityOverride fields; validated against AccountTypeId via the
  // shared isAccountTypeId() guard.
  patchAccount: 'PATCH /accounts/{accountId}',
  // On-demand "Sync now": POST async-invokes the sync Lambda (202-style
  // accept, SYNC_RUN_DEBOUNCE_SECONDS tap-spam guard); GET reads the
  // SYNC#STATE singleton and maps it to SyncStatusResponse.
  syncRun: 'POST /sync/run',
  syncStatus: 'GET /sync/status',
} as const;

export type ApiRouteName = keyof typeof API_ROUTES;
export type ApiRouteKey = (typeof API_ROUTES)[ApiRouteName];

// ---------------------------------------------------------------------------
// Phase 7 contract constants (PHASE7-DECISIONS.md)
// ---------------------------------------------------------------------------

/** P7-9: hard cap on a single attachment object. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/** P7-9: content-type allowlist enforced at presign time and by bucket policy. */
export const ATTACHMENT_ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf',
] as const;

export type AttachmentContentType = (typeof ATTACHMENT_ALLOWED_CONTENT_TYPES)[number];

/** P7-9: presigned PUT/GET URL lifetime, seconds. */
export const ATTACHMENT_PRESIGN_TTL_SECONDS = 300;

/** P7-6: server-side cap on rows per POST /import/transactions batch. */
export const IMPORT_MAX_ROWS_PER_BATCH = 500;

/**
 * P7-8: EventBridge contract between the sync Lambda and the notifications
 * Lambda on the default bus. The rule pattern and the emitter must both use
 * these exact strings.
 */
export const SYNC_EVENT_SOURCE = 'goldfinch.sync';
export const SYNC_COMPLETED_DETAIL_TYPE = 'SyncCompleted';

/**
 * User profile display-name length bounds, enforced on the TRIMMED value.
 * Single source for both the API validator (PATCH /profile -> 400
 * VALIDATION_ERROR outside the bounds) and the client-side form check, so the
 * two can never disagree (P7-10 single-source business rules).
 */
export const PROFILE_DISPLAY_NAME_MIN_LENGTH = 1;
export const PROFILE_DISPLAY_NAME_MAX_LENGTH = 40;

/**
 * Server-enforced maximum lengths for the free-text fields a client can send.
 * Validated on the API (over-length -> 400 VALIDATION_ERROR) so an unbounded
 * payload can never bloat an item, a log line, or a downstream render. Single
 * source so the client form checks and the server validator can never disagree.
 *
 * Bounds are character counts on the value the server stores: most fields are
 * validated AFTER trimming/normalization (the route trims first), matching how
 * the value is persisted. Generous on purpose — these are abuse ceilings, not
 * UX limits.
 */
export const MAX_TEXT_LENGTHS = {
  /** Category display name (PATCH/POST /categories `name`). */
  categoryName: 60,
  /** Manual-account display name (POST /accounts `name`). */
  accountName: 60,
  /** Manual-account institution label (POST /accounts `institution`). */
  accountInstitution: 60,
  /** Transaction note (PATCH /transactions, POST /import/transactions row). */
  transactionNote: 500,
  /** Imported-row payee/description (POST /import/transactions row `payee`). */
  importPayee: 200,
  /** Categorization-rule pattern (POST/PATCH /rules `pattern`). */
  rulePattern: 100,
} as const;

export type MaxTextLengthField = keyof typeof MAX_TEXT_LENGTHS;

// ---------------------------------------------------------------------------
// On-demand sync in-flight marker (security hardening): the API writes a short-
// lived SYNC#RUNNING item BEFORE it async-invokes the sync Lambda, refusing a
// new POST /sync/run while a fresh marker exists. This stops a tap-spam fan-out
// from firing many concurrent full SimpleFIN-pull Lambdas (cost/DoS, and a
// SimpleFIN 402/403 wedge). The sync handler DELETES the marker when its run
// finishes, so the next scheduled/manual run proceeds.
//
// There is no DynamoDB native TTL on the table, so the marker uses a SOFT TTL:
// it carries a `runningSince` ISO timestamp and the conditional set treats a
// marker older than SYNC_RUNNING_TTL_SECONDS as expired. A run that crashed
// before clearing the marker therefore never wedges the button shut forever —
// the next tap past the window is allowed through. Single source for the API
// writer and the sync clearer so the two can never disagree on the contract.
// ---------------------------------------------------------------------------

/**
 * Soft expiry of the SYNC#RUNNING in-flight marker, seconds. A marker whose
 * `runningSince` is older than this is treated as stale (a crashed run) and a
 * new POST /sync/run is allowed to overwrite it. Comfortably larger than the
 * sync Lambda's 120s timeout so a healthy in-flight run is never mistaken for
 * stale, yet short enough that a wedge self-heals within minutes.
 */
export const SYNC_RUNNING_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// Phase 8 contract constants (ops/PHASE8-DECISIONS.md)
// ---------------------------------------------------------------------------

/**
 * On-demand sync debounce window, seconds. POST /sync/run refuses to invoke
 * the sync Lambda again while SYNC#STATE lastRunAt is within this window and
 * answers { accepted: false, alreadyRunning: true } instead — cheap
 * protection against tap-spam. Single source for the API handler and any
 * client-side cool-down display, so the two can never disagree.
 */
export const SYNC_RUN_DEBOUNCE_SECONDS = 120;
