/**
 * Color picker (ops/PHASE10-DECISIONS.md P10-3/P10-5): a swatch row of the
 * 11-key theme category palette on the shared ModalSheet scaffold. Each swatch
 * renders the live `theme.cats[key]` hex so it looks right in every direction +
 * mode; selecting reports the palette KEY (never a raw hex — P10-1) and closes.
 *
 * The keys come from the shared `CATEGORY_COLOR_KEYS` contract (the API's
 * `isCategoryColorKey` validates against the same set), and the order is the
 * locked prototype order, so the swatch row reads identically across themes.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import {
  CATEGORY_COLOR_KEYS,
  type CategoryColorKey,
} from '@goldfinch/shared/categoryStyle';

import { useT } from '../../../src/i18n';
import { Button } from '../../../src/ui/Button';
import { ModalSheet } from '../../../src/ui/ModalSheet';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { useHover } from '../../../src/ui/useHover';

export interface ColorPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Currently selected palette key (highlighted), or null for none. */
  selectedKey?: string | null;
  /** Fired with the chosen palette KEY; the parent owns close timing. */
  onSelect: (colorKey: CategoryColorKey) => void;
}

export function ColorPickerSheet({
  visible,
  onClose,
  selectedKey,
  onSelect,
}: ColorPickerSheetProps) {
  const t = useT();

  return (
    <ModalSheet
      visible={visible}
      title={t('Color')}
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
      <View style={styles.row} accessibilityRole="list">
        {CATEGORY_COLOR_KEYS.map((key) => (
          <Swatch
            key={key}
            colorKey={key}
            selected={key === selectedKey}
            onPress={() => onSelect(key)}
          />
        ))}
      </View>
    </ModalSheet>
  );
}

function Swatch({
  colorKey,
  selected,
  onPress,
}: {
  colorKey: CategoryColorKey;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  const hex = theme.cats[colorKey];
  return (
    <Pressable
      onPress={onPress}
      {...hoverProps}
      accessibilityRole="button"
      accessibilityLabel={colorKey}
      accessibilityState={{ selected }}
      testID={`color-picker-swatch-${colorKey}`}
      style={({ pressed }) => [
        styles.swatchWrap,
        {
          borderColor: selected ? theme.colors.textPrimary : 'transparent',
          opacity: pressed ? 0.6 : hovered ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.swatch, { backgroundColor: hex }]}>
        {selected ? <Check size={18} color={theme.colors.onAccent} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingVertical: 8,
  },
  swatchWrap: {
    borderRadius: 999,
    borderWidth: 2,
    padding: 2,
  },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerButton: { flex: 1 },
});
