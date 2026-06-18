/**
 * Home-screen widget — weekly-spend snapshot contract (v1) + its pure builder
 * (ops/WIDGET-PLAN.md tasks 1-2).
 *
 * The app computes weekly spend and writes this small JSON to a shared
 * container; the (native) iOS/Android widget only reads + renders it. This file
 * is the JS/CI-testable layer: the snapshot TYPE (the single source both native
 * sides re-declare as Swift Codable / Kotlin data class) and the pure
 * `buildWeeklySpendWidgetSnapshot(...)` that synthesizes it from
 * already-fetched dashboard/budget data.
 *
 * Single-source discipline: NO new weekly-spend math lives here. The weekly
 * window is `periodWindow('weekly')`; the spend total + per-category breakdown
 * are `windowFlowByCurrency` (the exact dashboard This-Week shaping); the
 * percent-of-budget is the BigInt truncate-toward-zero idiom shared with
 * `budgetMath.percentUsed` / `holdingBasis.percentReturn`; the minor->decimal
 * rendering is `toCurrencyDecimalString`; the per-category color is
 * `categoryColor`. This builder only selects, filters, and shapes those.
 *
 * Money discipline (R16): integer math on minor units only; percent via BigInt;
 * decimal strings are lossless renderings, never inputs to arithmetic.
 */
import { periodWindow } from '@goldfinch/shared/periodWindow';
import { toCurrencyDecimalString } from '@goldfinch/shared/money';
import type {
  BudgetDto,
  CategoryType,
  CurrencyCode,
  DecimalString,
  FlowCurrencyGroupDto,
  IsoDate,
  IsoTimestamp,
  TransactionDto,
} from '@goldfinch/shared/types';

import { windowFlowByCurrency } from '../dashboard/lib/spend';
import { categoryColor } from '../../src/ui/charts/categoryColor';

/**
 * Widget snapshot contract (v1) — the single source both iOS (SwiftUI Codable)
 * and Android (Kotlin data class) re-declare. Exact JSON the app writes to the
 * shared container and the native widget reads. `schemaVersion` gates graceful
 * degradation if the installed widget is older/newer than the app that wrote it.
 */
export interface WeeklySpendWidgetSnapshot {
  schemaVersion: 1;
  /** UTC ISO-8601 instant the snapshot was built (`Date#toISOString`). */
  generatedAt: IsoTimestamp;
  /**
   * Weekly window bounds, MONDAY (`weekStart`) through SUNDAY (`weekEnd`), both
   * inclusive, yyyy-mm-dd, in America/New_York (DEFAULT_TZ). Computed via
   * `periodWindow('weekly')` — never hand-derived. The range is ALWAYS 7 days,
   * Mon..Sun (ISO convention), and spans no DST seam (proleptic-UTC day math).
   * Native widgets must NOT hard-code "Sun-Sat"; the actual window is Mon..Sun.
   * (The plan doc's "US Sun-Sat" label is inaccurate historical text.)
   */
  weekStart: IsoDate;
  weekEnd: IsoDate;
  /**
   * Primary display currency: the currency of the FIRST `windowFlowByCurrency`
   * group with spend (its first-seen-in-the-window currency). 'USD' when the
   * week has no spend. Single-currency is the overwhelming case; a rare
   * multi-currency week shows only the primary group on the widget.
   */
  currency: CurrencyCode;
  /**
   * Persisted setting ("Show amounts on widget", default ON). Stored verbatim
   * here; this builder gates NOTHING on it — the native widget reads this flag
   * and renders an amount-less indicator when false. Separate from the
   * per-session privacy-mode eye.
   */
  showAmounts: boolean;
  /**
   * Weekly spend total — non-transfer expense magnitude over the primary
   * currency group — in minor units (integer) + its exact decimal string. Both
   * are lossless renderings of the same value. 0 / "0.00" when no spend.
   */
  spentMinor: number;
  spent: DecimalString;
  /**
   * Weekly budget total if any `period === 'weekly'` budget exists in the
   * current /budgets period, else null. Non-null: the summed `limitMinor` of
   * those budgets (minor units) + its exact decimal string. When no weekly
   * budget exists, this and `percentOfBudget` are both null.
   */
  budgetMinor: number | null;
  budget: DecimalString | null;
  /**
   * Percent of weekly budget (integer, >= 0, MAY exceed 100), null when no
   * weekly budget. BigInt truncation toward zero: `(spentMinor * 100n) /
   * budgetMinor`, then `Number()` — never Math.round or float division.
   * Mirrors `budgetMath.percentUsed` / `holdingBasis.percentReturn`. A net
   * refund (negative spend) clamps to 0%.
   */
  percentOfBudget: number | null;
  /**
   * Top 3 spending categories by magnitude (descending), for the medium widget
   * layout; saturates at 3. The null (uncategorized) bucket IS eligible and is
   * carried with id/iconKey `""` (the sentinel native maps to its uncategorized
   * default glyph, mirroring `resolveCategoryIcon(null)` -> CircleDashed). Rows
   * tie to `spentMinor` (same source as the dashboard legend).
   */
  topCategories: WidgetTopCategory[];
}

/** One top-spend category row in the snapshot (<= 3 per snapshot). */
export interface WidgetTopCategory {
  /** Category slug id, or `""` for the uncategorized bucket. */
  categoryId: string;
  /** Display name; "Uncategorized" for the null bucket (from windowFlowByCurrency). */
  name: string;
  /**
   * Icon key for native resolution: the categoryId slug itself (matches
   * CATEGORY_ICONS keys), or `""` for the uncategorized bucket. Native maps
   * `""` (or any miss) to its uncategorized default, as the app does.
   */
  iconKey: string;
  /**
   * Deterministic presentation-only hex color, baked from the FIXED palette
   * argument via `categoryColor(categoryId, palette)`. The sandboxed widget
   * cannot read the live 4-direction theme, so a compile-time palette is used.
   * NOTE: the uncategorized row is hashed through the SAME `categoryColor` path
   * (keyed on its `""` id) — it does NOT get the dashboard's grey `categoryOther`
   * slot, because this builder is handed only `palette` (a documented, intended
   * divergence from the dashboard donut's null-bucket color).
   */
  color: string;
  /** Spend magnitude in minor units (integer, positive). */
  spentMinor: number;
  /** Spend as exact decimal string (lossless rendering of spentMinor). */
  spent: DecimalString;
}

/** Current schema version the app writes. */
export const WIDGET_SNAPSHOT_SCHEMA_VERSION = 1 as const;

/** Sentinel id/iconKey for the uncategorized bucket (native -> default glyph). */
const UNCATEGORIZED_KEY = '';

/** Max category rows in a snapshot (medium widget layout). */
const TOP_CATEGORY_LIMIT = 3;

/**
 * Pure builder: synthesizes the weekly-spend snapshot from already-fetched
 * dashboard/budget data. No I/O, no side effects; safe to call after every
 * sync/refetch to refresh the widget's shared-container JSON.
 *
 * Reuses (no re-derivation):
 *  - `periodWindow('weekly', now)` for the Mon..Sun bounds;
 *  - `windowFlowByCurrency(...)` for the spend total + sorted category breakdown
 *    (the exact dashboard This-Week shaping: transfers excluded on either
 *    `isTransfer` or a TRANSFER-typed category);
 *  - the BigInt truncate-toward-zero percent idiom;
 *  - `toCurrencyDecimalString` for every decimal-string field;
 *  - `categoryColor(id, palette)` for the per-row color.
 *
 * Currency selection: the first `windowFlowByCurrency` group (its first-seen
 * currency in the window); 'USD' with a zero total when the week has no spend.
 *
 * @param args.transactions weekly-window transactions (useWindowTransactions('weekly').data.items)
 * @param args.categoryNameFor id -> display name (WeekSpendingCard's categories lookup)
 * @param args.categoryTypeFor id -> CategoryType (same lookup; excludes TRANSFER-typed spend)
 * @param args.budgets GET /budgets items (current period); builder filters to period==='weekly'
 * @param args.showAmountsOnWidget persisted setting, stored verbatim on the snapshot
 * @param args.palette fixed compile-time category-color palette
 * @param args.now instant for the window + timestamp (default `new Date()`)
 * @returns the v1 snapshot. Throws only via the reused primitives' own
 *   assertions (`periodWindow` on a bad Date/tz, `toCurrencyDecimalString` on a
 *   non-integer minor amount).
 */
export function buildWeeklySpendWidgetSnapshot(args: {
  transactions: readonly TransactionDto[];
  categoryNameFor: (categoryId: string) => string | undefined;
  categoryTypeFor: (categoryId: string) => CategoryType | undefined;
  budgets: readonly BudgetDto[];
  showAmountsOnWidget: boolean;
  palette: readonly string[];
  now?: Date;
}): WeeklySpendWidgetSnapshot {
  const {
    transactions,
    categoryNameFor,
    categoryTypeFor,
    budgets,
    showAmountsOnWidget,
    palette,
    now = new Date(),
  } = args;

  // Window: Mon..Sun, single-sourced. periodWindow validates `now`.
  const window = periodWindow('weekly', now);

  // Spend + per-category breakdown: the exact dashboard This-Week shaping.
  // Groups preserve first-seen-currency order; the first with spend is primary.
  const groups: FlowCurrencyGroupDto[] = windowFlowByCurrency(
    transactions,
    categoryNameFor,
    categoryTypeFor,
  );
  const primary = groups.find((group) => group.expenseMinor > 0) ?? groups[0];

  const currency: CurrencyCode = primary?.currency ?? 'USD';
  const spentMinor = primary?.expenseMinor ?? 0;

  // Top 3 categories (windowFlowByCurrency already sorted desc, transfers out).
  const topCategories: WidgetTopCategory[] = (primary?.categories ?? [])
    .filter((category) => category.amountMinor > 0)
    .slice(0, TOP_CATEGORY_LIMIT)
    .map((category) => {
      // The flow's null bucket is uncategorized: id/iconKey become the sentinel
      // so native falls through to its uncategorized default glyph.
      const key = category.categoryId ?? UNCATEGORIZED_KEY;
      return {
        categoryId: key,
        name: category.categoryName,
        iconKey: key,
        color: categoryColor(key, palette),
        spentMinor: category.amountMinor,
        spent: toCurrencyDecimalString(category.amountMinor, currency),
      };
    });

  // Weekly budget total: sum limitMinor over period==='weekly' budgets, else
  // null. Length gate (not `sum || null`) so a degenerate 0-sum of real weekly
  // budgets does not masquerade as "no weekly budget".
  const weeklyBudgets = budgets.filter((budget) => budget.period === 'weekly');
  const budgetMinor =
    weeklyBudgets.length > 0
      ? weeklyBudgets.reduce((sum, budget) => sum + budget.limitMinor, 0)
      : null;

  // Percent: BigInt truncate toward zero; null when no budget; refunds clamp 0.
  let percentOfBudget: number | null;
  if (budgetMinor !== null && budgetMinor > 0) {
    const clampedSpent = spentMinor > 0 ? spentMinor : 0;
    percentOfBudget = Number((BigInt(clampedSpent) * 100n) / BigInt(budgetMinor));
  } else {
    percentOfBudget = null;
  }

  return {
    schemaVersion: WIDGET_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    weekStart: window.from,
    weekEnd: window.to,
    currency,
    showAmounts: showAmountsOnWidget,
    spentMinor,
    spent: toCurrencyDecimalString(spentMinor, currency),
    budgetMinor,
    budget: budgetMinor !== null ? toCurrencyDecimalString(budgetMinor, currency) : null,
    percentOfBudget,
    topCategories,
  };
}
