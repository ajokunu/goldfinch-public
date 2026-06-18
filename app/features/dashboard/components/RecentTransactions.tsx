/**
 * Recent-activity card (screens.md 1.7): the newest five transactions in the
 * shared row anatomy (2.3) -- 38px tok, payee + "{account} · {category}"
 * line, signed amount -- with a ghost "See all" header link into the
 * Activity tab. Row taps bubble up through onPressTransaction; the screen
 * hosts the transactions feature's detail sheet + toast (2.5) so they anchor
 * to the screen, not this card.
 *
 * t() applies only to UI strings (Transfer/Uncategorized/See all/...);
 * payees, account names, and category names are API data rendered verbatim.
 * The leading well is the category identity icon in its deterministic accent
 * (CategoryIcon, ops/design-spec/icons.md); transfers get the neutral well.
 *
 * GAP (2.3): no pre-commit suggestion field exists on TransactionDto, so
 * uncategorized rows render plain "Uncategorized" -- no invented suggestions.
 */
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Sparkles } from 'lucide-react-native';
import type { TransactionDto } from '@goldfinch/shared/types';

import { useT } from '../../../src/i18n';
import { CategoryIcon } from '../../../src/ui/icons';
import { Money } from '../../../src/ui/Money';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  hoverBackground,
  hoverTransitionStyle,
  useHover,
} from '../../../src/ui/useHover';
import { useReducedMotion } from '../../../src/ui/useReducedMotion';
import { PendingBadge } from '../../transactions/components/PendingBadge';
import { useCategoryNames } from '../../transactions/hooks/useLookups';
import { Card, CardHeader } from './Card';

/** Rows displayed on the card (screens.md 1.7); the query fetches 15. */
export const RECENT_DISPLAY_COUNT = 5;

function TransactionTok({
  transaction,
  categoryName,
}: {
  transaction: TransactionDto;
  categoryName: string | undefined;
}) {
  return (
    <View style={styles.tokWrap}>
      {transaction.isTransfer ? (
        <CategoryIcon categoryId="transfers" neutral />
      ) : (
        <CategoryIcon
          categoryId={transaction.categoryId}
          categoryName={categoryName}
        />
      )}
    </View>
  );
}

function TransactionRow({
  transaction,
  accountName,
  categoryName,
  onPress,
}: {
  transaction: TransactionDto;
  accountName: string | undefined;
  categoryName: string | undefined;
  onPress: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const reduced = useReducedMotion();
  const { hovered, hoverProps } = useHover();

  const income = transaction.amountMinor > 0;
  const autoTagged =
    !transaction.userCategorized &&
    (transaction.categorizedBy === 'rule' || transaction.categorizedBy === 'ai');

  const categoryLabel = transaction.isTransfer
    ? t('Transfer')
    : (categoryName ?? t('Uncategorized'));
  const lineTwo = [accountName, categoryLabel]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  const amountColor = transaction.pending
    ? theme.colors.faint
    : income
      ? theme.colors.pos
      : theme.colors.text;

  return (
    <Pressable
      onPress={onPress}
      {...hoverProps}
      accessibilityRole="button"
      accessibilityLabel={transaction.payee}
      accessibilityHint={lineTwo}
      style={({ pressed }) => [
        styles.row,
        hoverTransitionStyle(reduced),
        {
          borderTopColor: theme.colors.line,
          backgroundColor: hovered ? hoverBackground(theme) : 'transparent',
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <TransactionTok transaction={transaction} categoryName={categoryName} />
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          style={{
            color: theme.colors.text,
            fontSize: 14.5,
            fontFamily: theme.fonts.sansSet.semibold,
          }}
        >
          {transaction.payee}
        </Text>
        <View style={styles.metaRow}>
          {autoTagged ? (
            <Sparkles
              size={12}
              color={theme.colors.accent2}
              strokeWidth={2.2}
              style={styles.sparkle}
            />
          ) : null}
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.dim,
              fontSize: 12,
              fontFamily: theme.fonts.sans,
              flexShrink: 1,
            }}
          >
            {autoTagged ? `Auto · ${categoryLabel}` : lineTwo}
          </Text>
        </View>
      </View>
      <View style={styles.amountCol}>
        <Money
          amount={transaction.amount}
          currency={transaction.currency}
          signDisplay={income ? 'always' : 'auto'}
          style={{ color: amountColor }}
        />
        {transaction.pending ? <PendingBadge /> : null}
      </View>
    </Pressable>
  );
}

export function RecentTransactions({
  transactions,
  accountNameFor,
  onPressTransaction,
}: {
  transactions: TransactionDto[];
  accountNameFor: (accountId: string) => string | undefined;
  /** Opens the screen-hosted transaction detail sheet (screens.md 2.5). */
  onPressTransaction: (txnId: string) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const categoryNames = useCategoryNames();

  return (
    <Card>
      <CardHeader
        title={t('Recent activity')}
        right={
          <Link href="/transactions" asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={t('See all')}
              style={({ pressed }) =>
                StyleSheet.flatten([
                  styles.ghostLink,
                  { opacity: pressed ? 0.7 : 1 },
                ])
              }
            >
              <Text
                style={{
                  color: theme.colors.accent,
                  fontSize: 13,
                  fontFamily: theme.fonts.sansSet.semibold,
                }}
              >
                {t('See all')}
              </Text>
              <ChevronRight size={14} color={theme.colors.accent} />
            </Pressable>
          </Link>
        }
      />
      {transactions.slice(0, RECENT_DISPLAY_COUNT).map((transaction) => (
        <TransactionRow
          key={transaction.txnId}
          transaction={transaction}
          accountName={
            transaction.accountName ?? accountNameFor(transaction.accountId)
          }
          categoryName={
            transaction.categoryId === null
              ? undefined
              : categoryNames.get(transaction.categoryId)
          }
          onPress={() => onPressTransaction(transaction.txnId)}
        />
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  ghostLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingVertical: 9,
  },
  rowText: { flex: 1, marginRight: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 1 },
  sparkle: { marginRight: 3 },
  amountCol: { alignItems: 'flex-end', gap: 3 },
  tokWrap: { marginRight: 11, flexShrink: 0 },
});
