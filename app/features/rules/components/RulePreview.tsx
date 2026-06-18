/**
 * Live preview (P7-5): evaluates the in-progress rule form against the most
 * recent transactions entirely client-side, through the shared matcher
 * (@goldfinch/shared/rules) -- the same code path the server's apply-now and
 * the daily rules pass run.
 *
 * The summary distinguishes "matches" from "apply-now would update": apply
 * only touches uncategorized, non-user-categorized rows. Rows a stronger
 * rule would win in the daily pass are flagged so precedence surprises are
 * visible before saving.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RuleSpec } from '@goldfinch/shared/rules';

import { CurrencyAmount } from '../../../src/ui/CurrencyAmount';
import { EmptyState, ErrorState, LoadingState } from '../../../src/ui/States';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { formatTxnDate } from '../../../src/lib/dates';
import { computeRulePreview, type PreviewMatch } from '../lib/preview';
import {
  DRAFT_RULE_ID,
  previewSpecFromForm,
  type RuleFormState,
} from '../lib/form';
import {
  PREVIEW_WINDOW_DAYS,
  useRecentTransactionsQuery,
} from '../hooks/useRecentTransactions';
import { useRulesQuery } from '../hooks/useRulesQuery';

/** Matched rows rendered before collapsing into a "+ N more" line. */
const MAX_PREVIEW_ROWS = 8;

export interface RulePreviewProps {
  form: RuleFormState;
  /** ruleId when editing an existing rule; null when creating. */
  editingRuleId: string | null;
}

export function RulePreview({ form, editingRuleId }: RulePreviewProps) {
  const theme = useTheme();
  const transactionsQuery = useRecentTransactionsQuery();
  const rulesQuery = useRulesQuery();

  const ruleId = editingRuleId ?? DRAFT_RULE_ID;
  const specResult = useMemo(
    () => previewSpecFromForm(form, ruleId),
    [form, ruleId],
  );

  // The stored copy of the rule being edited must not compete with its own
  // draft; disabled rules are kept (ruleMatches skips them) for simplicity.
  const otherRules: readonly RuleSpec[] = useMemo(
    () => (rulesQuery.data ?? []).filter((rule) => rule.ruleId !== ruleId),
    [rulesQuery.data, ruleId],
  );

  const preview = useMemo(() => {
    if (!specResult.spec || !transactionsQuery.data) return null;
    return computeRulePreview(specResult.spec, otherRules, transactionsQuery.data);
  }, [specResult.spec, otherRules, transactionsQuery.data]);

  return (
    <View
      style={{
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border,
        paddingTop: theme.spacing.md,
        marginBottom: theme.spacing.md,
      }}
    >
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: theme.text.body,
          fontWeight: '700',
        }}
      >
        Preview
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.caption,
          marginTop: theme.spacing.xs,
          marginBottom: theme.spacing.sm,
        }}
      >
        Checked live against your most recent transactions (last{' '}
        {PREVIEW_WINDOW_DAYS} days) with the same matcher the server runs.
      </Text>

      {!form.enabled ? (
        <Text
          style={{
            color: theme.colors.warning,
            fontSize: theme.text.caption,
            marginBottom: theme.spacing.sm,
          }}
        >
          This rule is disabled and will not match anything; the preview shows
          what it would do once enabled.
        </Text>
      ) : null}

      {specResult.issue ? (
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.text.caption,
            fontStyle: 'italic',
          }}
        >
          {specResult.issue}
        </Text>
      ) : transactionsQuery.isPending ? (
        <LoadingState />
      ) : transactionsQuery.isError ? (
        <ErrorState
          message="Could not load recent transactions for the preview."
          onRetry={() => void transactionsQuery.refetch()}
        />
      ) : preview === null ? (
        // Defensive only: spec + transaction data present implies a computed
        // preview (otherRules degrades to [] while the rules cache fills).
        <LoadingState />
      ) : preview.matchedCount === 0 ? (
        <EmptyState
          title="No matches"
          body={`Nothing in the ${preview.sampleSize} most recent transactions matches this rule.`}
        />
      ) : (
        <View>
          <Text
            style={{
              color: theme.colors.textPrimary,
              fontSize: theme.text.caption,
              fontWeight: '600',
              marginBottom: theme.spacing.sm,
            }}
          >
            Matches {preview.matchedCount} of the {preview.sampleSize} most
            recent transactions. Apply now would recategorize{' '}
            {preview.applyEligibleCount} of them (only uncategorized ones).
          </Text>
          {preview.matches.slice(0, MAX_PREVIEW_ROWS).map((match) => (
            <PreviewRow key={match.txn.txnId} match={match} />
          ))}
          {preview.matchedCount > MAX_PREVIEW_ROWS ? (
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: theme.text.caption,
                marginTop: theme.spacing.xs,
              }}
            >
              + {preview.matchedCount - MAX_PREVIEW_ROWS} more matches
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

function PreviewRow({ match }: { match: PreviewMatch }) {
  const theme = useTheme();
  const { txn, eligible, outrankedBy } = match;

  const note = !eligible
    ? 'Already categorized; apply now skips it'
    : outrankedBy
      ? `New transactions: outranked by "${outrankedBy.pattern}"`
      : null;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: theme.colors.surfaceAlt,
          borderRadius: theme.radius.sm,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          marginBottom: theme.spacing.xs,
        },
      ]}
    >
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          style={{ color: theme.colors.textPrimary, fontSize: theme.text.body }}
        >
          {txn.payee}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: note ? theme.colors.warning : theme.colors.textSecondary,
            fontSize: theme.text.caption,
            marginTop: 2,
          }}
        >
          {formatTxnDate(txn.date)}
          {note ? ` -- ${note}` : ''}
        </Text>
      </View>
      <CurrencyAmount
        amountMinor={txn.amountMinor}
        currency={txn.currency}
        size="sm"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  rowText: { flex: 1, marginRight: 8 },
});
