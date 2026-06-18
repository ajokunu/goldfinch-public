/**
 * Category management view (design spec screens.md 3.5): one card per group
 * with hairline-separated rows -- category identity icon well (CategoryIcon,
 * ops/design-spec/icons.md), name, type, chevron.
 * Tap opens the existing CategoryEditorModal (rename / regroup /
 * archive / restore preserved); archived categories keep their collapsed
 * secondary section so archive management never regresses.
 */
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react-native';
import type { CategoryDto } from '@goldfinch/shared/types';

import { Card, CardHeader } from '../../../src/ui/Card';
import {
  GoldfinchRefreshControl,
  GoldfinchRefreshMark,
} from '../../../src/ui/GoldfinchRefresh';
import { CategoryIcon } from '../../../src/ui/icons';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  CATEGORY_TYPE_LABELS,
  distinctGroupIds,
  groupCategories,
} from '../lib/grouping';
import { useCategoriesQuery } from '../hooks/useBudgetQueries';
import { Button } from './Buttons';
import { CategoryEditorModal } from './CategoryEditorModal';
import { EmptyState, ErrorState, LoadingState } from '../../../src/ui/States';
import {
  FadeRise,
  stagger,
  staggerChildDelayMs,
} from '../../../src/ui/motion';

interface EditorState {
  visible: boolean;
  /** undefined = create mode. */
  category?: CategoryDto;
}

function CategoryListRow({
  category,
  first,
  onPress,
}: {
  category: CategoryDto;
  first: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Edit category ${category.name}`}
      style={({ pressed }) => [
        styles.row,
        {
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.line,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.rowTile}>
        <CategoryIcon
          categoryId={category.categoryId}
          categoryName={category.name}
          iconKey={category.iconKey}
          colorKey={category.color}
          size={30}
          iconSize={16}
        />
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.rowName,
          {
            color: category.archived
              ? theme.colors.textSecondary
              : theme.colors.textPrimary,
            fontFamily: theme.fonts.sansSet.semibold,
          },
        ]}
      >
        {category.name}
      </Text>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: 12,
          fontFamily: theme.fonts.sans,
          marginRight: theme.spacing.sm,
        }}
      >
        {CATEGORY_TYPE_LABELS[category.type]}
      </Text>
      <ChevronRight size={16} color={theme.colors.textFaint} />
    </Pressable>
  );
}

export function CategoriesView() {
  const theme = useTheme();
  const categoriesQuery = useCategoriesQuery();

  const [editor, setEditor] = useState<EditorState>({ visible: false });
  const [showArchived, setShowArchived] = useState(false);

  const categories = useMemo(
    () => categoriesQuery.data?.items ?? [],
    [categoriesQuery.data],
  );
  const active = useMemo(
    () => categories.filter((category) => !category.archived),
    [categories],
  );
  const archived = useMemo(
    () =>
      categories
        .filter((category) => category.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );
  const sections = useMemo(() => groupCategories(active), [active]);
  const groupIds = useMemo(() => distinctGroupIds(categories), [categories]);

  if (categoriesQuery.isPending) return <LoadingState />;
  if (categoriesQuery.isError) {
    return (
      <ErrorState
        message="Could not load categories."
        onRetry={() => void categoriesQuery.refetch()}
      />
    );
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.density.pad,
          paddingBottom: theme.spacing.xl,
        }}
        refreshControl={
          <GoldfinchRefreshControl
            refreshing={categoriesQuery.isRefetching}
            onRefresh={() => void categoriesQuery.refetch()}
          />
        }
      >
        {/* Entrance cascade via the shared motion module (PHASE9-DECISIONS
            P9-1/P9-2 item 1). */}
        <FadeRise>
          <View style={{ marginBottom: theme.spacing.md }}>
            <Button
              label="New category"
              variant="secondary"
              onPress={() => setEditor({ visible: true })}
            />
          </View>
        </FadeRise>

        {sections.length === 0 ? (
          <EmptyState
            title="No categories"
            body="Create your first category to start budgeting."
          />
        ) : (
          sections.map((section, sectionIndex) => (
            <FadeRise
              key={section.key}
              delay={staggerChildDelayMs(sectionIndex + 1, stagger.cascadeMs)}
            >
              <Card style={[styles.groupCard, { marginBottom: 14 }]}>
                <View style={styles.groupHead}>
                  <CardHeader
                    title={section.label}
                    right={
                      <Text
                        style={{
                          color: theme.colors.textFaint,
                          fontSize: 12,
                          fontFamily: theme.fonts.sans,
                        }}
                      >
                        {section.categories.length}
                      </Text>
                    }
                  />
                </View>
                {section.categories.map((category, index) => (
                  <CategoryListRow
                    key={category.categoryId}
                    category={category}
                    first={index === 0}
                    onPress={() => setEditor({ visible: true, category })}
                  />
                ))}
              </Card>
            </FadeRise>
          ))
        )}

        {archived.length > 0 ? (
          <View>
            <Pressable
              onPress={() => setShowArchived((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showArchived }}
              style={({ pressed }) => [
                styles.archivedToggle,
                { marginBottom: theme.spacing.sm, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              {showArchived ? (
                <ChevronDown size={16} color={theme.colors.textSecondary} />
              ) : (
                <ChevronRight size={16} color={theme.colors.textSecondary} />
              )}
              <Text
                style={{
                  color: theme.colors.textSecondary,
                  fontSize: 12,
                  fontFamily: theme.fonts.sansSet.bold,
                  textTransform: 'uppercase',
                  letterSpacing: 0.96,
                  marginLeft: theme.spacing.xs,
                }}
              >
                Archived ({archived.length})
              </Text>
            </Pressable>
            {showArchived ? (
              <Card style={[styles.groupCard, { marginBottom: 14 }]}>
                {archived.map((category, index) => (
                  <CategoryListRow
                    key={category.categoryId}
                    category={category}
                    first={index === 0}
                    onPress={() => setEditor({ visible: true, category })}
                  />
                ))}
              </Card>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.hint, { marginTop: theme.spacing.md }]}>
          <Plus size={14} color={theme.colors.textSecondary} />
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: 12,
              fontFamily: theme.fonts.sans,
              marginLeft: theme.spacing.xs,
              flex: 1,
            }}
          >
            Archiving keeps a category's history; archived categories stay on
            past transactions and can be restored any time.
          </Text>
        </View>
      </ScrollView>
      <GoldfinchRefreshMark active={categoriesQuery.isRefetching} />

      <CategoryEditorModal
        visible={editor.visible}
        {...(editor.category !== undefined
          ? { category: editor.category }
          : {})}
        existingGroupIds={groupIds}
        onClose={() => setEditor({ visible: false })}
      />
    </>
  );
}

const styles = StyleSheet.create({
  groupCard: { paddingVertical: 8, paddingHorizontal: 10 },
  groupHead: { paddingHorizontal: 6, paddingTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 6,
  },
  rowTile: { marginRight: 11, flexShrink: 0 },
  rowName: { flex: 1, fontSize: 14.5, paddingRight: 8 },
  archivedToggle: { flexDirection: 'row', alignItems: 'center' },
  hint: { flexDirection: 'row', alignItems: 'flex-start' },
});
