/**
 * One field of the column mapping: a labeled selector that opens a sheet
 * listing every CSV column (with a sample cell from the first data row) plus
 * "Not mapped" for optional fields.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';

import { ModalSheet } from '../../../src/ui/ModalSheet';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { columnLabel } from '../lib/mapping';

export interface ColumnPickerFieldProps {
  label: string;
  required: boolean;
  columnCount: number;
  headerRow: readonly string[] | null;
  /** First data row, for sample values next to each column option. */
  sampleRow: readonly string[] | null;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}

export function ColumnPickerField({
  label,
  required,
  columnCount,
  headerRow,
  sampleRow,
  selectedIndex,
  onSelect,
}: ColumnPickerFieldProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const selectionLabel =
    selectedIndex === null ? 'Not mapped' : columnLabel(selectedIndex, headerRow);
  const missing = required && selectedIndex === null;

  const choose = (index: number | null) => {
    setOpen(false);
    onSelect(index);
  };

  return (
    <View style={{ marginBottom: theme.spacing.sm }}>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.caption,
          fontWeight: '600',
          marginBottom: theme.spacing.xs,
        }}
      >
        {label}
        {required ? ' (required)' : ' (optional)'}
      </Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label} column: ${selectionLabel}`}
        style={({ pressed }) => [
          styles.selector,
          {
            backgroundColor: theme.colors.surfaceAlt,
            borderColor: missing ? theme.colors.danger : theme.colors.border,
            borderRadius: theme.radius.sm,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm + theme.spacing.xs,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={{
            color:
              selectedIndex === null
                ? theme.colors.textSecondary
                : theme.colors.textPrimary,
            fontSize: theme.text.body,
            flex: 1,
          }}
        >
          {selectionLabel}
        </Text>
        <ChevronDown size={18} color={theme.colors.textSecondary} />
      </Pressable>

      <ModalSheet
        visible={open}
        title={`${label} column`}
        onClose={() => setOpen(false)}
      >
        {!required ? (
          <PickerRow
            title="Not mapped"
            sample={null}
            selected={selectedIndex === null}
            onPress={() => choose(null)}
          />
        ) : null}
        {Array.from({ length: columnCount }, (_, index) => (
          <PickerRow
            key={index}
            title={columnLabel(index, headerRow)}
            sample={sampleRow?.[index] ?? null}
            selected={selectedIndex === index}
            onPress={() => choose(index)}
          />
        ))}
      </ModalSheet>
    </View>
  );
}

function PickerRow({
  title,
  sample,
  selected,
  onPress,
}: {
  title: string;
  sample: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.option,
        {
          borderBottomColor: theme.colors.border,
          paddingVertical: theme.spacing.sm + theme.spacing.xs,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.optionText}>
        <Text
          numberOfLines={1}
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.body,
            fontWeight: selected ? '700' : '400',
          }}
        >
          {title}
        </Text>
        {sample !== null && sample.trim().length > 0 ? (
          <Text
            numberOfLines={1}
            style={{
              color: theme.colors.textSecondary,
              fontSize: theme.text.caption,
              marginTop: 2,
            }}
          >
            e.g. {sample}
          </Text>
        ) : null}
      </View>
      {selected ? <Check size={18} color={theme.colors.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  optionText: { flex: 1, marginRight: 8 },
  selector: { alignItems: 'center', borderWidth: 1, flexDirection: 'row' },
});
