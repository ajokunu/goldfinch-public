/**
 * Category picker for the rule editor: non-archived categories grouped by
 * type, each row leading with its identity icon well (CategoryIcon,
 * ops/design-spec/icons.md), with a check mark on the current assignment.
 * Rendered as a nested RN Modal inside the editor sheet (the established
 * pattern -- see the transactions detail modal's SelectModal usage).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import type { CategoryDto } from '@goldfinch/shared/types';

import { CategoryIcon } from '../../../src/ui/icons';
import { ModalSheet } from '../../../src/ui/ModalSheet';
import { ErrorState, LoadingState } from '../../../src/ui/States';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  CATEGORY_TYPE_LABELS,
  useActiveCategoriesByType,
  useCategoriesQuery,
} from '../hooks/useCategories';

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
  const categoriesQuery = useCategoriesQuery();
  const groups = useActiveCategoriesByType();

  return (
    <ModalSheet visible={visible} title="Assign category" onClose={onClose}>
      {categoriesQuery.isPending ? (
        <LoadingState />
      ) : categoriesQuery.isError ? (
        <ErrorState
          message="Could not load categories."
          onRetry={() => void categoriesQuery.refetch()}
        />
      ) : (
        groups.map((group) => (
          <View key={group.type} style={{ marginBottom: theme.spacing.md }}>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: theme.text.caption,
                fontWeight: '700',
                textTransform: 'uppercase',
                marginBottom: theme.spacing.xs,
              }}
            >
              {CATEGORY_TYPE_LABELS[group.type]}
            </Text>
            {group.categories.map((category) => {
              const selected = category.categoryId === currentCategoryId;
              return (
                <Pressable
                  key={category.categoryId}
                  onPress={() => onSelect(category)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: theme.colors.surfaceAlt,
                      borderRadius: theme.radius.sm,
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.sm + theme.spacing.xs,
                      marginBottom: theme.spacing.xs,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <View style={styles.rowIcon}>
                    <CategoryIcon
                      categoryId={category.categoryId}
                      categoryName={category.name}
                      iconKey={category.iconKey}
                      colorKey={category.color}
                      size={28}
                      iconSize={15}
                    />
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.rowLabel,
                      {
                        color: theme.colors.textPrimary,
                        fontSize: theme.text.body,
                        fontWeight: selected ? '700' : '400',
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
        ))
      )}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  rowIcon: { marginRight: 10, flexShrink: 0 },
  rowLabel: { flex: 1 },
});
