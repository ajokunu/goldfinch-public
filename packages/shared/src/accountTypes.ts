/**
 * Account-type metadata + effective-value precedence (P8-4,
 * ops/PHASE8-DECISIONS.md).
 *
 * This module is the ONLY place where the precedence
 *
 *   user override ?? synced value ?? per-type metadata default
 *
 * is computed. The API (GET /accounts, /summary, /networth/history,
 * PATCH /accounts), the sync net-worth snapshot writer, and the app must all
 * call `effectiveAccountType()` / `effectiveIsLiability()` rather than
 * re-deriving classification inline — a divergent copy is a contract bug.
 *
 * Failure paths never throw: dirty runtime data (an unknown synced type or an
 * invalid stored override) degrades to a safe fallback and is reported
 * through the shared logger.
 */

import { createLogger, type Logger } from './logger.js';
import type { AccountType, AccountTypeId } from './types/entities.js';

export type { AccountTypeId } from './types/entities.js';

/** Module logger used when callers do not inject their own (P8-6 quality bar). */
const defaultLogger: Logger = createLogger({
  base: { service: 'shared.accountTypes' },
});

/**
 * Phosphor glyph keys for account-type identity icons. The app's icons module
 * (app/src/ui/icons) maps each key to its phosphor-react-native component; a
 * total Record over this union there makes a missing glyph a compile error.
 */
export type AccountTypeIconKey =
  | 'bank'
  | 'piggy-bank'
  | 'credit-card'
  | 'chart-line-up'
  | 'briefcase'
  | 'hand-coins'
  | 'money'
  | 'wallet';

/** Per-type display metadata + the liability default (P8-4). */
export interface AccountTypeMeta {
  /** Display label, e.g. "Credit Card". */
  label: string;
  /** Phosphor identity-icon key, resolved by app/src/ui/icons. */
  iconKey: AccountTypeIconKey;
  /**
   * Whether the type subtracts from net worth when the account carries no
   * isLiabilityOverride. Locked to the legacy isLiabilityType() semantics
   * for the synced types by test.
   */
  isLiabilityDefault: boolean;
}

/**
 * The locked per-type metadata map. Total over AccountTypeId: adding a type
 * id without metadata is a compile error.
 */
export const ACCOUNT_TYPES: Readonly<Record<AccountTypeId, AccountTypeMeta>> = {
  checking: { label: 'Checking', iconKey: 'bank', isLiabilityDefault: false },
  savings: { label: 'Savings', iconKey: 'piggy-bank', isLiabilityDefault: false },
  'credit-card': { label: 'Credit Card', iconKey: 'credit-card', isLiabilityDefault: true },
  investment: { label: 'Investment', iconKey: 'chart-line-up', isLiabilityDefault: false },
  business: { label: 'Business', iconKey: 'briefcase', isLiabilityDefault: false },
  loan: { label: 'Loan', iconKey: 'hand-coins', isLiabilityDefault: true },
  cash: { label: 'Cash', iconKey: 'money', isLiabilityDefault: false },
  other: { label: 'Other', iconKey: 'wallet', isLiabilityDefault: false },
};

/** Every AccountTypeId, in the locked display order of ACCOUNT_TYPES. */
export const ACCOUNT_TYPE_IDS: readonly AccountTypeId[] = Object.keys(
  ACCOUNT_TYPES,
) as AccountTypeId[];

/**
 * Runtime validator for untrusted input (the PATCH /accounts body). The API
 * leg MUST use this — not a hand-rolled list — so request validation can
 * never drift from the union (single-source business rule).
 */
export function isAccountTypeId(value: unknown): value is AccountTypeId {
  return typeof value === 'string' && Object.hasOwn(ACCOUNT_TYPES, value);
}

/**
 * Synced (SimpleFIN/legacy) account type -> user-facing type id. Only
 * 'credit' is renamed ('credit-card'); 'business' and 'cash' have no synced
 * source and exist purely as overrides.
 */
const SYNCED_TO_TYPE_ID: Readonly<Record<AccountType, AccountTypeId>> = {
  checking: 'checking',
  savings: 'savings',
  credit: 'credit-card',
  investment: 'investment',
  loan: 'loan',
  other: 'other',
};

/**
 * Maps a stored synced type to its AccountTypeId. Dirty runtime data (a type
 * string outside the union) degrades to 'other' with a logged warning — it
 * must never throw inside the sync snapshot writer or a GET handler.
 */
export function toAccountTypeId(
  accountType: AccountType,
  logger: Logger = defaultLogger,
): AccountTypeId {
  // Widened lookup: the parameter type is a union, but stored data can carry
  // strings outside it and that must degrade safely, not throw.
  const id = (SYNCED_TO_TYPE_ID as Readonly<Record<string, AccountTypeId>>)[
    accountType
  ];
  if (id === undefined) {
    logger.warn('unknown synced accountType; falling back to "other"', {
      accountType,
    });
    return 'other';
  }
  return id;
}

/**
 * Reverse compatibility mapping for legacy `AccountType` response fields that
 * predate P8-4 (AccountDto.accountType, SummaryTypeGroup.type). The ids with
 * no synced equivalent collapse: 'business' and 'cash' -> 'other',
 * 'credit-card' -> 'credit'.
 */
export function toLegacyAccountType(typeId: AccountTypeId): AccountType {
  switch (typeId) {
    case 'checking':
    case 'savings':
    case 'investment':
    case 'loan':
    case 'other':
      return typeId;
    case 'credit-card':
      return 'credit';
    case 'business':
    case 'cash':
      return 'other';
  }
}

/**
 * The minimal structural slice of AccountItem the precedence helpers need,
 * so the sync writer, route handlers, and tests can pass partial shapes.
 */
export interface AccountTypeFields {
  /** Synced/stored legacy type (required on every AccountItem). */
  accountType: AccountType;
  /** P8-4 USER-OWNED override; absent == none. */
  typeOverride?: AccountTypeId;
  /** P8-4 USER-OWNED override; absent == none. */
  isLiabilityOverride?: boolean;
}

/**
 * THE effective account type: `typeOverride ?? synced`. An invalid stored
 * override (dirty data) is ignored with a logged warning rather than
 * propagated. This function is the sole precedence source — never inline
 * `item.typeOverride ?? ...` elsewhere.
 */
export function effectiveAccountType(
  item: AccountTypeFields,
  logger: Logger = defaultLogger,
): AccountTypeId {
  const override = item.typeOverride;
  if (override !== undefined) {
    if (isAccountTypeId(override)) {
      return override;
    }
    logger.warn('ignoring invalid typeOverride on account item', {
      typeOverride: override,
      accountType: item.accountType,
    });
  }
  return toAccountTypeId(item.accountType, logger);
}

/**
 * THE effective liability classification:
 * `isLiabilityOverride ?? ACCOUNT_TYPES[effectiveAccountType(item)].isLiabilityDefault`.
 * With no overrides at all this equals the legacy isLiabilityType(synced)
 * behavior (locked by test). A type override with no liability override
 * follows the new type's default, so switching a type to 'credit-card'
 * immediately reclassifies net worth (P8-4).
 */
export function effectiveIsLiability(
  item: AccountTypeFields,
  logger: Logger = defaultLogger,
): boolean {
  const override = item.isLiabilityOverride;
  if (override !== undefined) {
    if (typeof override === 'boolean') {
      return override;
    }
    // Dirty runtime data (non-boolean stored value): ignore it, loudly.
    logger.warn('ignoring invalid isLiabilityOverride on account item', {
      isLiabilityOverride: override,
      accountType: item.accountType,
    });
  }
  return ACCOUNT_TYPES[effectiveAccountType(item, logger)].isLiabilityDefault;
}
