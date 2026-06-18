/**
 * Filter / category chip (components.md 4.5, feature-local until the kit
 * promotes a shared Chip). Active chips fill with the accent color; the
 * optional category identity glyph (detail-sheet category chips,
 * ops/design-spec/icons.md) keeps its own category accent in both states,
 * exactly like the swatch square it replaced. Radius is the per-direction
 * chip token (pill by default; quant 6, studio 8).
 *
 * P8-1/P8-3: chips carry the kit web-hover treatment, and `onClear` renders
 * a trailing X press target for removable filter chips (category filter).
 */
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { X, type LucideProps } from 'lucide-react-native';

import { CategoryGlyph } from '../../../src/ui/icons';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  hoverBackground,
  hoverTransitionStyle,
  useHover,
} from '../../../src/ui/useHover';
import { useReducedMotion } from '../../../src/ui/useReducedMotion';

export interface FilterChipProps {
  label: string;
  active?: boolean;
  onPress: () => void;
  /** Leading icon, 14px, strokeWidth 2.2. */
  icon?: ComponentType<LucideProps>;
  /** Leading 9x9 radius-3 color square (non-category swatch slots). */
  swatchColor?: string;
  /** Category identity chip: leading CategoryGlyph (wins over swatchColor). */
  categoryId?: string | null;
  /** Fallback-resolution name for user-created categories. */
  categoryName?: string | null;
  /** P10: the category's chosen glyph key (wins over the keyword fallback). */
  categoryIconKey?: string | null;
  /** P10: the category's chosen palette key (wins over the hash color). */
  categoryColorKey?: string | null;
  disabled?: boolean;
  /**
   * Removable chip (P8-3): renders a trailing X with its own press target
   * that clears the filter without triggering `onPress`.
   */
  onClear?: () => void;
}

export function FilterChip({
  label,
  active = false,
  onPress,
  icon: IconComponent,
  swatchColor,
  categoryId,
  categoryName,
  categoryIconKey,
  categoryColorKey,
  disabled = false,
  onClear,
}: FilterChipProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { hovered, hoverProps } = useHover(!disabled);
  const background = active
    ? theme.colors.accent
    : hovered
      ? hoverBackground(theme, theme.colors.surface)
      : theme.colors.surface;
  const foreground = active ? theme.colors.onAccent : theme.colors.dim;
  const borderColor = active ? theme.colors.accent : theme.colors.border;

  return (
    <Pressable
      onPress={onPress}
      {...hoverProps}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [
        styles.chip,
        hoverTransitionStyle(reduced),
        {
          backgroundColor: background,
          borderColor,
          borderRadius: theme.radius.chip,
          opacity:
            disabled ? 0.5 : pressed ? 0.85 : active && hovered ? 0.92 : 1,
        },
      ]}
    >
      {categoryId !== undefined || categoryName !== undefined ? (
        <CategoryGlyph
          categoryId={categoryId ?? null}
          categoryName={categoryName}
          iconKey={categoryIconKey}
          colorKey={categoryColorKey}
          size={14}
        />
      ) : swatchColor ? (
        <View style={[styles.swatch, { backgroundColor: swatchColor }]} />
      ) : null}
      {IconComponent ? (
        <IconComponent size={14} strokeWidth={2.2} color={foreground} />
      ) : null}
      <Text
        style={{
          color: foreground,
          fontSize: 12.5,
          fontWeight: '600',
          fontFamily: theme.fonts.sans,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {onClear ? (
        <Pressable
          onPress={onClear}
          disabled={disabled}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label} filter`}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <X size={13} strokeWidth={2.4} color={foreground} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 13,
    borderWidth: 1,
    flexShrink: 0,
  },
  swatch: { width: 9, height: 9, borderRadius: 3, flexShrink: 0 },
});
