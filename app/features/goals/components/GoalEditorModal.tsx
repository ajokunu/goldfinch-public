/**
 * Create / edit a savings goal (P7-2). Funding mode picks the progress
 * source: 'linked-account' (progress = that account's balance, currency
 * inherited from the account) or 'manual' (progress = contribution sum,
 * currency typed at creation). Currency is fixed after creation (the PATCH
 * contract carries no currency); the target amount parses at the goal
 * currency's minor-unit digits (P7-7).
 *
 * Editing carries the item version for the API's optimistic lock; a
 * VERSION_CONFLICT triggers a refetch (wired in the shared mutation hooks)
 * and an inline explanation.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type {
  AccountDto,
  CreateGoalRequest,
  CurrencyCode,
  GoalDto,
  GoalFundingMode,
  PatchGoalRequest,
} from '@goldfinch/shared/types';
import { minorUnitDigits } from '@goldfinch/shared/money';

import { ModalSheet } from '../../../src/ui/ModalSheet';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { useT } from '../../../src/i18n';
import { useCreateGoal, usePatchGoal } from '../../../src/api/mutations';
import { errorMessage } from '../lib/errors';
import { isZeroDecimal, parseAmountInput, parseCurrencyCodeInput } from '../lib/inputs';
import { parseTargetDateInput } from '../lib/projection';
import { useAccountsQuery } from '../hooks/useGoalsQueries';
import { AccountPickerModal } from './AccountPickerModal';
import { Button } from './Buttons';
import { FormField } from './FormField';
import { SegmentedTabs } from './SegmentedTabs';

export interface GoalEditorTarget {
  /** Present when editing an existing goal; absent when creating. */
  goal?: GoalDto;
}

export interface GoalEditorModalProps {
  target: GoalEditorTarget | null;
  onClose: () => void;
}

interface FieldErrors {
  name?: string;
  target?: string;
  account?: string;
  currency?: string;
  date?: string;
}

export function GoalEditorModal({ target, onClose }: GoalEditorModalProps) {
  const theme = useTheme();
  const t = useT();
  const createGoal = useCreateGoal();
  const patchGoal = usePatchGoal();
  const accountsQuery = useAccountsQuery();

  const [nameText, setNameText] = useState('');
  const [targetText, setTargetText] = useState('');
  const [mode, setMode] = useState<GoalFundingMode>('linked-account');
  const [linkedAccountId, setLinkedAccountId] = useState<string | null>(null);
  const [currencyText, setCurrencyText] = useState('USD');
  const [dateText, setDateText] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Re-seed local form state each time the modal opens for a target.
  useEffect(() => {
    if (!target) return;
    const goal = target.goal;
    setNameText(goal ? goal.name : '');
    setTargetText(goal ? goal.target : '');
    setMode(goal ? goal.fundingMode : 'linked-account');
    setLinkedAccountId(goal?.linkedAccountId ?? null);
    setCurrencyText(goal ? goal.currency : 'USD');
    setDateText(goal?.targetDate ?? '');
    setFieldErrors({});
    setSubmitError(null);
    setPickerOpen(false);
  }, [target]);

  if (!target) return null;
  const goal = target.goal;
  const isEdit = goal !== undefined;
  const busy = createGoal.isPending || patchGoal.isPending;

  const modeOptions: ReadonlyArray<{ key: GoalFundingMode; label: string }> = [
    { key: 'linked-account', label: 'Linked account' },
    { key: 'manual', label: t('Manual') },
  ];

  const accounts = accountsQuery.data?.items ?? [];
  const linkedAccount: AccountDto | undefined = accounts.find(
    (account) => account.accountId === linkedAccountId,
  );

  /**
   * The currency whose minor-unit digits govern target parsing: fixed for an
   * existing goal; the picked account's for a new linked goal; the typed code
   * for a new manual goal (2-digit fallback until it is valid).
   */
  const effectiveCurrency: CurrencyCode | null = isEdit
    ? goal.currency
    : mode === 'linked-account'
      ? (linkedAccount?.currency ?? null)
      : parseCurrencyCodeInput(currencyText);
  const digits = effectiveCurrency ? minorUnitDigits(effectiveCurrency) : 2;

  const handleSelectAccount = (account: AccountDto) => {
    setLinkedAccountId(account.accountId);
    setPickerOpen(false);
  };

  const handleSave = () => {
    const errors: FieldErrors = {};
    const trimmedName = nameText.trim();
    if (trimmedName === '') errors.name = 'Give the goal a name.';

    const parsedTarget = parseAmountInput(targetText, digits);
    if (parsedTarget === null || isZeroDecimal(parsedTarget)) {
      errors.target =
        digits === 0
          ? 'Enter a positive whole amount, like 500000.'
          : 'Enter a positive amount, like 5000 or 5000.50.';
    }

    if (mode === 'linked-account' && linkedAccountId === null) {
      errors.account = 'Choose the account this goal tracks.';
    }

    let currency: CurrencyCode | null = null;
    if (!isEdit && mode === 'manual') {
      currency = parseCurrencyCodeInput(currencyText);
      if (currency === null) errors.currency = 'Enter a 3-letter code, like USD.';
    }

    const parsedDate = parseTargetDateInput(dateText);
    if (!parsedDate.ok) errors.date = 'Use yyyy-mm-dd, like 2027-06-01.';

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || parsedTarget === null || !parsedDate.ok) {
      return;
    }
    setSubmitError(null);

    if (isEdit) {
      const body: PatchGoalRequest = { version: goal.version };
      if (trimmedName !== goal.name) body.name = trimmedName;
      if (parsedTarget !== goal.target) body.target = parsedTarget;
      const previousDate = goal.targetDate ?? null;
      const nextDate = parsedDate.value ?? null;
      if (nextDate !== previousDate) body.targetDate = nextDate;
      if (mode !== goal.fundingMode) {
        body.fundingMode = mode;
        // Switching to linked requires the account; to manual, detaches it.
        body.linkedAccountId = mode === 'linked-account' ? linkedAccountId : null;
      } else if (
        mode === 'linked-account' &&
        linkedAccountId !== (goal.linkedAccountId ?? null)
      ) {
        body.linkedAccountId = linkedAccountId;
      }

      // Nothing changed: closing is the honest no-op (no spurious version bump).
      if (Object.keys(body).length === 1) {
        onClose();
        return;
      }
      patchGoal.mutate(
        { goalId: goal.goalId, body },
        {
          onSuccess: onClose,
          onError: (error) => setSubmitError(errorMessage(error)),
        },
      );
    } else {
      const body: CreateGoalRequest = {
        name: trimmedName,
        target: parsedTarget,
        fundingMode: mode,
      };
      if (mode === 'linked-account' && linkedAccountId !== null) {
        // Currency omitted: the server inherits the account's currency.
        body.linkedAccountId = linkedAccountId;
      }
      if (mode === 'manual' && currency !== null) body.currency = currency;
      if (parsedDate.value !== undefined) body.targetDate = parsedDate.value;
      createGoal.mutate(body, {
        onSuccess: onClose,
        onError: (error) => setSubmitError(errorMessage(error)),
      });
    }
  };

  return (
    <>
      {/* The editor sheet yields to the picker sheet while it is open (the
          established pattern from features/budget: never two visible Modals
          at once); the form state persists underneath. */}
      <ModalSheet
        visible={!pickerOpen}
        title={isEdit ? `Edit goal: ${goal.name}` : t('New goal')}
        onClose={onClose}
        footer={
          <>
            <Button
              label={t('Cancel')}
              variant="secondary"
              onPress={onClose}
              disabled={busy}
              style={styles.footerButton}
            />
            <Button
              label={isEdit ? t('Save changes') : 'Create goal'}
              onPress={handleSave}
              loading={busy}
              disabled={busy}
              style={styles.footerButton}
            />
          </>
        }
      >
        <FormField
          label="Name"
          value={nameText}
          onChangeText={setNameText}
          placeholder="Emergency fund"
          autoFocus={!isEdit}
          error={fieldErrors.name ?? null}
        />

        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 11,
            fontWeight: '700',
            fontFamily: theme.fonts.sansSet.bold,
            textTransform: 'uppercase',
            letterSpacing: 1.1,
            marginBottom: 6,
          }}
        >
          Funding
        </Text>
        <View style={{ marginBottom: theme.spacing.xs }}>
          <SegmentedTabs options={modeOptions} value={mode} onChange={setMode} />
        </View>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.text.caption,
            marginBottom: theme.spacing.md,
          }}
        >
          {mode === 'linked-account'
            ? 'Progress tracks the linked account balance.'
            : 'Progress is the sum of contributions you record here.'}
        </Text>

        {mode === 'linked-account' ? (
          <View style={{ marginBottom: theme.spacing.md }}>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: 11,
                fontWeight: '700',
                fontFamily: theme.fonts.sansSet.bold,
                textTransform: 'uppercase',
                letterSpacing: 1.1,
                marginBottom: 6,
              }}
            >
              Linked account
            </Text>
            <Pressable
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Choose account"
              style={({ pressed }) => [
                styles.accountRow,
                {
                  backgroundColor: theme.colors.surfaceAlt,
                  borderColor: fieldErrors.account
                    ? theme.colors.danger
                    : theme.colors.border,
                  borderRadius: theme.radius.sm,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm + theme.spacing.xs,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.accountLabel,
                  {
                    color: linkedAccountId
                      ? theme.colors.textPrimary
                      : theme.colors.textSecondary,
                    fontSize: theme.text.body,
                  },
                ]}
              >
                {linkedAccount
                  ? `${linkedAccount.name} (${linkedAccount.institution})`
                  : linkedAccountId
                    ? linkedAccountId
                    : 'Choose account'}
              </Text>
              <ChevronRight size={18} color={theme.colors.textSecondary} />
            </Pressable>
            {fieldErrors.account ? (
              <Text
                style={{
                  color: theme.colors.danger,
                  fontSize: theme.text.caption,
                  marginTop: theme.spacing.xs,
                }}
              >
                {fieldErrors.account}
              </Text>
            ) : null}
          </View>
        ) : isEdit ? (
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: theme.text.caption,
              marginBottom: theme.spacing.md,
            }}
          >
            Currency: {goal.currency} (fixed when the goal was created)
          </Text>
        ) : (
          <FormField
            label="Currency"
            value={currencyText}
            onChangeText={setCurrencyText}
            placeholder="USD"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={3}
            error={fieldErrors.currency ?? null}
          />
        )}

        <FormField
          label={`Target amount${effectiveCurrency ? ` (${effectiveCurrency})` : ''}`}
          value={targetText}
          onChangeText={setTargetText}
          placeholder={digits === 0 ? '500000' : '5000.00'}
          keyboardType="decimal-pad"
          error={fieldErrors.target ?? null}
        />

        <FormField
          label="Target date (optional)"
          value={dateText}
          onChangeText={setDateText}
          placeholder="2027-06-01"
          autoCorrect={false}
          hint="yyyy-mm-dd; leave blank for no deadline."
          error={fieldErrors.date ?? null}
        />

        {submitError ? (
          <Text
            accessibilityRole="alert"
            style={{
              color: theme.colors.danger,
              fontSize: theme.text.caption,
              marginBottom: theme.spacing.md,
            }}
          >
            {submitError}
          </Text>
        ) : null}
      </ModalSheet>

      <AccountPickerModal
        visible={pickerOpen}
        currentAccountId={linkedAccountId}
        onSelect={handleSelectAccount}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  accountRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  accountLabel: { flex: 1, paddingRight: 8 },
  footerButton: { flex: 1 },
});
