/**
 * Typed SimpleFIN Bridge client + normalizer (protocol v2,
 * https://www.simplefin.org/protocol.html; facts verified in master plan section 9).
 *
 * Lifecycle:
 *   1. claimAccessUrl(setupToken)  — ONE-TIME. Decodes the base64 setup token to the
 *      claim URL, POSTs it, returns the permanent access URL. A second POST returns
 *      403 (the token is single-use). Run out-of-band; the access URL is then stored
 *      in SSM SecureString /goldfinch/prod/simplefin/access-url (CMK-encrypted,
 *      readable only by the sync Lambda role).
 *   2. fetchAccounts(accessUrl, opts) — the daily sync read. Basic-auth credentials
 *      and the host are ALWAYS derived from the access URL itself, never hardcoded.
 *   3. normalizeAccountSet(...) — maps SimpleFIN shapes (mixed hyphen/underscore
 *      field names, decimal-string money) onto GoldFinch DynamoDB items.
 *
 * SECURITY: the access URL embeds credentials. It must never be logged or appear in
 * error messages — errors below carry the host only.
 */

import { Buffer } from 'node:buffer';

import { DEFAULT_TZ, SCHEMA_VERSION, SIMPLEFIN_API_VERSION } from './constants.js';
import { epochSecondsToIsoDateInTz } from './dates.js';
import {
  acctSk,
  gsi1Pk,
  gsi1Sk,
  txnPointerSk,
  txnSk,
  userPk,
} from './keys.js';
import { minorUnitDigits, parseDecimalString } from './money.js';
import type { EpochSeconds, IsoDate, IsoTimestamp } from './types/common.js';
import type {
  AccountItem,
  AccountType,
  TransactionItem,
  TxnPointerItem,
} from './types/entities.js';

// ---------------------------------------------------------------------------
// Wire types (exactly as SimpleFIN sends them — note the mixed hyphenated and
// underscore field names; both conventions appear in real responses)
// ---------------------------------------------------------------------------

export interface SimpleFinOrg {
  domain?: string;
  name?: string;
  'sfin-url': string;
  url?: string;
  id?: string;
}

export interface SimpleFinTransaction {
  /** Stable unique id — GoldFinch's dedupe/idempotency key. */
  id: string;
  /** Epoch seconds; 0 while the transaction is pending. */
  posted: EpochSeconds;
  /** NUMERIC STRING, sign = direction (expense negative). Never parse as float. */
  amount: string;
  description?: string;
  payee?: string;
  memo?: string;
  /** Epoch seconds; the true transaction time when provided. */
  transacted_at?: EpochSeconds;
  /** Present and true while pending; absent or false once posted. */
  pending?: boolean;
}

export interface SimpleFinAccount {
  id: string;
  name: string;
  /** ISO-4217 code, or a URL for non-fiat currencies. */
  currency: string;
  /** NUMERIC STRING. Never parse as float. */
  balance: string;
  'available-balance'?: string;
  /** Epoch seconds. */
  'balance-date': EpochSeconds;
  org: SimpleFinOrg;
  transactions?: SimpleFinTransaction[];
  holdings?: unknown[];
}

/** Structured per-connection/per-account errors; present even on HTTP 200. */
export interface SimpleFinErrlistEntry {
  /** e.g. "gen.auth", "con.auth", "act.failed", "act.missingdata". */
  code: string;
  msg: string;
}

export interface SimpleFinAccountSet {
  /** Legacy free-text errors. */
  errors?: string[];
  errlist?: SimpleFinErrlistEntry[];
  accounts: SimpleFinAccount[];
}

// ---------------------------------------------------------------------------
// Errors (never carry credentials; host only)
// ---------------------------------------------------------------------------

export class SimpleFinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimpleFinError';
  }
}

/** Claim failed — most commonly 403 because the single-use token was already claimed. */
export class SimpleFinClaimError extends SimpleFinError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SimpleFinClaimError';
  }
}

/** 403 from /accounts — access URL invalid or disabled; a re-claim is needed. */
export class SimpleFinAuthError extends SimpleFinError {
  readonly status = 403;

  constructor(message: string) {
    super(message);
    this.name = 'SimpleFinAuthError';
  }
}

/** 402 from /accounts — the SimpleFIN subscription lapsed; renew to resume. */
export class SimpleFinPaymentRequiredError extends SimpleFinError {
  readonly status = 402;

  constructor(message: string) {
    super(message);
    this.name = 'SimpleFinPaymentRequiredError';
  }
}

/** Any other non-2xx from the bridge. */
export class SimpleFinHttpError extends SimpleFinError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SimpleFinHttpError';
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** Injectable for tests; defaults to the Node 20+ global fetch. */
export type FetchLike = typeof fetch;

/** Decode a base64 setup token into its one-time claim URL. */
export function decodeSetupToken(setupToken: string): string {
  const trimmed = setupToken.trim();
  if (trimmed.length === 0) {
    throw new SimpleFinError('setup token is empty');
  }
  let claimUrl: string;
  try {
    claimUrl = Buffer.from(trimmed, 'base64').toString('utf8').trim();
  } catch {
    throw new SimpleFinError('setup token is not valid base64');
  }
  if (!/^https:\/\/\S+$/.test(claimUrl)) {
    throw new SimpleFinError('setup token did not decode to an https claim URL');
  }
  return claimUrl;
}

/**
 * ONE-TIME claim: exchange the setup token for the permanent access URL.
 * The setup token dies on the first successful POST — never call this from the
 * recurring sync path (a buggy retry would 403-storm and burn the token).
 * Returns the access URL of the form https://<user>:<pass>@<host>/simplefin.
 */
export async function claimAccessUrl(
  setupToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const claimUrl = decodeSetupToken(setupToken);
  const response = await fetchImpl(claimUrl, {
    method: 'POST',
    headers: { 'content-length': '0' },
  });
  if (response.status === 403) {
    throw new SimpleFinClaimError(
      'claim returned 403: setup token already claimed or invalid',
      403,
    );
  }
  if (!response.ok) {
    throw new SimpleFinClaimError(`claim failed with HTTP ${response.status}`, response.status);
  }
  const accessUrl = (await response.text()).trim();
  // Validates shape (embedded credentials, https) before returning.
  parseAccessUrl(accessUrl);
  return accessUrl;
}

export interface AccessUrlParts {
  /** Scheme + host + path, credentials stripped, no trailing slash. Safe to log. */
  baseUrl: string;
  /** Host derived from the access URL (e.g. beta-bridge.simplefin.org). Never hardcode. */
  host: string;
  /** Value for the Authorization header ("Basic <base64(user:pass)>"). NEVER log. */
  authorization: string;
}

/** Split a claimed access URL into a credential-free base URL and a Basic Auth header. */
export function parseAccessUrl(accessUrl: string): AccessUrlParts {
  let url: URL;
  try {
    url = new URL(accessUrl.trim());
  } catch {
    throw new SimpleFinError('access URL is not a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw new SimpleFinError('access URL must use https');
  }
  if (url.username === '' || url.password === '') {
    throw new SimpleFinError('access URL is missing embedded credentials');
  }
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
  const path = url.pathname.replace(/\/+$/, '');
  return {
    baseUrl: `${url.origin}${path}`,
    host: url.host,
    authorization,
  };
}

export interface FetchAccountsOptions {
  /** Inclusive lower bound, epoch seconds (sent as start-date). */
  startDate?: EpochSeconds;
  /** Exclusive upper bound, epoch seconds (sent as end-date). */
  endDate?: EpochSeconds;
  /** Include pending transactions (sent as pending=1). */
  pending?: boolean;
  /** Skip transactions entirely (sent as balances-only=1). */
  balancesOnly?: boolean;
  /** Restrict to specific SimpleFIN account ids (repeated account= params). */
  accounts?: string[];
}

/**
 * GET {accessUrl}/accounts. Always pins ?version=2. Budget: stay at or under the
 * documented 24 requests/day or the bridge disables the access URL.
 */
export async function fetchAccounts(
  accessUrl: string,
  options: FetchAccountsOptions = {},
  fetchImpl: FetchLike = fetch,
): Promise<SimpleFinAccountSet> {
  const { baseUrl, host, authorization } = parseAccessUrl(accessUrl);
  const url = new URL(`${baseUrl}/accounts`);
  url.searchParams.set('version', SIMPLEFIN_API_VERSION);
  if (options.startDate !== undefined) {
    url.searchParams.set('start-date', String(Math.trunc(options.startDate)));
  }
  if (options.endDate !== undefined) {
    url.searchParams.set('end-date', String(Math.trunc(options.endDate)));
  }
  if (options.pending) {
    url.searchParams.set('pending', '1');
  }
  if (options.balancesOnly) {
    url.searchParams.set('balances-only', '1');
  }
  for (const accountId of options.accounts ?? []) {
    url.searchParams.append('account', accountId);
  }

  const response = await fetchImpl(url, {
    headers: { authorization, accept: 'application/json' },
  });

  if (response.status === 402) {
    throw new SimpleFinPaymentRequiredError(
      `SimpleFIN subscription lapsed (402 from ${host})`,
    );
  }
  if (response.status === 403) {
    throw new SimpleFinAuthError(
      `SimpleFIN auth failed (403 from ${host}); access URL invalid — re-claim needed`,
    );
  }
  if (!response.ok) {
    throw new SimpleFinHttpError(
      `SimpleFIN request failed (HTTP ${response.status} from ${host})`,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SimpleFinError(`SimpleFIN response from ${host} is not valid JSON`);
  }
  const accountSet = body as SimpleFinAccountSet;
  if (!Array.isArray(accountSet.accounts)) {
    throw new SimpleFinError(
      `malformed SimpleFIN response from ${host}: missing accounts array`,
    );
  }
  return accountSet;
}

// ---------------------------------------------------------------------------
// Normalizer: SimpleFIN shapes -> GoldFinch DynamoDB items
// ---------------------------------------------------------------------------

export interface NormalizeContext {
  /** Household id (the `household` access-token claim value). */
  household: string;
  /** Clock injection point for tests; defaults to new Date(). */
  now?: Date;
  /**
   * SimpleFIN does not expose an account type; map SimpleFIN account ids to
   * GoldFinch account types here (seeded config). Unmapped accounts get "other".
   */
  accountTypes?: Record<string, AccountType>;
}

export interface NormalizedTransaction {
  transaction: TransactionItem;
  pointer: TxnPointerItem;
}

export interface NormalizedAccountSet {
  accounts: AccountItem[];
  transactions: TransactionItem[];
  pointers: TxnPointerItem[];
  /** Pass-through of structured errors for the notification mapper. */
  errlist: SimpleFinErrlistEntry[];
}

/**
 * Epoch seconds -> calendar date (yyyy-mm-dd) in `tz` (DEFAULT_TZ,
 * America/New_York, unless overridden).
 *
 * SK dates MUST be bucketed by the same calendar as the API date windows
 * (which are all DEFAULT_TZ); bucketing by UTC would push transactions posted
 * 8pm-midnight ET into the next day and let month-end transactions escape
 * their month's cashflow/budget windows.
 */
export function epochToIsoDate(
  epochSeconds: EpochSeconds,
  tz: string = DEFAULT_TZ,
): IsoDate {
  if (!Number.isFinite(epochSeconds)) {
    throw new SimpleFinError(`invalid epoch timestamp: ${String(epochSeconds)}`);
  }
  return epochSecondsToIsoDateInTz(epochSeconds, tz);
}

function nowParts(ctx: NormalizeContext): { iso: IsoTimestamp; date: Date } {
  const date = ctx.now ?? new Date();
  return { iso: date.toISOString(), date };
}

/** Map one SimpleFIN account onto the ACCT# item (overwritten each sync). */
export function normalizeAccount(
  account: SimpleFinAccount,
  ctx: NormalizeContext,
): AccountItem {
  const digits = minorUnitDigits(account.currency);
  const { iso } = nowParts(ctx);
  const availableBalance = account['available-balance'];
  const item: AccountItem = {
    PK: userPk(ctx.household),
    SK: acctSk(account.id),
    entityType: 'ACCOUNT',
    schemaVersion: SCHEMA_VERSION,
    name: account.name,
    accountType: ctx.accountTypes?.[account.id] ?? 'other',
    institution: account.org?.name ?? account.org?.domain ?? 'Unknown',
    balanceMinor: parseDecimalString(account.balance, digits),
    currency: account.currency,
    balanceDate: account['balance-date'],
    simplefinAccountId: account.id,
    lastSyncedAt: iso,
  };
  if (availableBalance !== undefined) {
    item.availableBalanceMinor = parseDecimalString(availableBalance, digits);
  }
  if (account.org?.id !== undefined) {
    item.simplefinOrgId = account.org.id;
  }
  return item;
}

/**
 * Map one SimpleFIN transaction onto the TXN# item plus its TXNPTR# pointer.
 *
 * Date bucket: posted date once posted; while pending (posted === 0 or
 * pending === true), transacted_at, falling back to the sync time. The pointer
 * records the current SK so the sync writer can relocate the item (delete the
 * stale-dated copy transactionally) when the date shifts on pending -> posted.
 *
 * Normalized transactions start uncategorized (categoryId null), so GSI2 keys
 * are intentionally absent — the spend index only ever contains categorized,
 * non-transfer expenses. The categorizer/writer adds GSI2PK/GSI2SK later.
 */
export function normalizeTransaction(
  txn: SimpleFinTransaction,
  account: SimpleFinAccount,
  ctx: NormalizeContext,
): NormalizedTransaction {
  const { iso, date: now } = nowParts(ctx);
  const pending = txn.pending === true || txn.posted === 0;
  // Budget/period bucketing keys off the SK date, which must be WHEN THE
  // TRANSACTION HAPPENED, not when it cleared. SimpleFIN `posted` is the bank's
  // clearing date -- a June-12 purchase commonly posts June 15 -- so keying the
  // SK off `posted` lands the spend in the wrong budget week. Prefer
  // `transacted_at` (the actual transaction date) for the SK / GSI1SK / GSI2SK;
  // fall back to `posted` for a cleared txn that lacks it, or to the sync time
  // for a pending one (best available estimate until it clears).
  const skDate: IsoDate =
    txn.transacted_at !== undefined
      ? epochToIsoDate(txn.transacted_at)
      : pending
        ? epochToIsoDate(Math.trunc(now.getTime() / 1000))
        : epochToIsoDate(txn.posted);
  const sk = txnSk(skDate, txn.id);
  const pk = userPk(ctx.household);

  const transaction: TransactionItem = {
    PK: pk,
    SK: sk,
    entityType: 'TRANSACTION',
    schemaVersion: SCHEMA_VERSION,
    amountMinor: parseDecimalString(txn.amount, minorUnitDigits(account.currency)),
    currency: account.currency,
    payee: txn.payee ?? txn.description ?? '',
    categoryId: null,
    accountId: account.id,
    pending,
    isTransfer: false,
    // The true bank clearing date (independent of the SK bucketing date above):
    // null while pending, the SimpleFIN `posted` epoch once cleared.
    postedDate: pending ? null : epochToIsoDate(txn.posted),
    simplefinTxnId: txn.id,
    categorizedBy: null,
    userCategorized: false,
    lastEditedBy: null,
    version: 1,
    GSI1PK: gsi1Pk(ctx.household, account.id),
    GSI1SK: gsi1Sk(skDate, txn.id),
    createdAt: iso,
    updatedAt: iso,
  };
  if (txn.description !== undefined) {
    transaction.description = txn.description;
  }
  if (transaction.payee.length > 0) {
    transaction.payeeLower = transaction.payee.toLowerCase();
  }
  if (txn.memo !== undefined) {
    transaction.memo = txn.memo;
  }
  if (txn.transacted_at !== undefined) {
    transaction.transactedAt = txn.transacted_at;
  }

  const pointer: TxnPointerItem = {
    PK: pk,
    SK: txnPointerSk(txn.id),
    entityType: 'TXN_POINTER',
    schemaVersion: SCHEMA_VERSION,
    simplefinTxnId: txn.id,
    currentSk: sk,
  };

  return { transaction, pointer };
}

/** Normalize a full /accounts response into ready-to-write GoldFinch items. */
export function normalizeAccountSet(
  accountSet: SimpleFinAccountSet,
  ctx: NormalizeContext,
): NormalizedAccountSet {
  const accounts: AccountItem[] = [];
  const transactions: TransactionItem[] = [];
  const pointers: TxnPointerItem[] = [];

  for (const account of accountSet.accounts) {
    accounts.push(normalizeAccount(account, ctx));
    for (const txn of account.transactions ?? []) {
      const { transaction, pointer } = normalizeTransaction(txn, account, ctx);
      transactions.push(transaction);
      pointers.push(pointer);
    }
  }

  return {
    accounts,
    transactions,
    pointers,
    errlist: accountSet.errlist ?? [],
  };
}
