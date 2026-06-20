/**
 * Accounts card (screens.md 1.5): balances grouped by institution ("Bank")
 * or by type, toggled with the kit's segmented control. Grouping and signed
 * totals stay server-computed in GET /summary; the toggle is pure client
 * presentation between summary.byInstitution and summary.byType.
 *
 * Row anatomy: 38px account-type identity well (AccountTypeIcon,
 * ops/design-spec/icons.md) + two-line text (name over institution/type) +
 * signed balance. Rows navigate to the Activity tab with the account filter
 * param (the shell's `?param` contract -- the screen lands on the real
 * Activity view either way).
 *
 * GAP (1.5): the prototype's "···· 4471" mask is omitted -- no mask field
 * exists on SummaryAccount.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  ACCOUNT_TYPES,
  toAccountTypeId,
  type AccountTypeId,
} from '@goldfinch/shared/accountTypes';
import type { SummaryAccount, SummaryResponse } from '@goldfinch/shared/types';

import { useT } from '../../../src/i18n';
import { logger } from '../../../src/lib/logger';
import { CurrencyAmount } from '../../../src/ui/CurrencyAmount';
import { AccountTypeIcon } from '../../../src/ui/icons';
import { Segmented } from '../../../src/ui/Segmented';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { Card, CardHeader } from './Card';

type GroupingMode = 'institution' | 'type';

const log = logger.child({ screen: 'dashboard', card: 'accounts' });

/**
 * Effective type id for a summary account (P8-4): the server's effective
 * `accountTypeId` when present; pre-P8-4 payloads degrade through the shared
 * legacy mapping (logged inside the helper on dirty data).
 */
function summaryAccountTypeId(account: SummaryAccount): AccountTypeId {
  return account.accountTypeId ?? toAccountTypeId(account.accountType, log);
}

function AccountRow({
  account,
  secondary,
}: {
  account: SummaryAccount;
  secondary: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  const negative = account.balanceMinor < 0;

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/transactions',
          params: { accountId: account.accountId },
        })
      }
      accessibilityRole="button"
      accessibilityLabel={account.name}
      accessibilityHint={secondary}
      style={({ pressed }) => [
        styles.accountRow,
        {
          paddingVertical: 9,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <View style={styles.tokWrap}>
        <AccountTypeIcon accountTypeId={summaryAccountTypeId(account)} />
      </View>
      <View style={styles.accountText}>
        <Text
          numberOfLines={1}
          style={{
            color: theme.colors.text,
            fontSize: 14.5,
            fontFamily: theme.fonts.sansSet.semibold,
          }}
        >
          {account.name}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: theme.colors.dim,
            fontSize: 12,
            fontFamily: theme.fonts.sans,
            marginTop: 1,
          }}
        >
          {secondary}
        </Text>
      </View>
      <CurrencyAmount
        amountMinor={account.balanceMinor}
        currency={account.currency}
        style={negative ? { color: theme.colors.neg } : undefined}
      />
    </Pressable>
  );
}

function Group({
  label,
  totalMinor,
  currency,
  accounts,
  secondaryFor,
}: {
  label: string;
  totalMinor: number;
  currency: string;
  accounts: SummaryAccount[];
  secondaryFor: (account: SummaryAccount) => string;
}) {
  const theme = useTheme();
  return (
    <View style={{ marginTop: theme.spacing.sm }}>
      <View
        style={[
          styles.groupHeader,
          { borderBottomColor: theme.colors.line, paddingBottom: 6 },
        ]}
      >
        <Text
          numberOfLines={1}
          style={{
            color: theme.colors.dim,
            fontSize: 11,
            fontFamily: theme.fonts.sansSet.semibold,
            textTransform: 'uppercase',
            letterSpacing: 0.7,
            flex: 1,
          }}
        >
          {label}
        </Text>
        <CurrencyAmount
          amountMinor={totalMinor}
          currency={currency}
          size="sm"
          style={{
            color: totalMinor < 0 ? theme.colors.neg : theme.colors.dim,
          }}
        />
      </View>
      {accounts.map((account) => (
        <AccountRow
          key={account.accountId}
          account={account}
          secondary={secondaryFor(account)}
        />
      ))}
    </View>
  );
}

function SectionHeading({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <Text
      style={{
        color: theme.colors.text,
        fontSize: 14,
        fontFamily: theme.fonts.sansSet.semibold,
        marginTop: theme.spacing.md,
      }}
    >
      {label}
    </Text>
  );
}

export function AccountGroups({ summary }: { summary: SummaryResponse }) {
  const t = useT();
  const [mode, setMode] = useState<GroupingMode>('institution');

  const assetGroups = summary.byType.filter((group) => !group.isLiability);
  const liabilityGroups = summary.byType.filter((group) => group.isLiability);

  return (
    <Card>
      <CardHeader
        title={t('Accounts')}
        right={
          <View style={styles.toggleWrap}>
            <Segmented<GroupingMode>
              options={[
                { key: 'institution', label: t('Bank') },
                { key: 'type', label: t('Type') },
              ]}
              value={mode}
              onChange={setMode}
              small
            />
          </View>
        }
      />
      {mode === 'institution' ? (
        summary.byInstitution.map((group) => (
          <Group
            key={group.institution}
            label={group.institution}
            totalMinor={group.totalMinor}
            currency={summary.currency}
            accounts={group.accounts}
            secondaryFor={(account) =>
              ACCOUNT_TYPES[summaryAccountTypeId(account)].label
            }
          />
        ))
      ) : (
        <>
          {assetGroups.length > 0 ? (
            <SectionHeading label={t('Assets')} />
          ) : null}
          {assetGroups.map((group) => (
            <Group
              // typeId is the effective-type group key (P8-4); the legacy
              // `type` collapses business/cash onto 'other' and would
              // duplicate keys.
              key={group.typeId ?? group.type}
              label={group.label}
              totalMinor={group.totalMinor}
              currency={summary.currency}
              accounts={group.accounts}
              secondaryFor={(account) => account.institution}
            />
          ))}
          {liabilityGroups.length > 0 ? (
            <SectionHeading label={t('Liabilities')} />
          ) : null}
          {liabilityGroups.map((group) => (
            <Group
              key={group.typeId ?? group.type}
              label={group.label}
              totalMinor={group.totalMinor}
              currency={summary.currency}
              accounts={group.accounts}
              secondaryFor={(account) => account.institution}
            />
          ))}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  toggleWrap: { width: 132 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  accountRow: { flexDirection: 'row', alignItems: 'center' },
  tokWrap: { marginRight: 11, flexShrink: 0 },
  accountText: { flex: 1, marginRight: 12 },
});
