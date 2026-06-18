/**
 * Aggregate-holdings query for the Investments tab.
 *
 * Architecture (no new API route -- a real aggregate endpoint would force
 * edits to the shared API_ROUTES + infra + router-parity tests, all outside
 * this stream): the tab reuses the EXISTING per-account holdings endpoint.
 *
 *   1. useQuery(queryKeys.accounts.all, listAccounts) -- the SAME cache entry
 *      the dashboard and goals already populate, so the account list is free
 *      when the user arrives from elsewhere.
 *   2. Filter to investment accounts by EFFECTIVE accountTypeId (P8-4).
 *   3. useQueries fans out one GET /accounts/{id}/holdings per investment
 *      account, each keyed by queryKeys.holdings.byAccount(id) -- the SAME key
 *      the per-account detail screen uses, so navigation between the aggregate
 *      tab and a single-account view shares cache.
 *
 * The holdingsSupported contract is preserved: an account whose response
 * reports holdingsSupported === false contributes NO rows and is counted as
 * unsupported so the screen can render the explicit "not provided" state
 * (never a silent blank, P7-3).
 */
import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { AccountTypeId } from '@goldfinch/shared/accountTypes';
import type { HoldingDto } from '@goldfinch/shared/types';

import { listAccounts, listAccountHoldings } from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';

const INVESTMENT_TYPE: AccountTypeId = 'investment';

export interface InvestmentsHoldingsResult {
  /** Still resolving the account list, or any per-account holdings read. */
  isPending: boolean;
  /** The account list failed, or any per-account holdings read failed. */
  isError: boolean;
  /** Any read is in a background refetch. */
  isRefetching: boolean;
  /** Flattened HoldingDto rows from SUPPORTED investment accounts only. */
  holdings: HoldingDto[];
  /** Number of investment-type accounts (any support state). */
  investmentAccountCount: number;
  /** Investment accounts whose holdings response was holdingsSupported:false. */
  unsupportedCount: number;
  /** Refetch the account list and every per-account holdings read. */
  refetchAll: () => void;
}

export function useInvestmentsHoldings(): InvestmentsHoldingsResult {
  const accountsQuery = useQuery({
    queryKey: queryKeys.accounts.all(),
    queryFn: ({ signal }) => listAccounts(signal),
  });

  const investmentAccountIds = useMemo(() => {
    const items = accountsQuery.data?.items ?? [];
    return items
      .filter((account) => account.accountTypeId === INVESTMENT_TYPE)
      .map((account) => account.accountId);
  }, [accountsQuery.data]);

  const holdingsQueries = useQueries({
    queries: investmentAccountIds.map((accountId) => ({
      queryKey: queryKeys.holdings.byAccount(accountId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listAccountHoldings(accountId, signal),
    })),
  });

  // The account read gates everything; only fan-out queries that actually
  // exist contribute to pending/error (an empty investment set is not an
  // error -- it is the "no investment accounts" empty state).
  const subPending = holdingsQueries.some((query) => query.isPending);
  const subError = holdingsQueries.some((query) => query.isError);
  const subRefetching = holdingsQueries.some((query) => query.isRefetching);

  const holdings: HoldingDto[] = [];
  let unsupportedCount = 0;
  for (const query of holdingsQueries) {
    const data = query.data;
    if (data === undefined) continue;
    if (!data.holdingsSupported) {
      unsupportedCount += 1;
      continue;
    }
    holdings.push(...data.items);
  }

  const refetchAll = (): void => {
    void accountsQuery.refetch();
    for (const query of holdingsQueries) {
      void query.refetch();
    }
  };

  return {
    isPending: accountsQuery.isPending || subPending,
    isError: accountsQuery.isError || subError,
    isRefetching: accountsQuery.isRefetching || subRefetching,
    holdings,
    investmentAccountCount: investmentAccountIds.length,
    unsupportedCount,
    refetchAll,
  };
}
