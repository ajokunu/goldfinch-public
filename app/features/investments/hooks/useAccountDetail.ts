/**
 * Account-detail queries (P7-3): the single account and its holdings list.
 * Keys come from the shared factory so manual-account creation and import
 * invalidations (accounts.all is a prefix of accounts.detail) refresh this
 * screen automatically.
 */
import { useQuery } from '@tanstack/react-query';

import { getAccount, listAccountHoldings } from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';

/** GET /accounts/{accountId} -- 404 NOT_FOUND surfaces as the error state. */
export function useAccountQuery(accountId: string) {
  return useQuery({
    queryKey: queryKeys.accounts.detail(accountId),
    queryFn: ({ signal }) => getAccount(accountId, signal),
  });
}

/**
 * GET /accounts/{accountId}/holdings. The response's holdingsSupported flag
 * is the explicit no-silent-blank signal (false == the institution does not
 * provide holdings via SimpleFIN) and MUST be rendered as such.
 */
export function useHoldingsQuery(accountId: string) {
  return useQuery({
    queryKey: queryKeys.holdings.byAccount(accountId),
    queryFn: ({ signal }) => listAccountHoldings(accountId, signal),
  });
}
