/**
 * Sync-Lambda-private extensions of the shared entity contracts.
 *
 * The shared types in @goldfinch/shared/types are the cross-service contract;
 * the sync pipeline persists a handful of EXTRA attributes on top of them
 * (raw decimal strings for auditability, the derived liability flag, and the
 * sync cursor). Extending the shared interfaces keeps every contract field
 * type-checked while allowing the additive attributes - DynamoDB is
 * schemaless, so readers that only know the shared shape are unaffected.
 */

import type { TxnSk } from '@goldfinch/shared/keys';
import type {
  AccountItem,
  EpochSeconds,
  IsoTimestamp,
  SyncAccountStatus,
  SyncStateItem,
  TransactionItem,
  TxnPointerItem,
} from '@goldfinch/shared/types';

/**
 * ACCT# item as written by the sync Lambda.
 *
 * - `balanceRaw` / `availableBalanceRaw`: SimpleFIN's original decimal strings,
 *   kept verbatim next to the integer minor units (never floats anywhere).
 * - `isLiability`: derived from the account type via isLiabilityType() so the
 *   net-worth summary can sum without re-deriving.
 */
export interface SyncAccountItem extends AccountItem {
  balanceRaw: string;
  availableBalanceRaw?: string;
  isLiability: boolean;
}

/**
 * TXN# item as written by the sync Lambda: the shared TransactionItem plus the
 * original SimpleFIN amount string (`amountRaw`). All arithmetic uses
 * `amountMinor`; `amountRaw` exists for audit/debug parity with the source.
 */
export interface SyncTransactionItem extends TransactionItem {
  amountRaw: string;
}

/**
 * TXNPTR# item as written by the sync Lambda: the shared pointer plus the
 * `previousSk` re-key breadcrumb.
 *
 * During a pending->posted re-key the writer (in order) Puts the new TXN# row,
 * Puts the pointer with `currentSk` = new SK and `previousSk` = stale SK, then
 * Deletes the stale row, and only after that delete succeeds REMOVEs
 * `previousSk`. A pointer carrying `previousSk` therefore marks an incomplete
 * re-key from a crashed/throttled run; the next run deletes the named stale
 * row and clears the breadcrumb regardless of what `currentSk` says.
 */
export interface SyncTxnPointerItem extends TxnPointerItem {
  previousSk?: TxnSk;
}

/**
 * Per-account sync status plus the per-account cursor.
 *
 * `lastSuccessEpoch` is the end (epoch seconds) of the last run whose fetch
 * window fully covered this account's history gap AND that persisted this
 * account's data. It advances independently per account so one chronically
 * failing institution cannot pin every healthy account at a full-history
 * re-pull (see state.ts for the window-computation semantics).
 */
export interface SyncAccountState extends SyncAccountStatus {
  lastSuccessEpoch?: EpochSeconds;
  /** Set when the account's last run errored (or it was absent from an errored payload). */
  lastErrorAt?: IsoTimestamp;
  /** Human-readable reason for the error status (errlist text when available). */
  errorReason?: string;
}

/**
 * SYNC#STATE item plus the sync cursors.
 *
 * The authoritative cursor is per-account (`perAccount[*].lastSuccessEpoch`).
 * The record-level `lastSuccessEpoch` is kept for backward compatibility as
 * the MIN over all per-account cursors: the conservative point before which
 * every account's data is known to be persisted. The next run requests
 * `start-date = min(successful accounts' cursors) - OVERLAP_BUFFER_DAYS`,
 * clamped to `now - MAX_HISTORY_DAYS` (see computeWindowStart). Idempotent
 * upserts make any re-pull free.
 */
export interface SyncStateRecord extends SyncStateItem {
  lastSuccessEpoch?: number;
  perAccount: Record<string, SyncAccountState>;
}
