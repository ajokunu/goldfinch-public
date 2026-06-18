/**
 * Sync-side enrichment over the shared SimpleFIN normalizer.
 *
 * @goldfinch/shared/simplefin produces contract-shaped AccountItem /
 * TransactionItem / TxnPointerItem values. This module loops the wire payload
 * itself (instead of normalizeAccountSet) so each item can be enriched with
 * the attributes only the sync pipeline persists:
 *
 *   - accounts: balanceRaw / availableBalanceRaw (SimpleFIN's exact decimal
 *     strings) and the derived isLiability flag
 *   - transactions: amountRaw
 *
 * It also dedupes by SimpleFIN txn id within a single payload (defensive -
 * BatchWriteItem rejects two operations on one key in one request) and counts
 * transactions per account for SYNC#STATE.
 */

import type {
  NormalizeContext,
  SimpleFinAccountSet,
  SimpleFinErrlistEntry,
} from '@goldfinch/shared/simplefin';
import { RETIREMENT_CONTRIBUTIONS_CATEGORY_ID } from '@goldfinch/shared/constants';
import {
  normalizeAccount,
  normalizeTransaction,
} from '@goldfinch/shared/simplefin';
import { isLiabilityType } from '@goldfinch/shared/types';
import type { AccountType, TxnPointerItem } from '@goldfinch/shared/types';

import type { SyncAccountItem, SyncTransactionItem } from './types.js';

export interface SyncNormalized {
  accounts: SyncAccountItem[];
  transactions: SyncTransactionItem[];
  pointers: TxnPointerItem[];
  errlist: SimpleFinErrlistEntry[];
  /** SimpleFIN account id -> transaction count in this payload. */
  perAccountTxnCounts: Record<string, number>;
}

/** Normalize a full /accounts response into ready-to-write sync items. */
export function normalizeForSync(
  accountSet: SimpleFinAccountSet,
  ctx: NormalizeContext,
): SyncNormalized {
  const accounts: SyncAccountItem[] = [];
  const byTxnId = new Map<string, { transaction: SyncTransactionItem; pointer: TxnPointerItem }>();
  const perAccountTxnCounts: Record<string, number> = {};

  for (const account of accountSet.accounts) {
    const base = normalizeAccount(account, ctx);
    // Durable investment classification: SimpleFIN exposes no account type, so
    // we derive it from actual holdings. The MX/SimpleFIN bridge attaches an
    // EMPTY `holdings: []` to ordinary bank and card accounts, so mere presence
    // of the array is NOT a signal -- only an account that actually holds at
    // least one position is an investment account. This is the single
    // derivation; the Investments tab never has to be hand-fed account ids. An
    // explicit ACCOUNT_TYPES_JSON mapping still wins (admin override), and the
    // P8-4 user `typeOverride` still wins at the effective-type layer.
    const reportsHoldings = Array.isArray(account.holdings) && account.holdings.length > 0;
    const hasConfiguredType = ctx.accountTypes?.[account.id] !== undefined;
    const accountType: AccountType =
      reportsHoldings && !hasConfiguredType ? 'investment' : base.accountType;
    const enriched: SyncAccountItem = {
      ...base,
      accountType,
      balanceRaw: account.balance,
      isLiability: isLiabilityType(accountType),
    };
    const availableRaw = account['available-balance'];
    if (availableRaw !== undefined) {
      enriched.availableBalanceRaw = availableRaw;
    }
    accounts.push(enriched);

    const txns = account.transactions ?? [];
    perAccountTxnCounts[account.id] = txns.length;
    for (const txn of txns) {
      const { transaction, pointer } = normalizeTransaction(txn, account, ctx);
      let amountRaw = txn.amount;
      // Investment-account contributions: a brokerage feed reports a 401k/IRA
      // contribution as a NEGATIVE (cash-deployed-to-buy) amount, which would
      // read as a cost (negative income, or an outflow). Record it as POSITIVE
      // income under the Retirement Contributions category so it shows as income
      // and -- being positive -- never as spend. The positive amount is re-applied
      // every sync (amountMinor is bank-owned); the category is set only at
      // creation and preserved thereafter (the categorizer skips categoryId != null,
      // and the writer never overwrites the user/creation-owned categoryId).
      if (
        accountType === 'investment' &&
        /contribution/i.test(transaction.payee)
      ) {
        transaction.amountMinor = Math.abs(transaction.amountMinor);
        transaction.categoryId = RETIREMENT_CONTRIBUTIONS_CATEGORY_ID;
        transaction.isTransfer = false;
        amountRaw = amountRaw.replace(/^-/, '');
      }
      // Last occurrence wins; SimpleFIN ids are unique, so collisions only
      // happen on malformed payloads and must not corrupt a batch.
      byTxnId.set(txn.id, {
        transaction: { ...transaction, amountRaw },
        pointer,
      });
    }
  }

  const transactions: SyncTransactionItem[] = [];
  const pointers: TxnPointerItem[] = [];
  for (const entry of byTxnId.values()) {
    transactions.push(entry.transaction);
    pointers.push(entry.pointer);
  }

  return {
    accounts,
    transactions,
    pointers,
    errlist: accountSet.errlist ?? [],
    perAccountTxnCounts,
  };
}
