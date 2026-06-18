/**
 * Icon picker (ops/PHASE10-DECISIONS.md P10-2/P10-5): a searchable grid of the
 * curated category glyph set on the shared ModalSheet scaffold. Each cell is a
 * pickable swatch rendering the GLYPH_MAP duotone glyph; the search box filters
 * by glyph label + keywords. Selecting a glyph reports its GLYPH_KEYS key and
 * closes the sheet. The grid is the SINGLE icon-picker surface — reused by the
 * category editor now and the rules / account-type editors later (P10-5).
 *
 * The curated set is the app side of the cross-workspace glyph contract
 * (`GLYPH_KEYS` in `@goldfinch/shared/categoryStyle`); rendering from GLYPH_MAP
 * guarantees every pickable key is one the API's `isGlyphKey` accepts.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GLYPH_KEYS, type GlyphKey } from '@goldfinch/shared/categoryStyle';

import { useT } from '../../../src/i18n';
import { Button } from '../../../src/ui/Button';
import { FormField } from '../../../src/ui/FormField';
import { GLYPH_MAP } from '../../../src/ui/icons';
import { ModalSheet } from '../../../src/ui/ModalSheet';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { useHover } from '../../../src/ui/useHover';

export interface IconPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Currently selected glyph key (highlighted), or null for none. */
  selectedKey?: string | null;
  /** Hex accent the preview glyphs render in (the category's resolved color). */
  accent: string;
  /** Fired with the chosen GLYPH_KEYS key; the parent owns close timing. */
  onSelect: (iconKey: GlyphKey) => void;
}

/**
 * Lowercased search corpus per glyph (label + keywords), built once. A query
 * matches when every whitespace-separated term is a substring of the corpus,
 * so "fast food" and "food fast" both find the burger glyph.
 */
const SEARCH_CORPUS: ReadonlyArray<{ key: GlyphKey; corpus: string }> =
  GLYPH_KEYS.map((key) => {
    const meta = GLYPH_MAP[key];
    return {
      key,
      corpus: [meta.label, ...meta.keywords, key].join(' ').toLowerCase(),
    };
  });

function matches(corpus: string, terms: readonly string[]): boolean {
  return terms.every((term) => corpus.includes(term));
}

export function IconPickerSheet({
  visible,
  onClose,
  selectedKey,
  accent,
  onSelect,
}: IconPickerSheetProps) {
  const theme = useTheme();
  const t = useT();
  const [query, setQuery] = useState('');

  const results = useMemo<readonly GlyphKey[]>(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return GLYPH_KEYS;
    return SEARCH_CORPUS.filter(({ corpus }) => matches(corpus, terms)).map(
      ({ key }) => key,
    );
  }, [query]);

  return (
    <ModalSheet
      visible={visible}
      title={t('Icon')}
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
      <FormField
        label={t('Search')}
        value={query}
        onChangeText={setQuery}
        placeholder={t('Search icons')}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={t('Search icons')}
      />
      <View style={styles.grid} accessibilityRole="list">
        {results.map((key) => (
          <IconCell
            key={key}
            glyphKey={key}
            accent={accent}
            selected={key === selectedKey}
            onPress={() => onSelect(key)}
          />
        ))}
      </View>
    </ModalSheet>
  );
}

function IconCell({
  glyphKey,
  accent,
  selected,
  onPress,
}: {
  glyphKey: GlyphKey;
  accent: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const meta = GLYPH_MAP[glyphKey];
  const Glyph = meta.glyph;
  return (
    <Pressable
      onPress={onPress}
      {...hoverProps}
      accessibilityRole="button"
      accessibilityLabel={meta.label}
      accessibilityState={{ selected }}
      testID={`icon-picker-cell-${glyphKey}`}
      style={({ pressed }) => [
        styles.cell,
        {
          borderRadius: theme.radius.token,
          borderColor: selected ? accent : theme.colors.border,
          borderWidth: selected ? 2 : theme.card.borderWidth,
          backgroundColor: selected
            ? theme.colors.surfaceAlt
            : hovered
              ? theme.colors.surfaceAlt
              : 'transparent',
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Glyph size={24} color={accent} weight="duotone" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 8,
  },
  cell: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerButton: { flex: 1 },
});
