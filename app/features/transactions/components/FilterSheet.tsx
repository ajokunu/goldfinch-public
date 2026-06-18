/**
 * Activity filter sheet (screens.md 2.1): the restyled successor to the old
 * SelectModal pickers, on the shared ModalSheet scaffold. Two radio groups
 * -- date-range presets (existing DateRangePresetId set) and the account
 * list (All + one row per account). Selection applies immediately; the
 * sheet stays open so both filters can be adjusted in one visit, and the
 * footer Close button (plus handle/backdrop) dismisses it.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import type { AccountDto } from '@goldfinch/shared/types';

import { useT } from '../../../src/i18n';
import { Button } from '../../../src/ui/Button';
import { AccountTypeIcon } from '../../../src/ui/icons';
import { ModalSheet } from '../../../src/ui/ModalSheet';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  DATE_RANGE_PRESETS,
  type DateRangePresetId,
} from '../lib/dateRanges';

export interface FilterSheetProps {
  visible: boolean;
  onClose: () => void;
  preset: DateRangePresetId;
  onPresetChange: (preset: DateRangePresetId) => void;
  accountId: string | null;
  onAccountIdChange: (accountId: string | null) => void;
  accounts: readonly AccountDto[];
}

function SectionLabel({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[
        styles.eyebrow,
        { color: theme.colors.dim, fontFamily: theme.fonts.sans },
      ]}
    >
      {children}
    </Text>
  );
}

function OptionRow({
  label,
  detail,
  selected,
  first,
  leading,
  onPress,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  first: boolean;
  /** Identity well (e.g. AccountTypeIcon on account rows). */
  leading?: ReactNode;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [
        styles.option,
        {
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.line,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {leading ? <View style={styles.optionLeading}>{leading}</View> : null}
      <View style={styles.optionText}>
        <Text
          style={{
            color: theme.colors.text,
            fontSize: 14.5,
            fontWeight: selected ? '600' : '400',
            fontFamily: theme.fonts.sans,
          }}
          numberOfLines={1}
        >
          {label}
        </Text>
        {detail ? (
          <Text
            style={{
              color: theme.colors.dim,
              fontSize: 12,
              marginTop: 2,
              fontFamily: theme.fonts.sans,
            }}
            numberOfLines={1}
          >
            {detail}
          </Text>
        ) : null}
      </View>
      {selected ? <Check size={18} color={theme.colors.accent} /> : null}
    </Pressable>
  );
}

export function FilterSheet({
  visible,
  onClose,
  preset,
  onPresetChange,
  accountId,
  onAccountIdChange,
  accounts,
}: FilterSheetProps) {
  const t = useT();

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      footer={
        <Button
          label={t('Close')}
          variant="ghost"
          onPress={onClose}
          style={styles.footerButton}
        />
      }
    >
      <SectionLabel>{t('Date')}</SectionLabel>
      <View accessibilityRole="radiogroup">
        {DATE_RANGE_PRESETS.map((option, index) => (
          <OptionRow
            key={option.id}
            label={option.label}
            selected={option.id === preset}
            first={index === 0}
            onPress={() => onPresetChange(option.id)}
          />
        ))}
      </View>

      <SectionLabel>{t('Account')}</SectionLabel>
      <View accessibilityRole="radiogroup">
        <OptionRow
          label={t('All')}
          selected={accountId === null}
          first
          onPress={() => onAccountIdChange(null)}
        />
        {accounts.map((account) => (
          <OptionRow
            key={account.accountId}
            label={account.name}
            detail={account.institution}
            selected={accountId === account.accountId}
            first={false}
            leading={
              <AccountTypeIcon
                accountTypeId={account.accountTypeId}
                size={30}
                iconSize={16}
              />
            }
            onPress={() => onAccountIdChange(account.accountId)}
          />
        ))}
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginTop: 14,
    marginBottom: 6,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    gap: 8,
  },
  optionText: { flex: 1 },
  optionLeading: { flexShrink: 0 },
  footerButton: { flex: 1 },
});
