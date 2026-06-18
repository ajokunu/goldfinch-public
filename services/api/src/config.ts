/** Tunables local to the app API Lambda (master plan sections 8 and 14). */

/**
 * When a server-side filter (q / pendingOnly) is active, a page can come back
 * near-empty while more matching rows exist. The list endpoint re-queries up to
 * this many times to fill the page before returning, so clients never see an
 * empty page with a non-null cursor (master plan section 14, step 5).
 */
export const AUTOFILL_MAX_ITERATIONS = 5;

/** Maximum number of months a single cashflow request may span. */
export const MAX_CASHFLOW_MONTHS = 36;

/** Default sortOrder for client-created categories without an explicit one. */
export const DEFAULT_CATEGORY_SORT_ORDER = 1000;

/** GET /reports/trends — trailing months returned when ?months is omitted. */
export const DEFAULT_TREND_MONTHS = 6;

/** GET /reports/trends — hard cap on ?months (mirrors MAX_CASHFLOW_MONTHS). */
export const MAX_TREND_MONTHS = MAX_CASHFLOW_MONTHS;

/**
 * POST /rules/{ruleId}/apply — the default retroactive window (days before
 * today) when the request body carries no explicit from/to (P7-5).
 */
export const APPLY_RULE_DEFAULT_DAYS = 365;

/** Default priority for rules created without an explicit one. */
export const DEFAULT_RULE_PRIORITY = 100;

/** POST /import/transactions — concurrent per-row transactional writes. */
export const IMPORT_WRITE_CONCURRENCY = 25;

/** DELETE /goals/{goalId} — retries for unprocessed BatchWrite delete items. */
export const BATCH_DELETE_MAX_RETRIES = 3;
