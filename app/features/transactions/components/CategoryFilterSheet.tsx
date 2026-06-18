/**
 * Category filter picker (P8-3, ops/PHASE8-DECISIONS.md): the restyled
 * SelectModal successor on the shared ModalSheet scaffold. Active categories
 * grouped Income / Expenses / Transfers (CategoryType order), each row
 * leading with its CategoryIcon identity well; "All categories" clears the
 * filter. Selection applies immediately and closes the sheet -- the parent
 * renders the removable filter chip.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import type { CategoryDto, CategoryType } from '@goldfinch/shared/types';

import { useT, type I18nKey } from '../../../src/i18n';
import { Button } from '../../../src/ui/Button';
import { CategoryIcon } from '../../../src/ui/icons';
import { ModalSheet } from '../../../src/ui/ModalSheet';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { useHover } from '../../../src/ui/useHover';

export interface CategoryFilterSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Active (non-archived) categories, picker-sorted (useActiveCategories). */
  categories: readonly CategoryDto[];
  categoryId: string | null;
  onCategoryIdChange: (categoryId: string | null) => void;
}

/** Display order + headings (I18nKeys) for the CategoryType groups. */
const GROUPS: ReadonlyArray<{ type: CategoryType; label: I18nKey }> = [
  { type: 'INCOME', label: 'Income' },
  { type: 'EXPENSE', label: 'Expenses' },
  { type: 'TRANSFER', label: 'Transfers' },
];

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

function CategoryRow({
  label,
  selected,
  first,
  leading,
  testID,
  onPress,
}: {
  label: string;
  selected: boolean;
  first: boolean;
  leading?: React.ReactNode;
  testID?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      onPress={onPress}
      {...hoverProps}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      testID={testID}
      style={({ pressed }) => [
        styles.option,
        {
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.line,
          backgroundColor: hovered ? theme.colors.surfaceAlt : 'transparent',
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {leading ? <View style={styles.optionLeading}>{leading}</View> : null}
      <Text
        numberOfLines={1}
        style={[
          styles.optionLabel,
          {
            color: theme.colors.text,
            fontWeight: selected ? '600' : '400',
            fontFamily: theme.fonts.sans,
          },
        ]}
      >
        {label}
      </Text>
      {selected ? <Check size={18} color={theme.colors.accent} /> : null}
    </Pressable>
  );
}

export function CategoryFilterSheet({
  visible,
  onClose,
  categories,
  categoryId,
  onCategoryIdChange,
}: CategoryFilterSheetProps) {
  const t = useT();

  const pick = (next: string | null): void => {
    onCategoryIdChange(next);
    onClose();
  };

  return (
    <ModalSheet
      visible={visible}
      title={t('Category')}
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
      <View accessibilityRole="radiogroup">
        <CategoryRow
          label={t('All categories')}
          selected={categoryId === null}
          first
          onPress={() => pick(null)}
        />
        {GROUPS.map((group) => {
          const members = categories.filter(
            (category) => category.type === group.type,
          );
          if (members.length === 0) return null;
          return (
            <View key={group.type}>
              <SectionLabel>{t(group.label)}</SectionLabel>
              {members.map((category, index) => (
                <CategoryRow
                  key={category.categoryId}
                  label={category.name}
                  selected={categoryId === category.categoryId}
                  first={index === 0}
                  testID={`category-filter-option-${category.categoryId}`}
                  leading={
                    <CategoryIcon
                      categoryId={category.categoryId}
                      categoryName={category.name}
                      iconKey={category.iconKey}
                      colorKey={category.color}
                      size={30}
                      iconSize={16}
                    />
                  }
                  onPress={() => pick(category.categoryId)}
                />
              ))}
            </View>
          );
        })}
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
  optionLeading: { flexShrink: 0 },
  optionLabel: { flex: 1, fontSize: 14.5 },
  footerButton: { flex: 1 },
});
