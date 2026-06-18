/**
 * Per-currency goal totals for the total-saved hero card (design-spec
 * screens.md 5.2). P7-7 money discipline: integer minor-unit sums grouped
 * strictly per currency -- never a synthetic mixed-currency total. The hero
 * renders one combined number only when every goal shares one currency;
 * otherwise one compact line per currency.
 *
 * Pure and platform-neutral (no react-native imports): exercised directly by
 * node --test in test/totals.test.ts.
 */
import type { CurrencyCode, MinorUnits } from '@goldfinch/shared/types';

export interface GoalTotalsInput {
  currency: CurrencyCode;
  progressMinor: MinorUnits;
  targetMinor: MinorUnits;
}

export interface GoalCurrencyTotal {
  currency: CurrencyCode;
  savedMinor: MinorUnits;
  targetMinor: MinorUnits;
}

/** Integer per-currency {saved, target} sums, sorted by currency code. */
export function goalTotalsByCurrency(
  goals: readonly GoalTotalsInput[],
): GoalCurrencyTotal[] {
  const byCurrency = new Map<
    CurrencyCode,
    { savedMinor: number; targetMinor: number }
  >();
  for (const goal of goals) {
    const entry = byCurrency.get(goal.currency) ?? {
      savedMinor: 0,
      targetMinor: 0,
    };
    entry.savedMinor += goal.progressMinor;
    entry.targetMinor += goal.targetMinor;
    byCurrency.set(goal.currency, entry);
  }
  // Sort the (unique) currency codes with the default lexicographic string
  // sort instead of a hand-written comparator: Map keys are unique, so a
  // comparator's equality branch would be unreachable dead code.
  return [...byCurrency.keys()].sort().map((currency) => {
    // The key set comes from the map itself, so the lookup cannot miss.
    const entry = byCurrency.get(currency)!;
    return {
      currency,
      savedMinor: entry.savedMinor,
      targetMinor: entry.targetMinor,
    };
  });
}
