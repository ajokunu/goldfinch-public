/**
 * Step 2: choose the target account for the import, or create a manual
 * account inline (POST /accounts) for statements SimpleFIN does not cover.
 * The selected account's currency drives amount normalization in the
 * mapping step.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, Plus } from 'lucide-react-native';
import { ACCOUNT_TYPES } from '@goldfinch/shared/accountTypes';
import type { AccountDto } from '@goldfinch/shared/types';

import { CurrencyAmount } from '../../../src/ui/CurrencyAmount';
import { AccountTypeIcon } from '../../../src/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '../../../src/ui/States';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { useAccountsQuery } from '../hooks/useImportQueries';
import { Button } from './Buttons';
import { CreateAccountSheet } from './CreateAccountSheet';

export interface AccountStepProps {
  selectedAccountId: string | null;
  onSelect: (account: AccountDto) => void;
  onContinue: () => void;
  onBack: () => void;
}

export function AccountStep({
  selectedAccountId,
  onSelect,
  onContinue,
  onBack,
}: AccountStepProps) {
  const theme = useTheme();
  const accountsQuery = useAccountsQuery();
  const [creating, setCreating] = useState(false);

  const accounts = accountsQuery.data ?? [];

  return (
    <View>
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: theme.text.heading,
          fontWeight: '700',
          marginBottom: theme.spacing.xs,
        }}
      >
        Where do these transactions belong?
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.caption,
          marginBottom: theme.spacing.md,
        }}
      >
        Amounts are read in the selected account's currency. Imported rows
        update the balance of manual accounts only; synced accounts keep
        their bank-reported balance.
      </Text>

      {accountsQuery.isPending ? (
        <LoadingState />
      ) : accountsQuery.isError ? (
        <ErrorState
          message="Loading accounts failed."
          onRetry={() => void accountsQuery.refetch()}
        />
      ) : accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          body="Create a manual account below to import into."
        />
      ) : (
        accounts.map((account) => {
          const selected = account.accountId === selectedAccountId;
          return (
            <Pressable
              key={account.accountId}
              onPress={() => onSelect(account)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.accountRow,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: selected ? theme.colors.accent : theme.colors.border,
                  borderRadius: theme.radius.md,
                  marginBottom: theme.spacing.sm,
                  padding: theme.spacing.md,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <View style={styles.accountIcon}>
                <AccountTypeIcon
                  accountTypeId={account.accountTypeId}
                  size={32}
                  iconSize={17}
                />
              </View>
              <View style={styles.accountText}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: theme.colors.textPrimary,
                    fontSize: theme.text.body,
                    fontWeight: '600',
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
                  {account.institution} |{' '}
                  {ACCOUNT_TYPES[account.accountTypeId].label} | {account.currency}
                  {account.source === 'manual' ? ' | manual' : ''}
                </Text>
              </View>
              <CurrencyAmount
                amountMinor={account.balanceMinor}
                currency={account.currency}
                size="sm"
              />
              {selected ? (
                <Check
                  size={18}
                  color={theme.colors.accent}
                  style={{ marginLeft: theme.spacing.sm }}
                />
              ) : null}
            </Pressable>
          );
        })
      )}

      <Pressable
        onPress={() => setCreating(true)}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.createRow,
          {
            borderColor: theme.colors.border,
            borderRadius: theme.radius.md,
            marginTop: theme.spacing.xs,
            marginBottom: theme.spacing.lg,
            padding: theme.spacing.md,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Plus size={18} color={theme.colors.accent} />
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.body,
            fontWeight: '600',
            marginLeft: theme.spacing.sm,
          }}
        >
          New manual account
        </Text>
      </Pressable>

      <Button
        label="Continue to column mapping"
        onPress={onContinue}
        disabled={selectedAccountId === null}
      />
      <View style={{ height: theme.spacing.sm }} />
      <Button label="Back" variant="secondary" onPress={onBack} />

      <CreateAccountSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={(account) => {
          setCreating(false);
          onSelect(account);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  accountRow: { alignItems: 'center', borderWidth: 1, flexDirection: 'row' },
  accountIcon: { flexShrink: 0, marginRight: 10 },
  accountText: { flex: 1, marginRight: 8 },
  createRow: {
    alignItems: 'center',
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
});
