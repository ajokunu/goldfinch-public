/**
 * Account-type picker sheet (P8-4, ops/PHASE8-DECISIONS.md): every
 * AccountTypeId from the shared ACCOUNT_TYPES metadata (locked display
 * order via ACCOUNT_TYPE_IDS) as a radio row -- phosphor identity well
 * (AccountTypeIcon), label, liability annotation, check on the current
 * effective type. Selection PATCHes optimistically in the parent; the sheet
 * closes immediately so the row reflects the optimistic value behind it.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_IDS,
  type AccountTypeId,
} from '@goldfinch/shared/accountTypes';

import { Button } from '../../../src/ui/Button';
import { AccountTypeIcon } from '../../../src/ui/icons';
import { ModalSheet } from '../../../src/ui/ModalSheet';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { useHover } from '../../../src/ui/useHover';

export interface AccountTypeSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The account's current EFFECTIVE type id. */
  selected: AccountTypeId;
  onSelect: (accountTypeId: AccountTypeId) => void;
}

function TypeRow({
  typeId,
  selected,
  first,
  onPress,
}: {
  typeId: AccountTypeId;
  selected: boolean;
  first: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const meta = ACCOUNT_TYPES[typeId];

  return (
    <Pressable
      onPress={onPress}
      {...hoverProps}
      accessibilityRole="radio"
      accessibilityLabel={meta.label}
      accessibilityState={{ checked: selected }}
      testID={`account-type-option-${typeId}`}
      style={({ pressed }) => [
        styles.row,
        {
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.line,
          backgroundColor: hovered ? theme.colors.surfaceAlt : 'transparent',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <AccountTypeIcon accountTypeId={typeId} size={30} iconSize={16} />
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          style={{
            color: theme.colors.text,
            fontSize: 14.5,
            fontWeight: selected ? '600' : '400',
            fontFamily: theme.fonts.sans,
          }}
        >
          {meta.label}
        </Text>
        {meta.isLiabilityDefault ? (
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.dim,
              fontSize: 12,
              marginTop: 2,
              fontFamily: theme.fonts.sans,
            }}
          >
            Counts against net worth
          </Text>
        ) : null}
      </View>
      {selected ? <Check size={18} color={theme.colors.accent} /> : null}
    </Pressable>
  );
}

export function AccountTypeSheet({
  visible,
  onClose,
  selected,
  onSelect,
}: AccountTypeSheetProps) {
  return (
    <ModalSheet
      visible={visible}
      title="Account type"
      onClose={onClose}
      footer={<Button label="Close" variant="ghost" onPress={onClose} style={styles.footerButton} />}
    >
      <View accessibilityRole="radiogroup">
        {ACCOUNT_TYPE_IDS.map((typeId, index) => (
          <TypeRow
            key={typeId}
            typeId={typeId}
            selected={typeId === selected}
            first={index === 0}
            onPress={() => onSelect(typeId)}
          />
        ))}
      </View>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 4,
    gap: 10,
  },
  rowText: { flex: 1, minWidth: 0 },
  footerButton: { flex: 1 },
});
