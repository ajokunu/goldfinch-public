/**
 * Budget-threshold evaluation for the notifications Lambda (P7-8).
 *
 * Percent math is NOT computed here: `percentUsed` / `reachedThresholds` from
 * @goldfinch/shared/budgetMath are THE single source of budget-percent
 * semantics (floor(spent * 100 / limit), BigInt-exact) shared with the app's
 * progress bars. This module only joins spend entries to budgets/categories
 * and shapes the crossings; the local floor implementation it used to carry
 * was deleted when budgetMath landed.
 *
 * Spend itself is aggregated from the month's TRANSACTION rows by
 * `spendByCategory`: a row counts exactly when the sync writer placed it in
 * the GSI2 spend index (GSI2PK/GSI2SK present -- categorized, non-transfer
 * expense rows), so this aggregation and the API's GET /budgets `spent` are
 * the same set by construction.
 */

import {
  BUDGET_ALERT_THRESHOLDS_PERCENT,
  percentUsed,
  reachedThresholds,
} from '@goldfinch/shared/budgetMath';
import type {
  BudgetItem,
  CategoryItem,
  IsoMonth,
  MinorUnits,
  TransactionItem,
} from '@goldfinch/shared/types';
import { userPk } from '@goldfinch/shared/keys';
import { SCHEMA_VERSION } from '@goldfinch/shared/constants';
import { sentNotifSk } from './keys.js';
import type { BudgetSpendEntry, SentNotifItem } from './types.js';

export interface ThresholdCrossing {
  categoryId: string;
  /** Category display name; falls back to the categoryId slug when unknown. */
  categoryName: string;
  /** The highest reached threshold -- the one to notify about. */
  threshold: number;
  /** Every threshold at or below pctUsed (all get dedup markers on success). */
  crossedThresholds: number[];
  /** Shared floor semantics; may exceed 100. */
  pctUsed: number;
  spentMinor: MinorUnits;
  limitMinor: MinorUnits;
}

/** The transaction fields the spend aggregation reads. */
export type SpendTxnRow = Pick<TransactionItem, 'categoryId' | 'amountMinor' | 'GSI2PK'>;

/**
 * Period-to-date spend per category as POSITIVE minor units. A row counts
 * exactly when it carries GSI2 keys (the sync writer's "categorized,
 * non-transfer expense" predicate) and its amount is negative (SimpleFIN
 * expense sign); spent = -(sum of amountMinor).
 */
export function spendByCategory(rows: readonly SpendTxnRow[]): BudgetSpendEntry[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.GSI2PK === undefined) continue;
    if (row.categoryId === null || row.categoryId === undefined) continue;
    if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor >= 0) continue;
    totals.set(row.categoryId, (totals.get(row.categoryId) ?? 0) - row.amountMinor);
  }
  return [...totals.entries()].map(([categoryId, spentMinor]) => ({ categoryId, spentMinor }));
}

export interface EvaluateBudgetThresholdsInput {
  spend: readonly BudgetSpendEntry[];
  budgets: readonly Pick<BudgetItem, 'categoryId' | 'limitMinor'>[];
  categories: readonly Pick<CategoryItem, 'categoryId' | 'name'>[];
  thresholds?: readonly number[];
}

/**
 * Joins spend entries to their budgets and returns one crossing per category
 * whose shared-percent reaches at least the lowest threshold. Categories
 * without a budget or with a non-positive limit are skipped (percentUsed
 * treats limit <= 0 as a caller bug); non-positive spend clamps to 0% inside
 * percentUsed and therefore never crosses.
 */
export function evaluateBudgetThresholds(
  input: EvaluateBudgetThresholdsInput,
): ThresholdCrossing[] {
  const thresholds = input.thresholds ?? BUDGET_ALERT_THRESHOLDS_PERCENT;
  if (thresholds.length === 0) return [];

  const limitByCategory = new Map<string, MinorUnits>();
  for (const budget of input.budgets) {
    limitByCategory.set(budget.categoryId, budget.limitMinor);
  }
  const nameByCategory = new Map<string, string>();
  for (const category of input.categories) {
    nameByCategory.set(category.categoryId, category.name);
  }

  const crossings: ThresholdCrossing[] = [];
  for (const entry of input.spend) {
    const limitMinor = limitByCategory.get(entry.categoryId);
    if (limitMinor === undefined || limitMinor <= 0) continue;
    if (!Number.isSafeInteger(entry.spentMinor)) continue;

    const crossedThresholds = reachedThresholds(entry.spentMinor, limitMinor, thresholds);
    const highest = crossedThresholds[crossedThresholds.length - 1];
    if (highest === undefined) continue;

    crossings.push({
      categoryId: entry.categoryId,
      categoryName: nameByCategory.get(entry.categoryId) ?? entry.categoryId,
      threshold: highest,
      crossedThresholds,
      pctUsed: percentUsed(entry.spentMinor, limitMinor),
      spentMinor: entry.spentMinor,
      limitMinor,
    });
  }
  return crossings;
}

/**
 * TTL for a SENTNOTIF# marker: the start of the month AFTER the period's
 * following month (i.e. period + 2 months), epoch seconds. The marker survives
 * the whole period (the dedup window) plus a full month of slack, then DynamoDB
 * TTL clears it for free.
 */
export function sentNotifTtl(period: IsoMonth): number {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) {
    throw new RangeError(`expected yyyy-mm period, got "${period}"`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]); // 1-based
  return Math.floor(Date.UTC(year, month + 1, 1) / 1000);
}

/** Builds the dedup marker item for one (period, category, threshold) triple. */
export function buildSentNotifItem(
  period: IsoMonth,
  categoryId: string,
  threshold: number,
  now: Date,
  household: string,
): SentNotifItem {
  return {
    PK: userPk(household),
    SK: sentNotifSk(period, categoryId, threshold),
    entityType: 'SENT_NOTIF',
    schemaVersion: SCHEMA_VERSION,
    period,
    categoryId,
    threshold,
    sentAt: now.toISOString(),
    ttl: sentNotifTtl(period),
  };
}
