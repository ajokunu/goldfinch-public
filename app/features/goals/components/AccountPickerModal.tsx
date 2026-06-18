/**
 * Linked-account picker for the goal editor: every account (SimpleFIN-synced
 * and manual) with institution and current balance, check mark on the
 * current selection. Goal progress for a linked goal IS the account balance
 * (P7-2), so the balance shown here is exactly what the goal will report.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import type { AccountDto } from '@goldfinch/shared/types';

import { CurrencyAmount } from '../../../src/ui/CurrencyAmount';
import { AccountTypeIcon } from '../../../src/ui/icons';
import { ModalSheet } from '../../../src/ui/ModalSheet';
import { EmptyState, ErrorState, LoadingState } from '../../../src/ui/States';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { useAccountsQuery } from '../hooks/useGoalsQueries';

export interface AccountPickerModalProps {
  visible: boolean;
  currentAccountId: string | null;
  onSelect: (account: AccountDto) => void;
  onClose: () => void;
}

export function AccountPickerModal({
  visible,
  currentAccountId,
  onSelect,
  onClose,
}: AccountPickerModalProps) {
  const theme = useTheme();
  const accountsQuery = useAccountsQuery();
  const accounts = accountsQuery.data?.items ?? [];

  return (
    <ModalSheet visible={visible} title="Choose account" onClose={onClose}>
      {accountsQuery.isPending ? (
        <LoadingState />
      ) : accountsQuery.isError ? (
        <ErrorState
          message="Could not load accounts."
          onRetry={() => void accountsQuery.refetch()}
        />
      ) : accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          body="Connect SimpleFIN or create a manual account from More > Import, then link it here."
        />
      ) : (
        accounts.map((account) => {
          const selected = account.accountId === currentAccountId;
          return (
            <Pressable
              key={account.accountId}
              onPress={() => onSelect(account)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: theme.colors.surfaceAlt,
                  borderRadius: theme.radius.sm,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm + theme.spacing.xs,
                  marginBottom: theme.spacing.xs,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <View style={styles.iconWrap}>
                <AccountTypeIcon
                  accountTypeId={account.accountTypeId}
                  size={30}
                  iconSize={16}
                />
              </View>
              <View style={styles.labelWrap}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: theme.colors.textPrimary,
                    fontSize: theme.text.body,
                    fontWeight: selected ? '700' : '400',
                  }}
                >
                  {account.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    color: theme.colors.textSecondary,
                    fontSize: theme.text.caption,
                    marginTop: 2,
                  }}
                >
                  {account.institution}
                </Text>
              </View>
              <CurrencyAmount
                amountMinor={account.balanceMinor}
                currency={account.currency}
                size="sm"
              />
              {selected ? (
                <View style={{ marginLeft: theme.spacing.sm }}>
                  <Check size={18} color={theme.colors.accent} />
                </View>
              ) : null}
            </Pressable>
          );
        })
      )}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  iconWrap: { marginRight: 10, flexShrink: 0 },
  labelWrap: { flex: 1, paddingRight: 12 },
});
