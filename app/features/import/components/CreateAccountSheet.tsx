/**
 * Inline manual-account creation (P7-6): POST /accounts via the shell's
 * useCreateAccount mutation. On success the new account is handed back to
 * the account step, which selects it as the import target.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { parseCurrencyAmount } from '@goldfinch/shared/money';
import type {
  AccountDto,
  AccountType,
  CreateAccountRequest,
  CurrencyCode,
  DecimalString,
} from '@goldfinch/shared/types';

import { useCreateAccount } from '../../../src/api/mutations';
import { logger } from '../../../src/lib/logger';
import { ModalSheet } from '../../../src/ui/ModalSheet';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { errorMessage } from '../lib/errors';
import { Button } from './Buttons';
import { FormField } from './FormField';

const ACCOUNT_TYPES: readonly AccountType[] = [
  'checking',
  'savings',
  'credit',
  'investment',
  'loan',
  'other',
];

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export interface CreateAccountSheetProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (account: AccountDto) => void;
}

export function CreateAccountSheet({ visible, onClose, onCreated }: CreateAccountSheetProps) {
  const theme = useTheme();
  const createAccount = useCreateAccount();

  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('checking');
  const [currency, setCurrency] = useState('USD');
  const [institution, setInstitution] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    currency?: string;
    openingBalance?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setAccountType('checking');
    setCurrency('USD');
    setInstitution('');
    setOpeningBalance('');
    setFieldErrors({});
    setSubmitError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = () => {
    const trimmedName = name.trim();
    const normalizedCurrency = currency.trim().toUpperCase();
    const trimmedBalance = openingBalance.trim();

    const errors: typeof fieldErrors = {};
    if (trimmedName.length === 0) {
      errors.name = 'Name is required.';
    }
    if (!CURRENCY_PATTERN.test(normalizedCurrency)) {
      errors.currency = 'Use a 3-letter currency code, e.g. USD.';
    }
    if (trimmedBalance.length > 0 && CURRENCY_PATTERN.test(normalizedCurrency)) {
      try {
        parseCurrencyAmount(trimmedBalance, normalizedCurrency);
      } catch (error) {
        errors.openingBalance =
          error instanceof Error && error.message
            ? error.message
            : 'Enter an exact decimal amount, e.g. -123.45.';
      }
    }
    setFieldErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length > 0) return;

    const body: CreateAccountRequest = {
      name: trimmedName,
      accountType,
      currency: normalizedCurrency as CurrencyCode,
      ...(institution.trim().length > 0 ? { institution: institution.trim() } : {}),
      ...(trimmedBalance.length > 0
        ? { openingBalance: trimmedBalance as DecimalString }
        : {}),
    };
    createAccount.mutate(body, {
      onSuccess: (account) => {
        reset();
        onCreated(account);
      },
      onError: (error) => {
        logger.error('manual account creation failed', { error });
        setSubmitError(errorMessage(error));
      },
    });
  };

  return (
    <ModalSheet visible={visible} title="New manual account" onClose={close}>
      <FormField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Cash, Old checking"
        autoFocus
        error={fieldErrors.name ?? null}
      />

      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.caption,
          fontWeight: '600',
          marginBottom: theme.spacing.xs,
        }}
      >
        Type
      </Text>
      <View style={[styles.chips, { marginBottom: theme.spacing.md }]}>
        {ACCOUNT_TYPES.map((type) => {
          const selected = type === accountType;
          return (
            <Pressable
              key={type}
              onPress={() => setAccountType(type)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: selected ? theme.colors.accent : theme.colors.surfaceAlt,
                  borderColor: selected ? theme.colors.accent : theme.colors.border,
                  borderRadius: theme.radius.md,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={{
                  color: selected ? theme.colors.onAccent : theme.colors.textPrimary,
                  fontSize: theme.text.caption,
                  fontWeight: '600',
                }}
              >
                {type}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FormField
        label="Currency"
        value={currency}
        onChangeText={setCurrency}
        autoCapitalize="characters"
        placeholder="USD"
        error={fieldErrors.currency ?? null}
      />
      <FormField
        label="Institution (optional)"
        value={institution}
        onChangeText={setInstitution}
        placeholder="Manual"
      />
      <FormField
        label="Opening balance (optional)"
        value={openingBalance}
        onChangeText={setOpeningBalance}
        keyboardType="numbers-and-punctuation"
        placeholder="0.00"
        error={fieldErrors.openingBalance ?? null}
      />

      {submitError !== null ? (
        <Text
          style={{
            color: theme.colors.danger,
            fontSize: theme.text.body,
            marginBottom: theme.spacing.md,
          }}
        >
          {submitError}
        </Text>
      ) : null}

      <Button
        label="Create account"
        onPress={submit}
        loading={createAccount.isPending}
      />
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
