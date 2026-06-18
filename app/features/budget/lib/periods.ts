/**
 * Budget-period presentation helpers (P11-4) — the single source the envelope
 * view, the Week/Month/Year filter tabs, and the editor's period picker all
 * draw from, so the four spots that name a period can never disagree.
 *
 * The labels reuse the existing translated i18n keys 'Weekly' / 'Monthly' /
 * 'Yearly' (seeded from the prototype, also used by the recurring CadenceBadge)
 * — no new catalog entries, full Korean coverage. Order follows the canonical
 * BUDGET_PERIODS (Week / Month / Year).
 */
import { BUDGET_PERIODS, type BudgetPeriod } from '@goldfinch/shared/types';

import type { I18nKey } from '../../../src/i18n';

/** Default cadence for a newly created budget (P11-4: picker defaults to Month). */
export const DEFAULT_BUDGET_PERIOD: BudgetPeriod = 'monthly';

/** Canonical display order, Week / Month / Year (re-exported from the contract). */
export const BUDGET_PERIOD_ORDER: ReadonlyArray<BudgetPeriod> = BUDGET_PERIODS;

/**
 * Cadence -> translated label key (1:1, like the recurring CadenceBadge). Used
 * for the per-row period caption and the editor picker option labels.
 */
export const BUDGET_PERIOD_KEYS: Readonly<Record<BudgetPeriod, I18nKey>> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/**
 * Cadence -> the empty-state copy shown when the selected tab has no budgets.
 * Plain English literals (the empty-state copy in BudgetView is already raw
 * English, not t()-routed), so these stay consistent with their neighbour.
 */
export const BUDGET_PERIOD_EMPTY: Readonly<Record<BudgetPeriod, string>> = {
  weekly: 'No weekly budgets yet',
  monthly: 'No monthly budgets yet',
  yearly: 'No yearly budgets yet',
};
