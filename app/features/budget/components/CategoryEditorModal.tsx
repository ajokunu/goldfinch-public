/**
 * Create / edit a category. Type is chosen at creation only (the API has no
 * type field on PATCH -- type is immutable because historical GSI2 math keys
 * off it). Groups are free-form ids surfaced as chips of the household's
 * existing groups; typing a new name creates a new group implicitly.
 * Archive is a soft delete (DELETE /categories/{id}); restore PATCHes
 * archived back to false.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { CategoryDto, CategoryType } from '@goldfinch/shared/types';
import {
  resolveCategoryColorKey,
  type CategoryColorKey,
  type GlyphKey,
} from '@goldfinch/shared/categoryStyle';

import { useT } from '../../../src/i18n';
import { CategoryGlyph } from '../../../src/ui/icons';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { errorMessage } from '../lib/errors';
import { CATEGORY_TYPE_LABELS, groupLabel } from '../lib/grouping';
import {
  useArchiveCategory,
  useCreateCategory,
  usePatchCategory,
} from '../hooks/useBudgetMutations';
import { Button } from './Buttons';
import { ColorPickerSheet } from './ColorPickerSheet';
import { FormField } from './FormField';
import { IconPickerSheet } from './IconPickerSheet';
import { ModalSheet } from '../../../src/ui/ModalSheet';
import { SegmentedTabs } from './SegmentedTabs';

const TYPE_OPTIONS = [
  { key: 'EXPENSE', label: 'Expense' },
  { key: 'INCOME', label: 'Income' },
  { key: 'TRANSFER', label: 'Transfer' },
] as const;

export interface CategoryEditorModalProps {
  visible: boolean;
  /** Present when editing; absent when creating. */
  category?: CategoryDto;
  /** Existing group ids, for the quick-pick chips. */
  existingGroupIds: string[];
  onClose: () => void;
}

export function CategoryEditorModal({
  visible,
  category,
  existingGroupIds,
  onClose,
}: CategoryEditorModalProps) {
  const theme = useTheme();
  const t = useT();
  const createCategory = useCreateCategory();
  const patchCategory = usePatchCategory();
  const archiveCategory = useArchiveCategory();

  const [name, setName] = useState('');
  const [type, setType] = useState<CategoryType>('EXPENSE');
  const [groupId, setGroupId] = useState('');
  const [iconKey, setIconKey] = useState<GlyphKey | null>(null);
  const [colorKey, setColorKey] = useState<CategoryColorKey | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [iconSheet, setIconSheet] = useState(false);
  const [colorSheet, setColorSheet] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(category?.name ?? '');
    setType(category?.type ?? 'EXPENSE');
    setGroupId(category?.groupId ?? '');
    // Stored keys are strings; cast to the editor's key types. An invalid
    // stored value renders as "no explicit choice" (auto), exactly like absent.
    setIconKey((category?.iconKey as GlyphKey | undefined) ?? null);
    setColorKey((category?.color as CategoryColorKey | undefined) ?? null);
    setFieldError(null);
    setSubmitError(null);
    setConfirmingArchive(false);
    setIconSheet(false);
    setColorSheet(false);
  }, [visible, category]);

  const isEdit = category !== undefined;
  const busy =
    createCategory.isPending ||
    patchCategory.isPending ||
    archiveCategory.isPending;

  const groupChips = useMemo(() => existingGroupIds, [existingGroupIds]);

  // Preview category id: the live id when editing, else a provisional slug of
  // the typed name so the auto glyph/color preview tracks what the server will
  // assign. Empty until a name is typed (preview falls back to uncategorized).
  const previewCategoryId =
    category?.categoryId ?? name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // Live accent for the preview chip + icon-grid tint: the chosen color key
  // resolved via the shared precedence (key wins, else the deterministic hash),
  // then to the live theme hex. Same helper the render layer uses, so the
  // preview is exactly what ships.
  const previewAccent =
    previewCategoryId.length > 0
      ? theme.cats[resolveCategoryColorKey(colorKey, previewCategoryId)]
      : theme.colors.categoryOther;

  const handleSave = () => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setFieldError('Enter a name.');
      return;
    }
    setFieldError(null);
    setSubmitError(null);
    const trimmedGroup = groupId.trim();

    if (isEdit && category) {
      // iconKey/color are always sent on patch (the picker can clear back to
      // auto): an absent local choice is omitted so the server's validation
      // sees no key rather than an empty string.
      patchCategory.mutate(
        {
          categoryId: category.categoryId,
          body: {
            name: trimmedName,
            groupId: trimmedGroup.length > 0 ? trimmedGroup : null,
            ...(iconKey !== null ? { iconKey } : {}),
            ...(colorKey !== null ? { color: colorKey } : {}),
          },
        },
        {
          onSuccess: onClose,
          onError: (error) => setSubmitError(errorMessage(error)),
        },
      );
    } else {
      createCategory.mutate(
        {
          name: trimmedName,
          type,
          ...(trimmedGroup.length > 0 ? { groupId: trimmedGroup } : {}),
          ...(iconKey !== null ? { iconKey } : {}),
          ...(colorKey !== null ? { color: colorKey } : {}),
        },
        {
          onSuccess: onClose,
          onError: (error) => setSubmitError(errorMessage(error)),
        },
      );
    }
  };

  const handleArchive = () => {
    if (!category) return;
    if (!confirmingArchive) {
      setConfirmingArchive(true);
      return;
    }
    setSubmitError(null);
    archiveCategory.mutate(category.categoryId, {
      onSuccess: onClose,
      onError: (error) => setSubmitError(errorMessage(error)),
    });
  };

  const handleRestore = () => {
    if (!category) return;
    setSubmitError(null);
    patchCategory.mutate(
      { categoryId: category.categoryId, body: { archived: false } },
      {
        onSuccess: onClose,
        onError: (error) => setSubmitError(errorMessage(error)),
      },
    );
  };

  return (
    <ModalSheet
      visible={visible}
      title={isEdit ? `Edit ${category.name}` : 'New category'}
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
            label={isEdit ? t('Save changes') : 'Create category'}
            onPress={handleSave}
            loading={createCategory.isPending || patchCategory.isPending}
            disabled={busy}
            style={styles.footerButton}
          />
        </>
      }
    >
      {/* Live preview chip: the icon + color the category will render with,
          composed through the SAME precedence helpers as every render site so
          what you see here is what ships. */}
      <View
        accessibilityLabel="Category preview"
        testID="category-editor-preview"
        style={[
          styles.preview,
          {
            backgroundColor: theme.colors.surfaceAlt,
            borderRadius: theme.radius.chip,
          },
        ]}
      >
        <View
          style={[
            styles.previewWell,
            {
              borderRadius: theme.radius.token,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          <CategoryGlyph
            categoryId={previewCategoryId.length > 0 ? previewCategoryId : null}
            categoryName={name}
            iconKey={iconKey}
            colorKey={colorKey}
            size={22}
          />
        </View>
        <Text
          numberOfLines={1}
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.body,
            fontFamily: theme.fonts.sansSet.semibold,
            flexShrink: 1,
          }}
        >
          {name.trim().length > 0 ? name.trim() : 'New category'}
        </Text>
      </View>

      <FormField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Groceries"
        autoCapitalize="words"
        error={fieldError}
      />

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
        {t('Type')}
      </Text>
      {isEdit ? (
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.body,
            marginBottom: theme.spacing.md,
          }}
        >
          {CATEGORY_TYPE_LABELS[type]} (cannot change after creation)
        </Text>
      ) : (
        <View style={{ marginBottom: theme.spacing.md }}>
          <SegmentedTabs options={TYPE_OPTIONS} value={type} onChange={setType} />
        </View>
      )}

      <FormField
        label="Group"
        value={groupId}
        onChangeText={setGroupId}
        placeholder="food-dining (optional)"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {groupChips.length > 0 ? (
        <View style={[styles.chips, { marginBottom: theme.spacing.md }]}>
          {groupChips.map((id) => {
            const selected = id === groupId.trim();
            return (
              <Pressable
                key={id}
                onPress={() => setGroupId(selected ? '' : id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={{
                  backgroundColor: selected
                    ? theme.colors.accent
                    : theme.colors.surfaceAlt,
                  borderRadius: theme.radius.chip,
                  paddingHorizontal: theme.spacing.sm + theme.spacing.xs,
                  paddingVertical: theme.spacing.xs + 2,
                  marginRight: theme.spacing.xs,
                  marginBottom: theme.spacing.xs,
                }}
              >
                <Text
                  style={{
                    color: selected
                      ? theme.colors.onAccent
                      : theme.colors.textSecondary,
                    fontSize: theme.text.caption,
                    fontFamily: theme.fonts.sans,
                  }}
                >
                  {groupLabel(id)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* P10-5: Icon + Color rows. Each shows the current choice and opens its
          picker sheet; the preview chip above reflects either change live. */}
      <Pressable
        onPress={() => setIconSheet(true)}
        accessibilityRole="button"
        accessibilityLabel={t('Icon')}
        testID="category-editor-icon-row"
        style={({ pressed }) => [
          styles.pickerRow,
          {
            backgroundColor: theme.colors.surfaceAlt,
            borderRadius: theme.radius.control,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.body,
            fontFamily: theme.fonts.sans,
            flex: 1,
          }}
        >
          {t('Icon')}
        </Text>
        <View
          style={[
            styles.pickerWell,
            {
              borderRadius: theme.radius.token,
              backgroundColor: theme.colors.surface,
            },
          ]}
        >
          <CategoryGlyph
            categoryId={previewCategoryId.length > 0 ? previewCategoryId : null}
            categoryName={name}
            iconKey={iconKey}
            colorKey={colorKey}
            size={18}
          />
        </View>
        <ChevronRight size={16} color={theme.colors.textFaint} />
      </Pressable>

      <Pressable
        onPress={() => setColorSheet(true)}
        accessibilityRole="button"
        accessibilityLabel={t('Color')}
        testID="category-editor-color-row"
        style={({ pressed }) => [
          styles.pickerRow,
          {
            backgroundColor: theme.colors.surfaceAlt,
            borderRadius: theme.radius.control,
            marginBottom: theme.spacing.md,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.body,
            fontFamily: theme.fonts.sans,
            flex: 1,
          }}
        >
          {t('Color')}
        </Text>
        <View
          testID="category-editor-color-dot"
          style={[styles.colorDot, { backgroundColor: previewAccent }]}
        />
        <ChevronRight size={16} color={theme.colors.textFaint} />
      </Pressable>

      <IconPickerSheet
        visible={iconSheet}
        onClose={() => setIconSheet(false)}
        selectedKey={iconKey}
        accent={previewAccent}
        onSelect={(key) => {
          setIconKey(key);
          setIconSheet(false);
        }}
      />
      <ColorPickerSheet
        visible={colorSheet}
        onClose={() => setColorSheet(false)}
        selectedKey={colorKey}
        onSelect={(key) => {
          setColorKey(key);
          setColorSheet(false);
        }}
      />

      {submitError ? (
        <Text
          style={{
            color: theme.colors.danger,
            fontSize: theme.text.caption,
            marginBottom: theme.spacing.md,
          }}
        >
          {submitError}
        </Text>
      ) : null}

      {isEdit && category ? (
        <View style={{ marginTop: theme.spacing.sm }}>
          {category.archived ? (
            <Button
              label="Restore category"
              variant="secondary"
              onPress={handleRestore}
              loading={patchCategory.isPending}
              disabled={busy && !patchCategory.isPending}
            />
          ) : (
            <Button
              label={
                confirmingArchive
                  ? 'Confirm: archive category'
                  : 'Archive category'
              }
              variant="danger"
              onPress={handleArchive}
              loading={archiveCategory.isPending}
              disabled={busy && !archiveCategory.isPending}
            />
          )}
        </View>
      ) : null}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  footerButton: { flex: 1 },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 14,
  },
  previewWell: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  pickerWell: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  colorDot: { width: 22, height: 22, borderRadius: 999, flexShrink: 0 },
});
