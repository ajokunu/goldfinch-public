/**
 * Pure spend-aggregation for the dashboard's This Week spending figure (P11-5).
 *
 * The monthly spending card stays on the server-aggregated `/reports/flow`
 * donut (complete, transfers excluded). There is no weekly flow route (P11
 * adds no routes), so the weekly figure is derived client-side from the
 * SAME periodWindow-scoped transactions slice the recent-activity card loads:
 * sum the expense legs (negative amounts) per currency, excluding transfers,
 * to mirror the flow donut's "spent" semantics.
 *
 * Money discipline (R16): integer math on `amountMinor` only; the sign carries
 * direction (expenses are negative on the wire) and we accumulate the absolute
 * expense magnitude. No floats, no decimal-string arithmetic.
 */
import type { CurrencyCode, MinorUnits, TransactionDto } from '@goldfinch/shared/types';

/** One currency's summed expense magnitude over the window. */
export interface CurrencySpend {
  currency: CurrencyCode;
  /** Total expense in minor units, as a positive magnitude. */
  expenseMinor: MinorUnits;
}

/**
 * Per-currency expense total over `transactions`, excluding transfers and any
 * non-expense (income / zero) legs. Currencies appear in first-seen order so
 * the single-currency household (the common case) yields one stable entry.
 */
export function windowExpenseByCurrency(
  transactions: readonly TransactionDto[],
): CurrencySpend[] {
  const totals = new Map<CurrencyCode, number>();
  const order: CurrencyCode[] = [];
  for (const txn of transactions) {
    // Pending rows are not yet posted spend; the server flow/cashflow drop them
    // (reports.ts / cashflow.ts), so the weekly donut must too — otherwise a
    // pending expense inflates This Week but not This Month.
    if (txn.pending) continue;
    // Transfers are not spending (flow excludes them); income is positive.
    if (txn.isTransfer || txn.amountMinor >= 0) continue;
    const magnitude = -txn.amountMinor;
    const prior = totals.get(txn.currency);
    if (prior === undefined) {
      order.push(txn.currency);
      totals.set(txn.currency, magnitude);
    } else {
      totals.set(txn.currency, prior + magnitude);
    }
  }
  return order.map((currency) => ({
    currency,
    expenseMinor: totals.get(currency) ?? 0,
  }));
}
