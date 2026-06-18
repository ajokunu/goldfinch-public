/**
 * Display helpers for the holdings table (P7-3). Shares are exact decimal
 * strings (DecimalString, NOT money); they are trimmed of trailing zeros for
 * display but never parsed into floats. The account-type label rides the
 * shared ACCOUNT_TYPES metadata over the EFFECTIVE type id (P8-4) -- never a
 * local copy of the per-type rules.
 */
import { ACCOUNT_TYPES, type AccountTypeId } from '@goldfinch/shared/accountTypes';
import type { DecimalString } from '@goldfinch/shared/types';

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** "12.5000" -> "12.5", "3.000" -> "3"; malformed input renders verbatim. */
export function formatShares(shares: DecimalString): string {
  const trimmed = shares.trim();
  if (!DECIMAL_RE.test(trimmed) || !trimmed.includes('.')) return trimmed;
  const stripped = trimmed.replace(/0+$/, '').replace(/\.$/, '');
  return stripped === '' || stripped === '-' ? '0' : stripped;
}

/** Display label for an effective account type id (shared metadata). */
export function accountTypeLabel(accountTypeId: AccountTypeId): string {
  return ACCOUNT_TYPES[accountTypeId].label;
}
