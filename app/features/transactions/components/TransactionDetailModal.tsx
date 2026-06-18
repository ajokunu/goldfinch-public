/**
 * Transaction detail sheet (screens.md 2.5 / components.md 6.1), on the
 * shared ModalSheet scaffold: hero (tok + payee + 30px mono amount +
 * pending badge), category chip-grid, live-backed "Always tag" rule panel,
 * facts list, note row, attachments, sticky Save footer.
 *
 * Data flow is unchanged from the pre-restyle modal: the parent passes the
 * LIVE cache item, and commits go through the existing
 * useCategorizeTransaction() (PATCH /transactions/{txnId}, optimistic
 * update + 409 isVersionConflict rollback -- preserved verbatim). The chip
 * grid stages a category locally; Save fires the PATCH (with the note when
 * dirty -- the endpoint requires categoryId, so notes still need a
 * category, exactly as before).
 *
 * "Always tag" (live-backed): when the staged category differs and the
 * switch stays on, a successful PATCH is followed by POST /rules
 * (exact-payee, lowercased pattern) + POST /rules/{ruleId}/apply through
 * the shared rule mutations. Rule failures log
 * (context: transactions.detail.createRule) and surface a toast error via
 * onSaved -- the category PATCH is never rolled back by a rule failure.
 *
 * lastEditedBy carries a Cognito sub, which the client can only resolve to
 * "you" vs "another household member" (no profile-lookup route exists).
 * The attachments section closes this sheet (via its onBeforeNavigate)
 * before opening the full-screen viewer, because a route pushed underneath
 * an open RN <Modal> would be invisible on native.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, Sparkles, StickyNote } from 'lucide-react-native';
import type { TransactionDto } from '@goldfinch/shared/types';

import {
  alwaysTagAs,
  createsRuleForFuture,
  useLang,
  useT,
} from '../../../src/i18n';
import { useApplyRule, useCreateRule } from '../../../src/api/mutations';
import { formatDateHeading, isoDateDaysAgo, toIsoDate } from '../../../src/lib/dates';
import { logger } from '../../../src/lib/logger';
import { Button } from '../../../src/ui/Button';
import { CategoryIcon } from '../../../src/ui/icons';
import { mixColor } from '../../../src/ui/mixColor';
import { useHaptics } from '../../../src/ui/motion';
import { ModalSheet } from '../../../src/ui/ModalSheet';
import { Money } from '../../../src/ui/Money';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { AttachmentsSection } from '../../attachments/components/AttachmentsSection';
import {
  attributionLabel,
  useCurrentUserSub,
} from '../../attachments/hooks/useCurrentUserSub';
import {
  isVersionConflict,
  useCategorizeTransaction,
} from '../hooks/useCategorizeTransaction';
import { useActiveCategories, useCategoryNames } from '../hooks/useLookups';
import { dayHeadingKind, isPositiveDecimal } from '../lib/display';
import { FilterChip } from './FilterChip';
import { PendingBadge } from './PendingBadge';

/** Outcome the parent turns into the confirmation toast (screens.md 2.5). */
export type DetailSaveResult =
  | { kind: 'plain'; categoryName: string }
  | { kind: 'rule'; payee: string; categoryName: string }
  | { kind: 'ruleError'; categoryName: string }
  | { kind: 'note'; cleared: boolean };

export interface TransactionDetailModalProps {
  /** Live item from the list cache; null/undefined closes the sheet. */
  txn: TransactionDto | null | undefined;
  /** Resolved account display name ('' until accounts load). */
  accountName: string;
  onClose: () => void;
  /** Fired after a successful save (and rule outcome) for the toast. */
  onSaved: (result: DetailSaveResult) => void;
}

function mutationErrorMessage(error: Error): string {
  if (isVersionConflict(error)) {
    return 'This transaction was changed elsewhere and has been refreshed. Try again.';
  }
  return error.message || 'The change could not be saved. Try again.';
}

function FactRow({
  label,
  first,
  children,
}: {
  label: string;
  first?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.factRow,
        {
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.line,
        },
      ]}
    >
      <Text
        style={{
          color: theme.colors.dim,
          fontSize: 13.5,
          fontFamily: theme.fonts.sans,
        }}
      >
        {label}
      </Text>
      <View style={styles.factValue}>{children}</View>
    </View>
  );
}

export function TransactionDetailModal({
  txn,
  accountName,
  onClose,
  onSaved,
}: TransactionDetailModalProps) {
  const theme = useTheme();
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const categories = useActiveCategories();
  const categoryNames = useCategoryNames();
  const categorize = useCategorizeTransaction();
  const createRule = useCreateRule();
  const applyRule = useApplyRule();
  const currentSub = useCurrentUserSub();
  const haptics = useHaptics();

  const [draftCategoryId, setDraftCategoryId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [learnEnabled, setLearnEnabled] = useState(true);
  const [ruleBusy, setRuleBusy] = useState(false);

  // Re-seed the local drafts whenever a different transaction opens.
  const txnId = txn?.txnId ?? null;
  const txnNote = txn?.note ?? '';
  const txnCategoryId = txn?.categoryId ?? null;
  useEffect(() => {
    setNoteDraft(txnNote);
    setDraftCategoryId(txnCategoryId);
    setLearnEnabled(true);
    setRuleBusy(false);
    categorize.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per txn only
  }, [txnId]);

  const busy = categorize.isPending || ruleBusy;

  let body: ReactNode = null;
  let footer: ReactNode | undefined;

  if (txn) {
    const payee = txn.payee || txn.description || 'Unknown payee';
    const positive = isPositiveDecimal(txn.amount);

    const effectiveCategoryId = draftCategoryId ?? txn.categoryId;
    const categoryChanged =
      draftCategoryId !== null && draftCategoryId !== txn.categoryId;
    const trimmedNote = noteDraft.trim();
    const noteChanged = trimmedNote !== (txn.note ?? '').trim();
    // Notes are independent of categorization: a note can be added to an
    // UNcategorized transaction, so editing never requires a category.
    const canSave = !busy && (categoryChanged || noteChanged);

    const learnVisible =
      categoryChanged && !txn.isTransfer && txn.payee.trim().length > 0;
    const learnArmed = learnVisible && learnEnabled;

    const draftCategoryName = effectiveCategoryId
      ? (categoryNames.get(effectiveCategoryId) ?? effectiveCategoryId)
      : null;

    // P10: the effective category's chosen icon/color, for the hero well.
    const effectiveCategory = effectiveCategoryId
      ? categories.find((c) => c.categoryId === effectiveCategoryId)
      : undefined;

    const todayIso = toIsoDate(new Date());
    const headingKind = dayHeadingKind(txn.date, todayIso, isoDateDaysAgo(1));
    const dateLabel =
      headingKind === 'today'
        ? t('Today')
        : headingKind === 'yesterday'
          ? t('Yesterday')
          : formatDateHeading(txn.date);

    const commit = () => {
      if (busy || !canSave) return;

      // Note-only edit (no category change): send just the note. An absent
      // categoryId leaves the category + spend index untouched server-side, so
      // this works even on an UNcategorized transaction.
      if (!categoryChanged) {
        categorize.mutate(
          { txnId: txn.txnId, date: txn.date, version: txn.version, note: trimmedNote },
          {
            onSuccess: () => {
              haptics.confirmTick();
              onSaved({ kind: 'note', cleared: trimmedNote === '' });
              onClose();
            },
          },
        );
        return;
      }

      // Category (re)assignment (optionally carrying a note and a learned rule).
      const categoryId = effectiveCategoryId;
      if (!categoryId) return;
      const wantsRule = learnArmed;
      const rulePayee = txn.payee;
      categorize.mutate(
        {
          txnId: txn.txnId,
          date: txn.date,
          categoryId,
          version: txn.version,
          ...(noteChanged ? { note: trimmedNote } : {}),
        },
        {
          onSuccess: () => {
            // Light tick on categorize/confirm (P9-2 item 10); the hook
            // no-ops on web and under the motion kill switches.
            haptics.confirmTick();
            const categoryName = categoryNames.get(categoryId) ?? categoryId;
            if (!wantsRule) {
              onSaved({ kind: 'plain', categoryName });
              onClose();
              return;
            }
            setRuleBusy(true);
            void (async () => {
              try {
                const rule = await createRule.mutateAsync({
                  matchType: 'exact',
                  pattern: rulePayee.toLowerCase(),
                  categoryId,
                });
                await applyRule.mutateAsync({ ruleId: rule.ruleId });
                onSaved({ kind: 'rule', payee: rulePayee, categoryName });
              } catch (error) {
                // The category PATCH already succeeded and is never rolled
                // back by a rule failure (screens.md 2.5).
                logger.error('rule creation after categorization failed', {
                  context: 'transactions.detail.createRule',
                  txnId: txn.txnId,
                  payee: rulePayee,
                  categoryId,
                  error,
                });
                onSaved({ kind: 'ruleError', categoryName });
              } finally {
                setRuleBusy(false);
                onClose();
              }
            })();
          },
        },
      );
    };

    // Close the sheet first: a route pushed underneath an open RN <Modal>
    // would be invisible on native.
    const openAccountDetail = () => {
      onClose();
      router.push({
        pathname: '/accounts/[accountId]',
        params: { accountId: txn.accountId },
      });
    };

    const eyebrowStyle: StyleProp<TextStyle> = [
      styles.eyebrow,
      { color: theme.colors.dim, fontFamily: theme.fonts.sans },
    ];

    footer = (
      <Button
        label={learnArmed ? t('Save & teach GoldFinch') : t('Save changes')}
        icon={learnArmed ? Sparkles : undefined}
        onPress={commit}
        loading={busy}
        disabled={!canSave}
        style={styles.footerButton}
      />
    );

    body = (
      <View>
        {/* Hero */}
        <View style={styles.hero}>
          {txn.isTransfer ? (
            <CategoryIcon categoryId="transfers" neutral />
          ) : (
            <CategoryIcon
              categoryId={effectiveCategoryId}
              categoryName={draftCategoryName}
              iconKey={effectiveCategory?.iconKey}
              colorKey={effectiveCategory?.color}
            />
          )}
          <Text
            style={[
              styles.heroPayee,
              { color: theme.colors.text, fontFamily: theme.fonts.sans },
            ]}
            numberOfLines={1}
          >
            {payee}
          </Text>
          <Money
            amount={txn.amount}
            currency={txn.currency}
            signDisplay={positive ? 'always' : 'auto'}
            style={{
              fontSize: 30,
              fontWeight: '700',
              fontFamily: theme.fonts.mono,
              letterSpacing: -0.6,
              color: positive ? theme.colors.pos : theme.colors.text,
            }}
          />
          {txn.pending ? <PendingBadge /> : null}
        </View>

        {/* Category chip-grid */}
        <Text accessibilityRole="header" style={eyebrowStyle}>
          {t('Category')}
        </Text>
        <View style={styles.chipGrid}>
          {categories.map((category) => (
            <FilterChip
              key={category.categoryId}
              label={category.name}
              categoryId={category.categoryId}
              categoryName={category.name}
              categoryIconKey={category.iconKey}
              categoryColorKey={category.color}
              active={effectiveCategoryId === category.categoryId}
              onPress={() => setDraftCategoryId(category.categoryId)}
              disabled={busy}
            />
          ))}
        </View>

        {/* Always-tag rule panel (live-backed) */}
        {learnVisible && draftCategoryName ? (
          <Pressable
            onPress={() => setLearnEnabled((value) => !value)}
            disabled={busy}
            accessibilityRole="switch"
            accessibilityState={{ checked: learnEnabled, disabled: busy }}
            accessibilityLabel={alwaysTagAs(lang, txn.payee, draftCategoryName)}
            style={[
              styles.learnRow,
              {
                borderRadius: theme.radius.control,
                backgroundColor: mixColor(
                  theme.colors.accent,
                  0.09,
                  theme.colors.surface,
                ),
                borderColor: mixColor(
                  theme.colors.accent,
                  0.3,
                  theme.colors.surface,
                ),
              },
            ]}
          >
            <View style={styles.learnText}>
              <View style={styles.learnTitleRow}>
                <Sparkles
                  size={14}
                  strokeWidth={2.2}
                  color={theme.colors.accent}
                />
                <Text
                  style={[
                    styles.learnTitle,
                    { color: theme.colors.text, fontFamily: theme.fonts.sans },
                  ]}
                  numberOfLines={2}
                >
                  {alwaysTagAs(lang, txn.payee, draftCategoryName)}
                </Text>
              </View>
              <Text
                style={[
                  styles.learnSub,
                  { color: theme.colors.dim, fontFamily: theme.fonts.sans },
                ]}
              >
                {createsRuleForFuture(lang)}
              </Text>
            </View>
            <Switch
              value={learnEnabled}
              onValueChange={setLearnEnabled}
              disabled={busy}
              trackColor={{ true: theme.colors.accent }}
              importantForAccessibility="no"
            />
          </Pressable>
        ) : null}

        {/* Facts list */}
        <View
          style={[
            styles.facts,
            {
              backgroundColor: theme.colors.surfaceAlt,
              borderRadius: theme.radius.control,
            },
          ]}
        >
          <FactRow label={t('Date')} first>
            <Text
              style={[
                styles.factText,
                { color: theme.colors.text, fontFamily: theme.fonts.sans },
              ]}
            >
              {dateLabel}
            </Text>
          </FactRow>
          <FactRow label={t('Account')}>
            <Pressable
              onPress={openAccountDetail}
              accessibilityRole="button"
              accessibilityLabel={`Open account ${accountName || txn.accountId}`}
              style={({ pressed }) => [
                styles.accountLink,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text
                style={[
                  styles.factText,
                  { color: theme.colors.text, fontFamily: theme.fonts.sans },
                ]}
                numberOfLines={1}
              >
                {accountName || txn.accountId}
              </Text>
              <ChevronRight size={16} color={theme.colors.faint} />
            </Pressable>
          </FactRow>
          <FactRow label={t('Status')}>
            <Text
              style={[
                styles.factText,
                { color: theme.colors.text, fontFamily: theme.fonts.sans },
              ]}
            >
              {txn.pending ? t('Pending') : t('Posted')}
            </Text>
          </FactRow>
          {txn.description ? (
            <FactRow label="Bank description">
              <Text
                style={[
                  styles.factText,
                  { color: theme.colors.text, fontFamily: theme.fonts.sans },
                ]}
                numberOfLines={2}
              >
                {txn.description}
              </Text>
            </FactRow>
          ) : null}
          {txn.memo ? (
            <FactRow label="Memo">
              <Text
                style={[
                  styles.factText,
                  { color: theme.colors.text, fontFamily: theme.fonts.sans },
                ]}
                numberOfLines={2}
              >
                {txn.memo}
              </Text>
            </FactRow>
          ) : null}
          {txn.isTransfer ? (
            <View
              style={[
                styles.factNote,
                { borderTopColor: theme.colors.line },
              ]}
            >
              <Text
                style={{
                  color: theme.colors.dim,
                  fontSize: 12,
                  fontFamily: theme.fonts.sans,
                }}
              >
                Transfer between accounts (excluded from spending)
              </Text>
            </View>
          ) : null}
          {txn.lastEditedBy ? (
            <View
              style={[
                styles.factNote,
                { borderTopColor: theme.colors.line },
              ]}
            >
              <Text
                style={{
                  color: theme.colors.dim,
                  fontSize: 12,
                  fontFamily: theme.fonts.sans,
                }}
              >
                {attributionLabel('Edited', txn.lastEditedBy, currentSub)}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Note */}
        <Text accessibilityRole="header" style={eyebrowStyle}>
          {t('Note')}
        </Text>
        <View
          style={[
            styles.noteRow,
            {
              backgroundColor: theme.colors.surfaceAlt,
              borderRadius: theme.radius.control,
            },
          ]}
        >
          <StickyNote
            size={17}
            strokeWidth={2}
            color={theme.colors.dim}
            style={styles.noteIcon}
          />
          <TextInput
            value={noteDraft}
            onChangeText={setNoteDraft}
            placeholder={t('Add a note')}
            placeholderTextColor={theme.colors.faint}
            editable={!busy}
            multiline
            accessibilityLabel="Transaction note"
            style={[
              styles.noteInput,
              { color: theme.colors.text, fontFamily: theme.fonts.sans },
            ]}
          />
        </View>

        {/* Attachments (existing feature section, hosted as before) */}
        <View style={styles.attachments}>
          <AttachmentsSection txnId={txn.txnId} onBeforeNavigate={onClose} />
        </View>

        {categorize.isError ? (
          <Text
            style={{
              color: theme.colors.neg,
              fontSize: 12.5,
              marginTop: 12,
              fontFamily: theme.fonts.sans,
            }}
          >
            {mutationErrorMessage(categorize.error)}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <ModalSheet
      visible={txn != null}
      title={t('Transaction')}
      onClose={onClose}
      footer={footer}
    >
      {body}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
    paddingBottom: 16,
  },
  heroPayee: { fontSize: 18, fontWeight: '700', maxWidth: '90%' },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginTop: 14,
    marginBottom: 6,
  },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  learnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    padding: 13,
    borderWidth: 1,
  },
  learnText: { flex: 1, gap: 3 },
  learnTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  learnTitle: { fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
  learnSub: { fontSize: 11.5 },
  facts: { marginTop: 18, paddingVertical: 4, paddingHorizontal: 14 },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
  },
  factValue: { flexShrink: 1, alignItems: 'flex-end' },
  factText: { fontSize: 13.5, fontWeight: '600', textAlign: 'right' },
  factNote: {
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  accountLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  noteIcon: { marginTop: 3 },
  noteInput: {
    flex: 1,
    fontSize: 14.5,
    minHeight: 44,
    padding: 0,
    textAlignVertical: 'top',
  },
  attachments: { marginTop: 18 },
  footerButton: { flex: 1 },
});
