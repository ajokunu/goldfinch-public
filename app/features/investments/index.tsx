/**
 * Investments / account-detail feature entry point (P7-3), rendered behind
 * /accounts/[accountId]: account summary card plus the holdings positions
 * table.
 *
 * The no-silent-blank rule from PHASE7-DECISIONS P7-3 is implemented from the
 * holdings response's `holdingsSupported` flag:
 * - false + SimpleFIN account  -> explicit "institution does not provide
 *   holdings via SimpleFIN" state;
 * - false + manual account     -> explicit manual-accounts state;
 * - true with zero rows        -> explicit empty state.
 * Loading and error states use the shared components, with retry.
 */
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  PencilLine,
  Receipt,
  Shapes,
  Type,
} from 'lucide-react-native';
import type { AccountTypeId } from '@goldfinch/shared/accountTypes';
import { MAX_TEXT_LENGTHS } from '@goldfinch/shared/constants';

import { usePatchAccount } from '../../src/api/mutations';
import {
  GoldfinchRefreshControl,
  GoldfinchRefreshMark,
} from '../../src/ui/GoldfinchRefresh';
import { AccountTypeIcon } from '../../src/ui/icons';
import { ListRow } from '../../src/ui/ListRow';
import { CountUp, SharedMark, Stagger, stagger } from '../../src/ui/motion';
import { Screen } from '../../src/ui/Screen';
import { useTheme } from '../../src/ui/ThemeProvider';
import { Money } from '../../src/ui/Money';
import { EmptyState, ErrorState, LoadingState } from '../../src/ui/States';
import { formatAsOf } from '../../src/lib/dates';
import { useAccountQuery, useHoldingsQuery } from './hooks/useAccountDetail';
import { AccountTextEditSheet } from './components/AccountTextEditSheet';
import { AccountTypeSheet } from './components/AccountTypeSheet';
import { HoldingsTable } from './components/HoldingsTable';
import { accountTypeLabel } from './lib/format';

export interface AccountDetailScreenProps {
  accountId: string | null;
}

export default function AccountDetailScreen({ accountId }: AccountDetailScreenProps) {
  if (accountId === null) {
    return (
      <Screen>
        <ErrorState message="This account link is missing its account id." />
      </Screen>
    );
  }
  return <AccountDetailBody accountId={accountId} />;
}

function AccountDetailBody({ accountId }: { accountId: string }) {
  const theme = useTheme();
  const router = useRouter();

  const accountQuery = useAccountQuery(accountId);
  const holdingsQuery = useHoldingsQuery(accountId);
  const account = accountQuery.data;

  // P8-4 account-type editing + label/institution overrides: one shared
  // optimistic PATCH (rolled back on any error inside the mutation; the failure
  // is logged there). `editing` records which field's edit is in flight so the
  // inline rollback note attaches to the right row -- the mutation is shared, so
  // patchMutation.isError alone cannot tell the three editors apart.
  const [typeSheetOpen, setTypeSheetOpen] = useState(false);
  const [nameSheetOpen, setNameSheetOpen] = useState(false);
  const [institutionSheetOpen, setInstitutionSheetOpen] = useState(false);
  const [editing, setEditing] = useState<
    'type' | 'name' | 'institution' | null
  >(null);
  const patchMutation = usePatchAccount();

  const selectType = (accountTypeId: AccountTypeId): void => {
    setTypeSheetOpen(false);
    if (account === undefined || accountTypeId === account.accountTypeId) return;
    setEditing('type');
    patchMutation.mutate({ accountId, body: { accountType: accountTypeId } });
  };

  // Empty/whitespace draft clears the override (send null -> revert to synced);
  // a non-empty draft sets the trimmed override. The sheet closes immediately so
  // the row reflects the optimistic value behind it (same as the type editor);
  // a failure rolls back and surfaces the inline note under the row.
  const saveOverride = (
    field: 'name' | 'institution',
    setOpen: (open: boolean) => void,
  ) => (draft: string): void => {
    setOpen(false);
    const trimmed = draft.trim();
    const next = trimmed.length > 0 ? trimmed : null;
    setEditing(field);
    patchMutation.mutate({
      accountId,
      body:
        field === 'name'
          ? { nameOverride: next }
          : { institutionOverride: next },
    });
  };

  const goBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // Cold deep link: there is no history; land on the dashboard.
      router.replace('/');
    }
  };

  const refresh = (): void => {
    void accountQuery.refetch();
    void holdingsQuery.refetch();
  };

  // ---- holdings section body ------------------------------------------------
  let holdingsBody;
  if (holdingsQuery.isPending) {
    holdingsBody = <LoadingState />;
  } else if (holdingsQuery.isError) {
    holdingsBody = (
      <ErrorState
        message={`Holdings could not be loaded. ${holdingsQuery.error.message}`}
        onRetry={() => void holdingsQuery.refetch()}
      />
    );
  } else if (!holdingsQuery.data.holdingsSupported) {
    // P7-3: the explicit no-holdings-from-institution state, never a blank.
    holdingsBody =
      account?.source === 'manual' ? (
        <EmptyState
          title="No holdings for manual accounts"
          body="Manual accounts track a balance and transactions only; investment positions are not recorded."
        />
      ) : (
        <EmptyState
          title="Holdings not provided"
          body="This institution does not provide holdings via SimpleFIN, so positions cannot be shown for this account."
        />
      );
  } else if (holdingsQuery.data.items.length === 0) {
    holdingsBody = (
      <EmptyState
        title="No holdings yet"
        body="This account supports holdings, but the latest sync reported no positions."
      />
    );
  } else {
    holdingsBody = <HoldingsTable holdings={holdingsQuery.data.items} />;
  }

  // ---- screen ---------------------------------------------------------------
  return (
    <Screen padded={false}>
      {/* Continuity anchor (PHASE9-DECISIONS P9-2 item 3, account row ->
          detail): the icon+name header lands in place immediately while the
          body cascades in below. SharedMark ships the coordinated FadeRise
          mimic -- Reanimated 4 has no native shared-element API (see
          src/ui/motion/SharedMark.tsx). */}
      <SharedMark tag={`account-${accountId}`}>
        <View
          style={[
            styles.header,
            {
              paddingHorizontal: theme.spacing.sm,
              paddingVertical: theme.spacing.sm,
              borderBottomColor: theme.colors.border,
            },
          ]}
        >
        <Pressable
          onPress={goBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <ChevronLeft size={26} color={theme.colors.textPrimary} />
        </Pressable>
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: theme.colors.textPrimary,
            fontSize: theme.text.body,
            fontWeight: '600',
            marginHorizontal: theme.spacing.sm,
          }}
        >
          {account?.name ?? 'Account'}
        </Text>
        </View>
      </SharedMark>

      {accountQuery.isPending ? (
        <LoadingState />
      ) : accountQuery.isError ? (
        <ErrorState
          message={`The account could not be loaded. ${accountQuery.error.message}`}
          onRetry={() => void accountQuery.refetch()}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: theme.spacing.md,
            paddingBottom: theme.spacing.xl,
          }}
          refreshControl={
            <GoldfinchRefreshControl
              refreshing={accountQuery.isRefetching || holdingsQuery.isRefetching}
              onRefresh={refresh}
            />
          }
        >
          {/* Coordinated cascade behind the SharedMark header (P9-2 item 3):
              summary card, type card, holdings heading and body follow at
              the 45ms interval. */}
          <Stagger initialDelayMs={stagger.cascadeMs}>
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                padding: theme.spacing.md,
                marginBottom: theme.spacing.lg,
              },
            ]}
          >
            <View style={styles.summaryHead}>
              <AccountTypeIcon
                accountTypeId={accountQuery.data.accountTypeId}
                size={32}
                iconSize={17}
              />
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: theme.text.caption,
                  marginLeft: theme.spacing.sm,
                  flexShrink: 1,
                }}
              >
                {accountQuery.data.institution}
                {' · '}
                {accountTypeLabel(accountQuery.data.accountTypeId)}
              </Text>
            </View>
            <View style={{ marginTop: theme.spacing.sm }}>
              {/* Balance headline (PHASE9-DECISIONS P9-2 item 4): rolling-
                  digit CountUp over the paired integer balanceMinor (same
                  formatted output as the DecimalString path) on mount and
                  on value change. */}
              <CountUp
                amountMinor={accountQuery.data.balanceMinor}
                currency={accountQuery.data.currency}
                size="xl"
                colorBySign={accountQuery.data.isLiability}
                testID="account-balance-hero"
              />
            </View>
            {accountQuery.data.availableBalance !== undefined ? (
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: theme.text.caption,
                  marginTop: theme.spacing.xs,
                }}
              >
                Available:{' '}
                <Money
                  amount={accountQuery.data.availableBalance}
                  currency={accountQuery.data.currency}
                  size="sm"
                />
              </Text>
            ) : null}
            <View style={[styles.metaLine, { marginTop: theme.spacing.sm }]}>
              {accountQuery.data.source === 'manual' ? (
                <View style={styles.metaLine}>
                  <PencilLine size={13} color={theme.colors.textSecondary} />
                  <Text
                    style={{
                      color: theme.colors.textSecondary,
                      fontSize: theme.text.caption,
                      marginLeft: theme.spacing.xs,
                    }}
                  >
                    Manual account
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.textSecondary,
                      fontSize: theme.text.caption,
                    }}
                  >
                    {' · '}
                  </Text>
                </View>
              ) : null}
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: theme.text.caption,
                }}
              >
                Balance as of {formatAsOf(accountQuery.data.balanceDate)}
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                paddingHorizontal: theme.spacing.xs,
                marginBottom: theme.spacing.lg,
              },
            ]}
          >
            <ListRow
              label="Name"
              icon={Type}
              sub={
                accountQuery.data.nameOverride !== undefined
                  ? `from ${accountQuery.data.syncedName}`
                  : undefined
              }
              onPress={() => setNameSheetOpen(true)}
              right={
                <View style={styles.typeValue}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: theme.colors.textSecondary,
                      fontSize: theme.text.caption,
                      maxWidth: 150,
                    }}
                  >
                    {accountQuery.data.name}
                  </Text>
                  <ChevronRight size={17} color={theme.colors.textFaint} />
                </View>
              }
            />
            {patchMutation.isError && editing === 'name' ? (
              <Text style={[styles.rowError, { color: theme.colors.danger, fontSize: theme.text.caption }]}>
                The name could not be updated. Your change was undone.
              </Text>
            ) : null}

            <ListRow
              label="Institution"
              icon={Building2}
              sub={
                accountQuery.data.institutionOverride !== undefined
                  ? `from ${accountQuery.data.syncedInstitution}`
                  : undefined
              }
              onPress={() => setInstitutionSheetOpen(true)}
              right={
                <View style={styles.typeValue}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: theme.colors.textSecondary,
                      fontSize: theme.text.caption,
                      maxWidth: 150,
                    }}
                  >
                    {accountQuery.data.institution}
                  </Text>
                  <ChevronRight size={17} color={theme.colors.textFaint} />
                </View>
              }
            />
            {patchMutation.isError && editing === 'institution' ? (
              <Text style={[styles.rowError, { color: theme.colors.danger, fontSize: theme.text.caption }]}>
                The institution could not be updated. Your change was undone.
              </Text>
            ) : null}

            <ListRow
              label="Account type"
              icon={Shapes}
              onPress={() => setTypeSheetOpen(true)}
              right={
                <View style={styles.typeValue}>
                  <Text
                    style={{
                      color: theme.colors.textSecondary,
                      fontSize: theme.text.caption,
                    }}
                  >
                    {accountTypeLabel(accountQuery.data.accountTypeId)}
                  </Text>
                  <ChevronRight size={17} color={theme.colors.textFaint} />
                </View>
              }
            />
            {patchMutation.isError && editing === 'type' ? (
              <Text style={[styles.rowError, { color: theme.colors.danger, fontSize: theme.text.caption }]}>
                The account type could not be updated. Your change was undone.
              </Text>
            ) : null}

            <ListRow
              label="View transactions"
              icon={Receipt}
              onPress={() =>
                router.push({
                  pathname: '/transactions',
                  params: { accountId },
                })
              }
            />
          </View>

          <Text
            style={{
              color: theme.colors.textPrimary,
              fontSize: theme.text.heading,
              fontWeight: '600',
              marginBottom: theme.spacing.sm,
            }}
          >
            Holdings
          </Text>
          {holdingsBody}
          </Stagger>
        </ScrollView>
      )}
      <GoldfinchRefreshMark
        active={accountQuery.isRefetching || holdingsQuery.isRefetching}
      />

      {account !== undefined ? (
        <>
          <AccountTextEditSheet
            visible={nameSheetOpen}
            onClose={() => setNameSheetOpen(false)}
            title="Name"
            prefill={account.nameOverride ?? ''}
            placeholder={account.syncedName}
            hint="Leave blank to use the name from your bank."
            maxLength={MAX_TEXT_LENGTHS.accountName}
            saving={patchMutation.isPending && editing === 'name'}
            error={null}
            onSave={saveOverride('name', setNameSheetOpen)}
            testID="account-name-input"
          />
          <AccountTextEditSheet
            visible={institutionSheetOpen}
            onClose={() => setInstitutionSheetOpen(false)}
            title="Institution"
            prefill={account.institutionOverride ?? ''}
            placeholder={account.syncedInstitution}
            hint="Leave blank to use the bank from your sync."
            maxLength={MAX_TEXT_LENGTHS.accountInstitution}
            saving={patchMutation.isPending && editing === 'institution'}
            error={null}
            onSave={saveOverride('institution', setInstitutionSheetOpen)}
            testID="account-institution-input"
          />
          <AccountTypeSheet
            visible={typeSheetOpen}
            onClose={() => setTypeSheetOpen(false)}
            selected={account.accountTypeId}
            onSelect={selectType}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  card: { borderWidth: StyleSheet.hairlineWidth },
  metaLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  summaryHead: { flexDirection: 'row', alignItems: 'center' },
  typeValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowError: { paddingHorizontal: 8, paddingBottom: 8 },
});
