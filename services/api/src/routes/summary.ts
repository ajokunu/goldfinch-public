/**
 * GET /summary (alias: GET /networth) — server-computed net worth from one
 * accounts Query (master plan sections 8 and 13). v1 is a single number plus
 * as-of date; trend snapshots are deferred to v1.1 (resolved decision D5).
 *
 * Sign conventions:
 * - Asset accounts contribute their signed balance as stored.
 * - Liability accounts (credit/loan) ALWAYS contribute -abs(balance), even when
 *   the institution reports the amount owed as a positive number (section 13:
 *   "liability groups show totals as negative contributions").
 * - liabilitiesTotal is the positive magnitude owed; netWorth = assets - liabilities.
 *
 * Multi-currency (P7-7): there is NO FX conversion in v1, so every total in
 * this response (top-level and per group) sums ONLY accounts in the household
 * base currency (`currency` on the response) — never a synthetic
 * mixed-currency number. Accounts in other currencies are still listed (each
 * SummaryAccount carries its own currency); their per-currency aggregates
 * live in GET /networth/history's perCurrency slices.
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_IDS,
  effectiveAccountType,
  effectiveIsLiability,
  toLegacyAccountType,
} from '@goldfinch/shared/accountTypes';
import type { AccountTypeId } from '@goldfinch/shared/accountTypes';
import { addMinor, negateMinor, toCurrencyDecimalString } from '@goldfinch/shared/money';
import type {
  AccountItem,
  SummaryInstitutionGroup,
  SummaryResponse,
  SummaryTypeGroup,
} from '@goldfinch/shared/types';
import { getIdentity } from '../context.js';
import { getEnv } from '../env.js';
import { json } from '../http.js';
import { logger } from '../logger.js';
import { toSummaryAccount } from '../mapping.js';
import { listHouseholdAccounts } from './accounts.js';

/**
 * P8-4 byType presentation order: asset-type groups first, then liability
 * groups, each in the locked ACCOUNT_TYPE_IDS order. Derived from the shared
 * metadata (never a hand list) so a new type id can never be silently dropped
 * from the summary.
 */
const TYPE_ORDER: readonly AccountTypeId[] = [
  ...ACCOUNT_TYPE_IDS.filter((id) => !ACCOUNT_TYPES[id].isLiabilityDefault),
  ...ACCOUNT_TYPE_IDS.filter((id) => ACCOUNT_TYPES[id].isLiabilityDefault),
];

/**
 * Signed net-worth contribution. Classification is the EFFECTIVE liability
 * value (P8-4 user override ?? type default) via the shared helper — flipping
 * isLiability on an account immediately reclassifies it here.
 */
function contributionOf(account: AccountItem): number {
  return effectiveIsLiability(account, logger)
    ? negateMinor(Math.abs(account.balanceMinor))
    : account.balanceMinor;
}

export async function getSummary(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const accounts = await listHouseholdAccounts(household, env.tableName);

  const currency = env.baseCurrency;
  // Only base-currency accounts enter the totals (P7-7 — no mixed sums).
  const isBaseCurrency = (account: AccountItem): boolean =>
    account.currency === currency;
  let assetsTotalMinor = 0;
  let liabilitiesTotalMinor = 0;
  let asOf = 0;
  for (const account of accounts) {
    if (isBaseCurrency(account)) {
      if (effectiveIsLiability(account, logger)) {
        liabilitiesTotalMinor = addMinor(
          liabilitiesTotalMinor,
          Math.abs(account.balanceMinor),
        );
      } else {
        assetsTotalMinor = addMinor(assetsTotalMinor, account.balanceMinor);
      }
    }
    if (account.balanceDate > asOf) asOf = account.balanceDate;
  }
  const netWorthMinor = addMinor(assetsTotalMinor, negateMinor(liabilitiesTotalMinor));
  if (asOf === 0) asOf = Math.floor(Date.now() / 1000);

  // P8-4: groups are keyed by the EFFECTIVE type (shared helper) and labeled
  // from the shared ACCOUNT_TYPES metadata; `type` carries the legacy
  // collapsed value for pre-P8-4 consumers ('business'/'cash' -> 'other', so
  // two groups may share it — `typeId` is the real key).
  const byType: SummaryTypeGroup[] = [];
  for (const typeId of TYPE_ORDER) {
    const group = accounts.filter(
      (a) => effectiveAccountType(a, logger) === typeId,
    );
    if (group.length === 0) continue;
    const totalMinor = addMinor(0, ...group.filter(isBaseCurrency).map(contributionOf));
    byType.push({
      type: toLegacyAccountType(typeId),
      typeId,
      label: ACCOUNT_TYPES[typeId].label,
      isLiability: ACCOUNT_TYPES[typeId].isLiabilityDefault,
      total: toCurrencyDecimalString(totalMinor, currency),
      totalMinor,
      accounts: group.map(toSummaryAccount),
    });
  }

  const institutions = [...new Set(accounts.map((a) => a.institution))].sort((a, b) =>
    a.localeCompare(b),
  );
  const byInstitution: SummaryInstitutionGroup[] = institutions.map((institution) => {
    const group = accounts.filter((a) => a.institution === institution);
    const totalMinor = addMinor(0, ...group.filter(isBaseCurrency).map(contributionOf));
    return {
      institution,
      total: toCurrencyDecimalString(totalMinor, currency),
      totalMinor,
      accounts: group.map(toSummaryAccount),
    };
  });

  const body: SummaryResponse = {
    netWorth: toCurrencyDecimalString(netWorthMinor, currency),
    netWorthMinor,
    currency,
    asOf,
    assetsTotal: toCurrencyDecimalString(assetsTotalMinor, currency),
    assetsTotalMinor,
    liabilitiesTotal: toCurrencyDecimalString(liabilitiesTotalMinor, currency),
    liabilitiesTotalMinor,
    byType,
    byInstitution,
  };
  return json(200, body);
}
