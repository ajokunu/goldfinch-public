/**
 * Account detail route (P7-3): account summary plus the holdings positions
 * table for one account. The route param is the AccountDto.accountId (ULID),
 * matching queryKeys.accounts.detail / queryKeys.holdings.byAccount.
 *
 * Thin typed route binding; the screen body is owned by the investments
 * feature (features/investments/). Hidden from the tab bar via href: null in
 * app/(app)/_layout.tsx.
 */
import { useLocalSearchParams } from 'expo-router';

import AccountDetailScreen from '../../../features/investments';

export default function AccountDetailRoute() {
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  return (
    <AccountDetailScreen
      accountId={typeof accountId === 'string' && accountId.length > 0 ? accountId : null}
    />
  );
}
