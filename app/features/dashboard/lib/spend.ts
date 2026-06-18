/**
 * Pure spend-aggregation for the dashboard's This Week spending donut (P11-5).
 *
 * The monthly spending card uses the server-aggregated `/reports/flow` donut
 * (complete, transfers excluded). There is no weekly flow route (P11 adds no
 * routes), so the weekly donut is derived client-side from the SAME
 * periodWindow('weekly')-scoped transactions slice and shaped into the exact
 * `/reports/flow` per-currency / per-category structure, so both scopes render
 * through one donut component and can never visually drift.
 *
 * Money discipline (R16): integer math on `amountMinor` only; the sign carries
 * direction (expenses are negative on the wire) and we accumulate the absolute
 * expense magnitude. No floats, no decimal-string arithmetic.
 */
import type {
  CategoryType,
  CurrencyCode,
  FlowCategoryDto,
  FlowCurrencyGroupDto,
  TransactionDto,
} from '@goldfinch/shared/types';

/** Display name "Uncategorized" for the null bucket (matches /reports/flow). */
const UNCATEGORIZED_NAME = 'Uncategorized';

/**
 * Per-currency, per-category expense flow over `transactions`, shaped EXACTLY
 * like the server's `/reports/flow` `perCurrency` array so the dashboard's
 * GroupDonut / flowGroupHasContent can consume it unchanged. There is no weekly
 * flow route (P11 adds none), so the This Week donut is derived client-side
 * from the periodWindow('weekly')-scoped transactions slice.
 *
 * Only non-transfer expense legs (negative amounts) contribute, mirroring the
 * flow donut's "spent" semantics (transfers excluded, income dropped). Within a
 * currency, legs are bucketed by `categoryId` (null = the uncategorized bucket,
 * which takes the palette's "other" slot downstream) and summed as positive
 * magnitudes. Categories are sorted by `amountMinor` descending so the donut and
 * its top-N legend match the server contract.
 *
 * `categoryNameFor` resolves a categoryId to its display name (the
 * TransactionDto carries no name); when it returns undefined (archived/missing)
 * the categoryId itself is the fallback label so the donut never crashes.
 *
 * `categoryTypeFor` resolves a categoryId to its CategoryType (the
 * TransactionDto carries no type). It exists so this client donut excludes the
 * SAME rows the server's /reports/flow + /cashflow do: a transfer is dropped on
 * EITHER signal — `isTransfer===true` OR a TRANSFER-typed category — so a
 * credit-card payment filed under a TRANSFER category (but with isTransfer
 * still false) can never leak into weekly spend. Returns undefined for an
 * archived/missing id, which is treated as "not a transfer" (such a row, being
 * a negative non-transfer expense, then counts normally — matching the server).
 *
 * Money discipline (R16): integer math on `amountMinor` only. The decimal-string
 * fields (`amount`/`income`/`expense`/`net`) are not read by GroupDonut and are
 * emitted as empty strings; do NOT do money math on them.
 */
export function windowFlowByCurrency(
  transactions: readonly TransactionDto[],
  categoryNameFor: (categoryId: string) => string | undefined,
  categoryTypeFor: (categoryId: string) => CategoryType | undefined,
): FlowCurrencyGroupDto[] {
  // currency -> (categoryId|null -> magnitude), preserving category first-seen
  // order within a currency for a stable sort tie-break.
  const byCurrency = new Map<
    CurrencyCode,
    { totals: Map<string | null, number>; order: (string | null)[] }
  >();
  const currencyOrder: CurrencyCode[] = [];

  for (const txn of transactions) {
    // Transfers are not spending (flow excludes them); income is positive.
    if (txn.isTransfer || txn.amountMinor >= 0) continue;
    // Mirror the server: a TRANSFER-typed category is also excluded, even when
    // the per-row isTransfer flag was never set (the credit-card-payoff case).
    if (txn.categoryId !== null && categoryTypeFor(txn.categoryId) === 'TRANSFER') {
      continue;
    }
    const magnitude = -txn.amountMinor;
    let bucket = byCurrency.get(txn.currency);
    if (bucket === undefined) {
      bucket = { totals: new Map(), order: [] };
      byCurrency.set(txn.currency, bucket);
      currencyOrder.push(txn.currency);
    }
    const prior = bucket.totals.get(txn.categoryId);
    if (prior === undefined) {
      bucket.order.push(txn.categoryId);
      bucket.totals.set(txn.categoryId, magnitude);
    } else {
      bucket.totals.set(txn.categoryId, prior + magnitude);
    }
  }

  return currencyOrder.map((currency) => {
    const bucket = byCurrency.get(currency);
    const totals = bucket?.totals ?? new Map<string | null, number>();
    const order = bucket?.order ?? [];
    const categories: FlowCategoryDto[] = order
      .map((categoryId): FlowCategoryDto => {
        const amountMinor = totals.get(categoryId) ?? 0;
        const categoryName =
          categoryId === null
            ? UNCATEGORIZED_NAME
            : (categoryNameFor(categoryId) ?? categoryId);
        return { categoryId, categoryName, amount: '', amountMinor };
      })
      .sort((a, b) => b.amountMinor - a.amountMinor);
    let expenseMinor = 0;
    for (const category of categories) expenseMinor += category.amountMinor;
    return {
      currency,
      income: '',
      incomeMinor: 0,
      expense: '',
      expenseMinor,
      net: '',
      netMinor: 0,
      categories,
    };
  });
}
