/**
 * Monthly cashflow rollups for the summary narrative.
 *
 * All aggregation happens here in integer minor units (never floats); decimal
 * strings are produced only at the prompt boundary via @goldfinch/shared/money.
 * The LLM only PHRASES the narrative -- every number it sees is pre-computed.
 *
 * The generated INSIGHT#SUMMARY#<yyyy-mm> item carries an inputDigest (sha256
 * of the canonicalized rollups) so re-runs over unchanged data are idempotent
 * and cost zero Bedrock tokens.
 */

import { createHash } from 'node:crypto';

import type { UserPk } from '@goldfinch/shared/keys';
import { userPk } from '@goldfinch/shared/keys';
import { toCurrencyDecimalString } from '@goldfinch/shared/money';
import type {
  CurrencyCode,
  IsoDate,
  IsoMonth,
  IsoTimestamp,
  MinorUnits,
  TransactionItem,
} from '@goldfinch/shared/types';

import type { CategoryDescriptor, TokenUsage } from './bedrock.js';

const ISO_MONTH_PATTERN = /^\d{4}-\d{2}$/;

export class SummaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SummaryError';
  }
}

export function assertIsoMonth(value: string): asserts value is IsoMonth {
  if (!ISO_MONTH_PATTERN.test(value)) {
    throw new SummaryError(`expected yyyy-mm month, got "${value}"`);
  }
}

/** The month a yyyy-mm-dd date belongs to. */
export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7);
}

/** Shift a yyyy-mm month by delta months (delta may be negative). */
export function addMonths(month: IsoMonth, delta: number): IsoMonth {
  assertIsoMonth(month);
  const year = Number.parseInt(month.slice(0, 4), 10);
  const monthIndex = Number.parseInt(month.slice(5, 7), 10) - 1 + delta;
  const shifted = new Date(Date.UTC(year, monthIndex, 1));
  const y = shifted.getUTCFullYear().toString().padStart(4, '0');
  const m = (shifted.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

export function previousMonth(month: IsoMonth): IsoMonth {
  return addMonths(month, -1);
}

/** Inclusive first/last calendar day of a month. */
export function monthRange(month: IsoMonth): { from: IsoDate; to: IsoDate } {
  assertIsoMonth(month);
  const year = Number.parseInt(month.slice(0, 4), 10);
  const monthNumber = Number.parseInt(month.slice(5, 7), 10);
  // Day 0 of the next month == last day of this month.
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${lastDay.toString().padStart(2, '0')}`,
  };
}

export interface MonthRollups {
  month: IsoMonth;
  /** Sum of positive non-transfer amounts (income), minor units. */
  incomeMinor: MinorUnits;
  /** Sum of spending as a positive number, minor units. */
  expenseMinor: MinorUnits;
  /** Spending per categoryId (positive minor units). */
  byCategoryMinor: Record<string, MinorUnits>;
  /** Spending that no category claims (still part of expenseMinor). */
  uncategorizedExpenseMinor: MinorUnits;
  /** Transactions included after the pending/transfer filters. */
  txnCount: number;
}

/**
 * Aggregate one month of transactions. Pending transactions are excluded
 * (their amounts and dates can still shift) and transfers never count as
 * income or spend. SimpleFIN sign convention: expense negative.
 */
export function computeMonthRollups(
  month: IsoMonth,
  txns: readonly TransactionItem[],
  categoriesById: ReadonlyMap<string, CategoryDescriptor>,
): MonthRollups {
  assertIsoMonth(month);
  const rollups: MonthRollups = {
    month,
    incomeMinor: 0,
    expenseMinor: 0,
    byCategoryMinor: {},
    uncategorizedExpenseMinor: 0,
    txnCount: 0,
  };
  for (const txn of txns) {
    if (txn.pending || txn.isTransfer) {
      continue;
    }
    const category =
      txn.categoryId !== null ? categoriesById.get(txn.categoryId) : undefined;
    if (category?.type === 'TRANSFER') {
      continue;
    }
    rollups.txnCount += 1;
    const amount = txn.amountMinor;
    if (amount >= 0) {
      rollups.incomeMinor += amount;
      continue;
    }
    const spend = -amount;
    rollups.expenseMinor += spend;
    if (category !== undefined && category.type === 'EXPENSE') {
      rollups.byCategoryMinor[category.categoryId] =
        (rollups.byCategoryMinor[category.categoryId] ?? 0) + spend;
    } else {
      rollups.uncategorizedExpenseMinor += spend;
    }
  }
  return rollups;
}

export interface TrailingAverages {
  /** Months that actually contributed data. */
  monthsUsed: number;
  avgIncomeMinor: MinorUnits;
  avgExpenseMinor: MinorUnits;
  avgByCategoryMinor: Record<string, MinorUnits>;
}

/** Average a set of monthly rollups (integer division, rounded). */
export function averageRollups(months: readonly MonthRollups[]): TrailingAverages {
  const used = months.filter((m) => m.txnCount > 0);
  const n = used.length;
  if (n === 0) {
    return {
      monthsUsed: 0,
      avgIncomeMinor: 0,
      avgExpenseMinor: 0,
      avgByCategoryMinor: {},
    };
  }
  const categoryTotals = new Map<string, number>();
  let incomeTotal = 0;
  let expenseTotal = 0;
  for (const m of used) {
    incomeTotal += m.incomeMinor;
    expenseTotal += m.expenseMinor;
    for (const [categoryId, minor] of Object.entries(m.byCategoryMinor)) {
      categoryTotals.set(categoryId, (categoryTotals.get(categoryId) ?? 0) + minor);
    }
  }
  const avgByCategoryMinor: Record<string, MinorUnits> = {};
  for (const [categoryId, total] of categoryTotals) {
    avgByCategoryMinor[categoryId] = Math.round(total / n);
  }
  return {
    monthsUsed: n,
    avgIncomeMinor: Math.round(incomeTotal / n),
    avgExpenseMinor: Math.round(expenseTotal / n),
    avgByCategoryMinor,
  };
}

function decimal(minor: MinorUnits, currency: CurrencyCode): string {
  return toCurrencyDecimalString(minor, currency);
}

/**
 * Render the rollups into the volatile user prompt. Category names come from
 * the taxonomy so the narrative can say "Dining" instead of "dining-out".
 */
export function buildSummaryUserPrompt(
  current: MonthRollups,
  trailing: TrailingAverages,
  categoriesById: ReadonlyMap<string, CategoryDescriptor>,
  currency: CurrencyCode,
): string {
  const categoryName = (id: string): string => categoriesById.get(id)?.name ?? id;
  const byCategory: Record<string, string> = {};
  for (const [id, minor] of Object.entries(current.byCategoryMinor).sort(
    (a, b) => b[1] - a[1],
  )) {
    byCategory[categoryName(id)] = decimal(minor, currency);
  }
  const trailingByCategory: Record<string, string> = {};
  for (const [id, minor] of Object.entries(trailing.avgByCategoryMinor).sort(
    (a, b) => b[1] - a[1],
  )) {
    trailingByCategory[categoryName(id)] = decimal(minor, currency);
  }
  return JSON.stringify({
    month: current.month,
    currency,
    income: decimal(current.incomeMinor, currency),
    totalSpending: decimal(current.expenseMinor, currency),
    spendingByCategory: byCategory,
    uncategorizedSpending: decimal(current.uncategorizedExpenseMinor, currency),
    trailing3MonthAverage: {
      monthsWithData: trailing.monthsUsed,
      income: decimal(trailing.avgIncomeMinor, currency),
      totalSpending: decimal(trailing.avgExpenseMinor, currency),
      spendingByCategory: trailingByCategory,
    },
  });
}

/** Deterministic JSON rendering (sorted object keys, recursively). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** sha256 hex digest of the canonicalized payload (idempotency key). */
export function computeInputDigest(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

export type InsightSummarySk = `INSIGHT#SUMMARY#${string}`;

export const INSIGHT_SUMMARY_SK_PREFIX = 'INSIGHT#SUMMARY#';

export function insightSummarySk(month: IsoMonth): InsightSummarySk {
  assertIsoMonth(month);
  return `INSIGHT#SUMMARY#${month}`;
}

/**
 * The stored monthly summary. Not part of the @goldfinch/shared entity union
 * yet (this service owns the type).
 */
export interface InsightSummaryItem {
  PK: UserPk;
  SK: InsightSummarySk;
  entityType: 'INSIGHT_SUMMARY';
  schemaVersion: number;
  month: IsoMonth;
  narrative: string;
  generatedAt: IsoTimestamp;
  /** Inference-profile ID used to phrase the narrative. */
  model: string;
  /** sha256 of the rollups fed in; equal digest means skip regeneration. */
  inputDigest: string;
  /** Token spend for observability (mirrors the EMF metrics). */
  usage?: TokenUsage;
}

export function buildInsightSummaryItem(
  household: string,
  month: IsoMonth,
  narrative: string,
  model: string,
  inputDigest: string,
  now: IsoTimestamp,
  usage?: TokenUsage,
  schemaVersion = 1,
): InsightSummaryItem {
  return {
    PK: userPk(household),
    SK: insightSummarySk(month),
    entityType: 'INSIGHT_SUMMARY',
    schemaVersion,
    month,
    narrative,
    generatedAt: now,
    model,
    inputDigest,
    ...(usage !== undefined ? { usage } : {}),
  };
}
