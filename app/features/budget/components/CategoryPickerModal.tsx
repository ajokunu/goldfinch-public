/**
 * Category picker for the recategorize and create-budget flows: non-archived
 * categories grouped by type then group, with the category's identity icon
 * well (CategoryIcon, ops/design-spec/icons.md) and a check mark on the
 * current assignment. Restyled to the sheet row anatomy (design spec
 * screens.md 3.5); grouping and states preserved.
 */
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import type { CategoryDto, CategoryType } from '@goldfinch/shared/types';

import { useT } from '../../../src/i18n';
import { CategoryIcon } from '../../../src/ui/icons';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { CATEGORY_TYPE_LABELS, groupCategories } from '../lib/grouping';
import { useCategoriesQuery } from '../hooks/useBudgetQueries';
import { ErrorState, LoadingState } from '../../../src/ui/States';
import { ModalSheet } from '../../../src/ui/ModalSheet';

const TYPE_ORDER: CategoryType[] = ['EXPENSE', 'INCOME', 'TRANSFER'];

export interface CategoryPickerModalProps {
  visible: boolean;
  currentCategoryId: string | null;
  onSelect: (category: CategoryDto) => void;
  onClose: () => void;
}

export function CategoryPickerModal({
  visible,
  currentCategoryId,
  onSelect,
  onClose,
}: CategoryPickerModalProps) {
  const theme = useTheme();
  const t = useT();
  const categoriesQuery = useCategoriesQuery();

  const sectionsByType = useMemo(() => {
    const items = (categoriesQuery.data?.items ?? []).filter(
      (category) => !category.archived,
    );
    return TYPE_ORDER.map((type) => ({
      type,
      sections: groupCategories(items.filter((c) => c.type === type)),
    })).filter((entry) => entry.sections.length > 0);
  }, [categoriesQuery.data]);

  return (
    <ModalSheet visible={visible} title={t('Category')} onClose={onClose}>
      {categoriesQuery.isPending ? (
        <LoadingState />
      ) : categoriesQuery.isError ? (
        <ErrorState
          message="Could not load categories."
          onRetry={() => void categoriesQuery.refetch()}
        />
      ) : (
        sectionsByType.map(({ type, sections }) => (
          <View key={type} style={{ marginBottom: theme.spacing.md }}>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: 11,
                fontFamily: theme.fonts.sansSet.bold,
                textTransform: 'uppercase',
                letterSpacing: 1.1,
                marginBottom: theme.spacing.xs,
              }}
            >
              {CATEGORY_TYPE_LABELS[type]}
            </Text>
            {sections.map((section) => (
              <View key={section.key}>
                {sections.length > 1 ? (
                  <Text
                    style={{
                      color: theme.colors.textSecondary,
                      fontSize: 12,
                      fontFamily: theme.fonts.sans,
                      marginTop: theme.spacing.xs,
                      marginBottom: theme.spacing.xs,
                    }}
                  >
                    {section.label}
                  </Text>
                ) : null}
                {section.categories.map((category) => {
                  const selected = category.categoryId === currentCategoryId;
                  return (
                    <Pressable
                      key={category.categoryId}
                      onPress={() => onSelect(category)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={category.name}
                      style={({ pressed }) => [
                        styles.row,
                        {
                          backgroundColor: theme.colors.surfaceAlt,
                          borderRadius: theme.radius.control,
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          marginBottom: 6,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <View style={styles.tile}>
                        <CategoryIcon
                          categoryId={category.categoryId}
                          categoryName={category.name}
                          iconKey={category.iconKey}
                          colorKey={category.color}
                          size={26}
                          iconSize={15}
                        />
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.rowLabel,
                          {
                            color: theme.colors.textPrimary,
                            fontFamily: selected
                              ? theme.fonts.sansSet.bold
                              : theme.fonts.sans,
                          },
                        ]}
                      >
                        {category.name}
                      </Text>
                      {selected ? (
                        <Check size={18} color={theme.colors.accent} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        ))
      )}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  tile: { marginRight: 10, flexShrink: 0 },
  rowLabel: { flex: 1, fontSize: 14.5 },
});
