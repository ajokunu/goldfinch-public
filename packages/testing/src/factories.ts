/**
 * DynamoDB item factories for the GoldFinch single table.
 *
 * Every key string is produced by the @goldfinch/shared/keys builders — never
 * assembled by hand — so a factory-built item is key-compatible by
 * construction with whatever the sync writer persists and the API queries.
 * That is the point: tests written against these factories break loudly if
 * any workspace drifts from the shared key contract.
 */

import {
  acctSk,
  budgetSk,
  categorySk,
  gsi1Pk,
  gsi1Sk,
  gsi2Pk,
  gsi2Sk,
  profileSk,
  syncStateSk,
  txnPointerSk,
  txnSk,
  userPk,
} from '@goldfinch/shared/keys';
import { HOUSEHOLD_ID, SCHEMA_VERSION } from '@goldfinch/shared/constants';
import type {
  AccountItem,
  AccountType,
  BudgetItem,
  CategoryItem,
  CategoryType,
  IsoDate,
  SyncStateItem,
  TransactionItem,
  TxnPointerItem,
  UserProfileItem,
} from '@goldfinch/shared/types';
import { TEST_NOW_ISO, TEST_SUB_AARON } from './jwt.js';

/** Default epoch used for balance dates (2026-06-09 12:00:00 UTC). */
export const TEST_BALANCE_EPOCH = Math.floor(Date.parse(TEST_NOW_ISO) / 1000);

export interface ProfileFactoryInput {
  household?: string;
  sub?: string;
  displayName?: string;
  overrides?: Partial<UserProfileItem>;
}

export function makeUserProfileItem(
  input: ProfileFactoryInput = {},
): UserProfileItem {
  const household = input.household ?? HOUSEHOLD_ID;
  const sub = input.sub ?? TEST_SUB_AARON;
  return {
    PK: userPk(household),
    SK: profileSk(sub),
    entityType: 'USER',
    schemaVersion: SCHEMA_VERSION,
    cognitoSub: sub,
    displayName: input.displayName ?? 'Aaron',
    baseCurrency: 'USD',
    householdId: household,
    createdAt: TEST_NOW_ISO,
    ...(input.overrides ?? {}),
  };
}

export interface AccountFactoryInput {
  accountId?: string;
  household?: string;
  name?: string;
  accountType?: AccountType;
  institution?: string;
  balanceMinor?: number;
  availableBalanceMinor?: number;
  currency?: string;
  balanceDate?: number;
  overrides?: Partial<AccountItem>;
}

export function makeAccountItem(input: AccountFactoryInput = {}): AccountItem {
  const household = input.household ?? HOUSEHOLD_ID;
  const accountId = input.accountId ?? 'acct-checking';
  const item: AccountItem = {
    PK: userPk(household),
    SK: acctSk(accountId),
    entityType: 'ACCOUNT',
    schemaVersion: SCHEMA_VERSION,
    name: input.name ?? 'Everyday Checking',
    accountType: input.accountType ?? 'checking',
    institution: input.institution ?? 'Test Credit Union',
    balanceMinor: input.balanceMinor ?? 523_055,
    currency: input.currency ?? 'USD',
    balanceDate: input.balanceDate ?? TEST_BALANCE_EPOCH,
    simplefinAccountId: accountId,
    lastSyncedAt: TEST_NOW_ISO,
  };
  if (input.availableBalanceMinor !== undefined) {
    item.availableBalanceMinor = input.availableBalanceMinor;
  }
  return { ...item, ...(input.overrides ?? {}) };
}

export interface TransactionFactoryInput {
  txnId?: string;
  accountId?: string;
  date?: IsoDate;
  household?: string;
  amountMinor?: number;
  currency?: string;
  payee?: string;
  note?: string;
  pending?: boolean;
  isTransfer?: boolean;
  /** null (default) = uncategorized. */
  categoryId?: string | null;
  /**
   * Force GSI2 spend-index membership. Default: in the index exactly when the
   * transaction is categorized and not a transfer (the sparse-index contract).
   * Income categories should pass false explicitly.
   */
  inSpendIndex?: boolean;
  userCategorized?: boolean;
  version?: number;
  overrides?: Partial<TransactionItem>;
}

export function makeTransactionItem(
  input: TransactionFactoryInput = {},
): TransactionItem {
  const household = input.household ?? HOUSEHOLD_ID;
  const accountId = input.accountId ?? 'acct-checking';
  const txnId = input.txnId ?? 'txn-0001';
  const date = input.date ?? '2026-06-05';
  const pending = input.pending ?? false;
  const isTransfer = input.isTransfer ?? false;
  const categoryId = input.categoryId ?? null;
  const payee = input.payee ?? 'Whole Foods Market';

  const item: TransactionItem = {
    PK: userPk(household),
    SK: txnSk(date, txnId),
    entityType: 'TRANSACTION',
    schemaVersion: SCHEMA_VERSION,
    amountMinor: input.amountMinor ?? -4215,
    currency: input.currency ?? 'USD',
    payee,
    payeeLower: payee.toLowerCase(),
    categoryId,
    accountId,
    pending,
    isTransfer,
    postedDate: pending ? null : date,
    simplefinTxnId: txnId,
    categorizedBy: categoryId === null ? null : 'user',
    userCategorized: input.userCategorized ?? categoryId !== null,
    lastEditedBy: null,
    version: input.version ?? 1,
    GSI1PK: gsi1Pk(household, accountId),
    GSI1SK: gsi1Sk(date, txnId),
    createdAt: TEST_NOW_ISO,
    updatedAt: TEST_NOW_ISO,
  };
  if (input.note !== undefined) {
    item.note = input.note;
    item.noteLower = input.note.toLowerCase();
  }
  const inSpendIndex =
    input.inSpendIndex ?? (categoryId !== null && !isTransfer);
  if (inSpendIndex) {
    if (categoryId === null) {
      throw new Error('inSpendIndex requires a categoryId');
    }
    item.GSI2PK = gsi2Pk(household, categoryId);
    item.GSI2SK = gsi2Sk(date, txnId);
  }
  return { ...item, ...(input.overrides ?? {}) };
}

export interface PointerFactoryInput {
  txnId?: string;
  date?: IsoDate;
  household?: string;
  overrides?: Partial<TxnPointerItem>;
}

export function makeTxnPointerItem(
  input: PointerFactoryInput = {},
): TxnPointerItem {
  const household = input.household ?? HOUSEHOLD_ID;
  const txnId = input.txnId ?? 'txn-0001';
  const date = input.date ?? '2026-06-05';
  return {
    PK: userPk(household),
    SK: txnPointerSk(txnId),
    entityType: 'TXN_POINTER',
    schemaVersion: SCHEMA_VERSION,
    simplefinTxnId: txnId,
    currentSk: txnSk(date, txnId),
    ...(input.overrides ?? {}),
  };
}

/** Transaction plus the pointer the sync writer would pair with it. */
export function makeTransactionWithPointer(
  input: TransactionFactoryInput = {},
): { transaction: TransactionItem; pointer: TxnPointerItem } {
  const transaction = makeTransactionItem(input);
  const pointer = makeTxnPointerItem({
    txnId: transaction.simplefinTxnId,
    date: input.date ?? '2026-06-05',
    household: input.household,
  });
  return { transaction, pointer };
}

export interface CategoryFactoryInput {
  categoryId?: string;
  household?: string;
  name?: string;
  type?: CategoryType;
  archived?: boolean;
  sortOrder?: number;
  overrides?: Partial<CategoryItem>;
}

export function makeCategoryItem(input: CategoryFactoryInput = {}): CategoryItem {
  const household = input.household ?? HOUSEHOLD_ID;
  const categoryId = input.categoryId ?? 'groceries';
  return {
    PK: userPk(household),
    SK: categorySk(categoryId),
    entityType: 'CATEGORY',
    schemaVersion: SCHEMA_VERSION,
    categoryId,
    name: input.name ?? categoryId,
    type: input.type ?? 'EXPENSE',
    groupId: null,
    sortOrder: input.sortOrder ?? 100,
    archived: input.archived ?? false,
    createdAt: TEST_NOW_ISO,
    ...(input.overrides ?? {}),
  };
}

export interface BudgetFactoryInput {
  categoryId?: string;
  household?: string;
  limitMinor?: number;
  rollover?: boolean;
  version?: number;
  overrides?: Partial<BudgetItem>;
}

export function makeBudgetItem(input: BudgetFactoryInput = {}): BudgetItem {
  const household = input.household ?? HOUSEHOLD_ID;
  const categoryId = input.categoryId ?? 'groceries';
  return {
    PK: userPk(household),
    SK: budgetSk(categoryId),
    entityType: 'BUDGET',
    schemaVersion: SCHEMA_VERSION,
    categoryId,
    period: 'monthly',
    limitMinor: input.limitMinor ?? 60_000,
    rollover: input.rollover ?? false,
    version: input.version ?? 1,
    createdAt: TEST_NOW_ISO,
    ...(input.overrides ?? {}),
  };
}

export interface SyncStateFactoryInput {
  household?: string;
  overrides?: Partial<SyncStateItem>;
}

export function makeSyncStateItem(
  input: SyncStateFactoryInput = {},
): SyncStateItem {
  const household = input.household ?? HOUSEHOLD_ID;
  return {
    PK: userPk(household),
    SK: syncStateSk(),
    entityType: 'SYNC_STATE',
    schemaVersion: SCHEMA_VERSION,
    lastRunAt: TEST_NOW_ISO,
    lastRunStatus: 'success',
    perAccount: {
      'acct-checking': {
        lastSyncedAt: TEST_NOW_ISO,
        status: 'success',
        txnCount: 3,
      },
    },
    ...(input.overrides ?? {}),
  };
}
