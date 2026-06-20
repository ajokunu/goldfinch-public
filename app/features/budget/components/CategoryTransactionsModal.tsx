/**
 * Drill-down + recategorize flow: lists one month of transactions for a
 * category (or the uncategorized bucket when categoryId is null); tapping a
 * transaction opens the category picker and PATCHes the assignment. The
 * month's pages are fetched via the shared transactions cache and filtered
 * client-side (the list API has no category filter; household volume is a
 * few pages at most). Restyled onto the sheet anatomy (design spec
 * screens.md 3.5 / shell sheet scaffold); all states preserved.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  CategoryDto,
  CurrencyCode,
  IsoDate,
  IsoMonth,
  TransactionDto,
} from '@goldfinch/shared/types';

import { localeTag, rangeLabel, useLang, useT } from '../../../src/i18n';
import { Badge } from '../../../src/ui/Badge';
import { Money } from '../../../src/ui/Money';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { errorMessage } from '../lib/errors';
import { isoMonthLabel, monthDateRange } from '../../../src/lib/dates';
import { useRangeTransactions } from '../hooks/useBudgetQueries';
import { useRecategorizeTransaction } from '../hooks/useBudgetMutations';
import { Button } from './Buttons';
import { CategoryPickerModal } from './CategoryPickerModal';
import { EmptyState, ErrorState, LoadingState } from '../../../src/ui/States';
import { ModalSheet } from '../../../src/ui/ModalSheet';

export interface CategoryTransactionsTarget {
  /** null = the uncategorized bucket. */
  categoryId: string | null;
  title: string;
}

export interface CategoryTransactionsModalProps {
  target: CategoryTransactionsTarget | null;
  /** Single-month window (default mode). */
  month: IsoMonth;
  /**
   * Explicit inclusive [from,to] window (budget-range feature, Section 9.3 C).
   * When set, the drill-down lists the WHOLE range -- the same window the row's
   * spend-vs-target was computed over -- instead of `month`.
   */
  range?: { from: IsoDate; to: IsoDate } | null;
  currency: CurrencyCode;
  onClose: () => void;
}

export function CategoryTransactionsModal({
  target,
  month,
  range,
  currency,
  onClose,
}: CategoryTransactionsModalProps) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  const visible = target !== null;
  // Range mode lists the active [from,to]; default mode lists the month.
  const window = range ?? monthDateRange(month);
  const monthTxns = useRangeTransactions(window.from, window.to, visible);
  const recategorize = useRecategorizeTransaction();

  const [pickingFor, setPickingFor] = useState<TransactionDto | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!target) return [];
    return monthTxns.transactions.filter(
      (txn) => txn.categoryId === target.categoryId,
    );
  }, [monthTxns.transactions, target]);

  const handlePick = (category: CategoryDto) => {
    const txn = pickingFor;
    setPickingFor(null);
    if (!txn || category.categoryId === txn.categoryId) return;
    setActionError(null);
    recategorize.mutate(
      { txnId: txn.txnId, date: txn.date, categoryId: category.categoryId },
      { onError: (error) => setActionError(errorMessage(error)) },
    );
  };

  if (!target) return null;

  return (
    <>
      <ModalSheet
        visible={visible && pickingFor === null}
        title={`${target.title} — ${
          range
            ? rangeLabel(lang, range.from, range.to, localeTag(lang))
            : isoMonthLabel(month, localeTag(lang))
        }`}
        onClose={onClose}
      >
        {actionError ? (
          <Text
            style={{
              color: theme.colors.danger,
              fontSize: 12.5,
              fontFamily: theme.fonts.sans,
              marginBottom: theme.spacing.sm,
            }}
          >
            {actionError}
          </Text>
        ) : null}

        {monthTxns.isPending ? (
          <LoadingState />
        ) : monthTxns.isError ? (
          <ErrorState
            message="Could not load transactions."
            onRetry={() => void monthTxns.refetch()}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No transactions"
            body={
              target.categoryId === null
                ? range
                  ? 'Everything in this range is categorized.'
                  : 'Everything this month is categorized.'
                : range
                  ? 'Nothing in this category for this range.'
                  : 'Nothing in this category this month.'
            }
          />
        ) : (
          <>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: 12.5,
                fontFamily: theme.fonts.sans,
                marginBottom: theme.spacing.sm,
              }}
            >
              Tap a transaction to change its category.
            </Text>
            {filtered.map((txn) => (
              <Pressable
                key={txn.txnId}
                onPress={() => setPickingFor(txn)}
                disabled={recategorize.isPending}
                accessibilityRole="button"
                accessibilityLabel={`Recategorize ${txn.payee}`}
                style={({ pressed }) => [
                  styles.txnRow,
                  {
                    backgroundColor: theme.colors.surfaceAlt,
                    borderRadius: theme.radius.control,
                    padding: 12,
                    marginBottom: 6,
                    opacity: pressed || recategorize.isPending ? 0.7 : 1,
                  },
                ]}
              >
                <View style={styles.txnMain}>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: theme.colors.textPrimary,
                      fontSize: 14.5,
                      fontFamily: theme.fonts.sansSet.semibold,
                    }}
                  >
                    {txn.payee}
                  </Text>
                  <View style={styles.txnMeta}>
                    <Text
                      style={{
                        color: theme.colors.textSecondary,
                        fontSize: 12,
                        fontFamily: theme.fonts.mono,
                      }}
                    >
                      {txn.date}
                    </Text>
                    {txn.pending ? (
                      <View style={{ marginLeft: theme.spacing.sm }}>
                        <Badge label={t('Pending')} variant="pending" />
                      </View>
                    ) : null}
                  </View>
                </View>
                <Money
                  amount={txn.amount}
                  currency={txn.currency || currency}
                  colorBySign
                  size="sm"
                />
              </Pressable>
            ))}
            {monthTxns.hasNextPage ? (
              <View style={{ marginTop: theme.spacing.sm }}>
                <Button
                  label="Load more"
                  variant="secondary"
                  onPress={() => void monthTxns.fetchNextPage()}
                  loading={monthTxns.isFetchingNextPage}
                />
              </View>
            ) : null}
          </>
        )}
      </ModalSheet>

      <CategoryPickerModal
        visible={pickingFor !== null}
        currentCategoryId={pickingFor?.categoryId ?? null}
        onSelect={handlePick}
        onClose={() => setPickingFor(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  txnRow: { flexDirection: 'row', alignItems: 'center' },
  txnMain: { flex: 1, paddingRight: 8 },
  txnMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
});
