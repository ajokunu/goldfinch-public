/**
 * Entity item -> API DTO mapping. Money convention: every DTO money field is a
 * pair — exact decimal string plus integer minor units — produced via
 * @goldfinch/shared/money (never floats).
 */

import {
  effectiveAccountName,
  effectiveAccountType,
  effectiveInstitution,
  effectiveIsLiability,
} from '@goldfinch/shared/accountTypes';
import { percentUsed } from '@goldfinch/shared/budgetMath';
import {
  effectiveCostBasisMinor,
  holdingGainMinor,
  holdingPercentReturn,
} from '@goldfinch/shared/holdingBasis';
import { pricePerShareMinor } from '@goldfinch/shared/holdingReturn';
import { KEY_PREFIX, parseTxnSk } from '@goldfinch/shared/keys';
import {
  toCurrencyDecimalString,
  toDecimalString,
} from '@goldfinch/shared/money';
import type {
  AccountDto,
  AccountItem,
  AttachmentDto,
  AttachmentItem,
  BudgetDto,
  BudgetItem,
  BudgetPeriod,
  CategoryDto,
  CategoryItem,
  GoalContributionDto,
  GoalContributionItem,
  GoalDto,
  GoalItem,
  HoldingBasisItem,
  HoldingDto,
  HoldingItem,
  HoldingPricePointDto,
  HoldingPriceSnapshotItem,
  MinorUnits,
  NetWorthSnapshotDto,
  NetWorthSnapshotItem,
  PerCurrencyNetWorth,
  RecurringSeriesDto,
  RecurringSeriesItem,
  RuleDto,
  RuleItem,
  SummaryAccount,
  TransactionDto,
  TransactionItem,
} from '@goldfinch/shared/types';
import type { AttachmentContentType } from '@goldfinch/shared/constants';
import type { PeriodWindow } from '@goldfinch/shared/periodWindow';
import { logger } from './logger.js';

/** The account id is the ACCT# SK suffix (AccountItem carries no separate attr). */
export function accountIdFromSk(sk: string): string {
  return sk.slice(KEY_PREFIX.account.length);
}

export function toAccountDto(item: AccountItem): AccountDto {
  const dto: AccountDto = {
    accountId: accountIdFromSk(item.SK),
    // EFFECTIVE display name/institution via the shared helpers — the only
    // legal place the override-vs-synced precedence is computed. Never inline
    // `item.nameOverride ?? item.name` here. The raw synced values ride along
    // as `syncedName`/`syncedInstitution` for the "renamed from" subtitle.
    name: effectiveAccountName(item),
    syncedName: item.name,
    accountType: item.accountType,
    institution: effectiveInstitution(item),
    syncedInstitution: item.institution,
    balance: toCurrencyDecimalString(item.balanceMinor, item.currency),
    balanceMinor: item.balanceMinor,
    currency: item.currency,
    balanceDate: item.balanceDate,
    lastSyncedAt: item.lastSyncedAt,
    // P8-4: EFFECTIVE values via the shared helpers — the only legal place
    // the override-vs-synced precedence is computed. Never inline it here.
    accountTypeId: effectiveAccountType(item, logger),
    isLiability: effectiveIsLiability(item, logger),
  };
  // USER-OWNED overrides surfaced only when stored (edit-screen prefill /
  // "renamed" indicator), keeping un-overridden accounts at their prior shape.
  if (item.nameOverride !== undefined) {
    dto.nameOverride = item.nameOverride;
  }
  if (item.institutionOverride !== undefined) {
    dto.institutionOverride = item.institutionOverride;
  }
  if (item.availableBalanceMinor !== undefined) {
    dto.availableBalance = toCurrencyDecimalString(
      item.availableBalanceMinor,
      item.currency,
    );
    dto.availableBalanceMinor = item.availableBalanceMinor;
  }
  // P7-6/P7-3 additive fields; absent on pre-Phase-7 items means 'simplefin'
  // source and unknown holdings support.
  if (item.source !== undefined) {
    dto.source = item.source;
  }
  if (item.holdingsSupported !== undefined) {
    dto.holdingsSupported = item.holdingsSupported;
  }
  return dto;
}

export function toSummaryAccount(item: AccountItem): SummaryAccount {
  return {
    accountId: accountIdFromSk(item.SK),
    // EFFECTIVE name/institution; same shared helpers as toAccountDto, so a
    // renamed account shows its custom label everywhere (and the by-institution
    // grouping in /summary keys on the effective institution).
    name: effectiveAccountName(item),
    institution: effectiveInstitution(item),
    accountType: item.accountType,
    // P8-4 effective values; same shared helpers as toAccountDto.
    accountTypeId: effectiveAccountType(item, logger),
    balance: toCurrencyDecimalString(item.balanceMinor, item.currency),
    balanceMinor: item.balanceMinor,
    currency: item.currency,
    balanceDate: item.balanceDate,
    isLiability: effectiveIsLiability(item, logger),
  };
}

export function toTransactionDto(item: TransactionItem): TransactionDto {
  const { date, txnId } = parseTxnSk(item.SK);
  const dto: TransactionDto = {
    txnId,
    date,
    amount: toCurrencyDecimalString(item.amountMinor, item.currency),
    amountMinor: item.amountMinor,
    currency: item.currency,
    payee: item.payee ?? '',
    description: item.description,
    memo: item.memo,
    note: item.note,
    categoryId: item.categoryId ?? null,
    accountId: item.accountId,
    pending: item.pending ?? false,
    isTransfer: item.isTransfer ?? false,
    userCategorized: item.userCategorized ?? false,
    categorizedBy: item.categorizedBy ?? null,
    version: item.version ?? 0,
    // P7-9: "edited by" attribution in the transaction detail.
    lastEditedBy: item.lastEditedBy ?? null,
  };
  // P7-6 additive field; absent on pre-Phase-7 items means 'simplefin'.
  if (item.source !== undefined) {
    dto.source = item.source;
  }
  return dto;
}

/**
 * Budget money uses the household base currency, assumed 2 minor-unit digits in
 * v1 (BudgetItem stores no currency; matches the USD-base assumption in the plan).
 */
export function budgetMoney(minor: MinorUnits): string {
  return toDecimalString(minor, 2);
}

/**
 * The stored budget's period, defaulting absent to `'monthly'` (P11-1 back-compat
 * for the pre-Phase-11 budgets seeded with no period). This is the one place the
 * default is applied, so the DTO `period`, the spend window, and the period label
 * can never disagree on what an absent period means.
 */
export function budgetPeriod(item: BudgetItem): BudgetPeriod {
  return item.period ?? 'monthly';
}

/**
 * `spentMinor` is the GSI2 expense sum over `window`, which the caller computed
 * from `periodWindow(budgetPeriod(item))` (P11-3). The same window is echoed as
 * `periodFrom`/`periodTo` so the client labels "this week" / "June" / "2026"
 * without recomputing — the spend figure and its window are always one pair.
 *
 * `targetMinor` overrides the budget's per-period cap for the DTO's `limitMinor`
 * (budget-range feature, Decision 2). Default (per-cadence) mode omits it, so the
 * stored `item.limitMinor` flows through unchanged; range mode passes the prorated
 * target so the DTO carries "the target over this range" while the shape and
 * `remainingMinor = limitMinor - spentMinor` invariant are unchanged.
 */
export function toBudgetDto(
  item: BudgetItem,
  spentMinor: MinorUnits,
  window: PeriodWindow,
  categoryName?: string,
  targetMinor?: MinorUnits,
): BudgetDto {
  const limitMinor = targetMinor ?? item.limitMinor;
  const remainingMinor = limitMinor - spentMinor;
  return {
    categoryId: item.categoryId,
    categoryName,
    period: budgetPeriod(item),
    periodFrom: window.from,
    periodTo: window.to,
    limit: budgetMoney(limitMinor),
    limitMinor,
    rollover: item.rollover,
    spent: budgetMoney(spentMinor),
    spentMinor,
    remaining: budgetMoney(remainingMinor),
    remainingMinor,
    version: item.version,
  };
}

export function toCategoryDto(item: CategoryItem): CategoryDto {
  const dto: CategoryDto = {
    categoryId: item.categoryId,
    name: item.name,
    type: item.type,
    groupId: item.groupId ?? null,
    sortOrder: item.sortOrder,
    archived: item.archived,
  };
  // P10-1 additive, USER-OWNED. Only surfaced when stored, so pre-Phase-10
  // categories keep their original wire shape (absent => app auto behavior).
  if (item.iconKey !== undefined) {
    dto.iconKey = item.iconKey;
  }
  if (item.color !== undefined) {
    dto.color = item.color;
  }
  return dto;
}

// ---------------------------------------------------------------------------
// Phase 7 mappers (PHASE7-DECISIONS.md P7-1..P7-9)
// ---------------------------------------------------------------------------

export function toRecurringDto(item: RecurringSeriesItem): RecurringSeriesDto {
  return {
    seriesId: item.seriesId,
    payee: item.payee,
    cadence: item.cadence,
    avgAmount: toCurrencyDecimalString(item.avgAmountMinor, item.currency),
    avgAmountMinor: item.avgAmountMinor,
    currency: item.currency,
    lastDate: item.lastDate,
    nextExpectedDate: item.nextExpectedDate,
    accountId: item.accountId,
    status: item.status,
    occurrenceCount: item.occurrenceCount,
  };
}

/**
 * Goal progress is computed by the caller (linked-account balance or
 * contribution sum). percentComplete uses the shared percentUsed helper —
 * floor semantics, negative progress clamps to 0, may exceed 100. targetMinor
 * is validated > 0 at create/patch time, so percentUsed cannot throw here.
 */
export function toGoalDto(item: GoalItem, progressMinor: MinorUnits): GoalDto {
  return {
    goalId: item.goalId,
    name: item.name,
    target: toCurrencyDecimalString(item.targetMinor, item.currency),
    targetMinor: item.targetMinor,
    currency: item.currency,
    targetDate: item.targetDate ?? null,
    fundingMode: item.fundingMode,
    linkedAccountId: item.linkedAccountId ?? null,
    progress: toCurrencyDecimalString(progressMinor, item.currency),
    progressMinor,
    percentComplete: percentUsed(progressMinor, item.targetMinor),
    version: item.version,
    createdAt: item.createdAt,
  };
}

export function toGoalContributionDto(item: GoalContributionItem): GoalContributionDto {
  const dto: GoalContributionDto = {
    goalId: item.goalId,
    contributedAt: item.contributedAt,
    amount: toCurrencyDecimalString(item.amountMinor, item.currency),
    amountMinor: item.amountMinor,
    currency: item.currency,
    createdBy: item.createdBy,
  };
  if (item.note !== undefined) {
    dto.note = item.note;
  }
  return dto;
}

/**
 * Fractional-share scale for the BigInt current-price division. `shares` is a
 * DecimalString (e.g. "12.5"); parsed at this scale to an integer count so the
 * division `marketValueMinor / shares` stays exact (no float). 6 digits covers
 * any realistic fractional share count.
 */
/**
 * Map a HoldingItem to its DTO, joining the USER-OWNED manual cost basis
 * (`basis`, the HOLDING_BASIS item for this (accountId, symbol), or undefined).
 *
 * The caller (listAccountHoldings / setHoldingCostBasis) is responsible for the
 * SAME-CURRENCY guard: it must only pass a `basis` whose `currency` matches the
 * holding's, so `gain = marketValueMinor - costBasisMinor` is same-currency
 * (P7-7). The effective-basis precedence and the signed gain/percent math come
 * exclusively from the shared @goldfinch/shared/holdingBasis helpers — never
 * inline — so the API value and the client optimistic projection agree.
 */
export function toHoldingDto(item: HoldingItem, basis?: HoldingBasisItem): HoldingDto {
  const dto: HoldingDto = {
    holdingId: item.holdingId,
    accountId: item.accountId,
    description: item.description,
    shares: item.shares,
    marketValue: toCurrencyDecimalString(item.marketValueMinor, item.currency),
    marketValueMinor: item.marketValueMinor,
    currency: item.currency,
    asOf: item.asOf,
  };
  if (item.symbol !== undefined) {
    dto.symbol = item.symbol;
  }

  // Current price per share = marketValue / shares, from the single shared
  // helper — the SAME math the sync daily price snapshot uses, so the displayed
  // price and the charted history cannot drift. Omitted when shares is
  // non-numeric or <= 0, never a divide-by-zero or a misleading price (Part B).
  const currentPriceMinor = pricePerShareMinor(item.marketValueMinor, item.shares);
  if (currentPriceMinor !== undefined) {
    dto.currentPriceMinor = currentPriceMinor;
    dto.currentPrice = toCurrencyDecimalString(currentPriceMinor, item.currency);
  }

  // Effective cost basis (manual ?? feed-non-zero ?? undefined) + its source,
  // from the single shared helper. The DTO carries gain/percentReturn ONLY when
  // an effective basis exists (otherwise the client renders the em-dash).
  const effective = effectiveCostBasisMinor(
    {
      manualCostBasisMinor: basis?.costBasisMinor,
      feedCostBasisMinor: item.costBasisMinor,
    },
    logger,
  );
  if (effective !== undefined) {
    dto.costBasis = toCurrencyDecimalString(effective.costBasisMinor, item.currency);
    dto.costBasisMinor = effective.costBasisMinor;
    dto.costBasisSource = effective.source;

    const gainMinor = holdingGainMinor(item.marketValueMinor, effective.costBasisMinor);
    dto.gainMinor = gainMinor;
    dto.gain = toCurrencyDecimalString(gainMinor, item.currency);
    const percentReturn = holdingPercentReturn(gainMinor, effective.costBasisMinor);
    if (percentReturn !== undefined) {
      dto.percentReturn = percentReturn;
    }
  }

  return dto;
}

/**
 * Per P7-7 the top-level totals are the base-currency slice; perCurrency is
 * rendered as an array (one entry per currency, base included), sorted by
 * currency code for a stable wire order.
 */
export function toNetWorthSnapshotDto(item: NetWorthSnapshotItem): NetWorthSnapshotDto {
  const perCurrency: PerCurrencyNetWorth[] = Object.entries(item.perCurrency)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, slice]) => ({
      currency,
      assets: toCurrencyDecimalString(slice.assetsMinor, currency),
      assetsMinor: slice.assetsMinor,
      liabilities: toCurrencyDecimalString(slice.liabilitiesMinor, currency),
      liabilitiesMinor: slice.liabilitiesMinor,
      net: toCurrencyDecimalString(slice.netMinor, currency),
      netMinor: slice.netMinor,
    }));
  return {
    date: item.date,
    currency: item.currency,
    assets: toCurrencyDecimalString(item.assetsMinor, item.currency),
    assetsMinor: item.assetsMinor,
    liabilities: toCurrencyDecimalString(item.liabilitiesMinor, item.currency),
    liabilitiesMinor: item.liabilitiesMinor,
    net: toCurrencyDecimalString(item.netMinor, item.currency),
    netMinor: item.netMinor,
    perCurrency,
  };
}

/**
 * Map a daily price snapshot to its DTO (money pair). The server returns the
 * RAW price series; the client normalizes it to a % return via the single
 * shared holdingReturn helper, so no normalization happens here.
 */
export function toHoldingPricePointDto(item: HoldingPriceSnapshotItem): HoldingPricePointDto {
  return {
    date: item.date,
    pricePerShare: toCurrencyDecimalString(item.pricePerShareMinor, item.currency),
    pricePerShareMinor: item.pricePerShareMinor,
  };
}

/**
 * Rule amount bounds are stored in minor units; like budgets they use the
 * household base-currency scale (2 digits) for the decimal rendering.
 */
export function toRuleDto(item: RuleItem): RuleDto {
  const dto: RuleDto = {
    ruleId: item.ruleId,
    matchType: item.matchType,
    pattern: item.pattern,
    categoryId: item.categoryId,
    priority: item.priority,
    enabled: item.enabled,
    version: item.version,
  };
  if (item.amountMinMinor !== undefined && item.amountMinMinor !== null) {
    dto.amountMin = budgetMoney(item.amountMinMinor);
    dto.amountMinMinor = item.amountMinMinor;
  }
  if (item.amountMaxMinor !== undefined && item.amountMaxMinor !== null) {
    dto.amountMax = budgetMoney(item.amountMaxMinor);
    dto.amountMaxMinor = item.amountMaxMinor;
  }
  // Only surfaced when stored, keeping pre-transfer-rule DTOs at their original
  // wire shape (absent => not a transfer-marking rule).
  if (item.markTransfer !== undefined) {
    dto.markTransfer = item.markTransfer;
  }
  return dto;
}

export function toAttachmentDto(item: AttachmentItem): AttachmentDto {
  return {
    attachId: item.attachId,
    txnId: item.txnId,
    fileName: item.fileName,
    contentType: item.contentType as AttachmentContentType,
    sizeBytes: item.sizeBytes,
    status: item.status,
    uploadedBy: item.uploadedBy,
    createdAt: item.createdAt,
  };
}
