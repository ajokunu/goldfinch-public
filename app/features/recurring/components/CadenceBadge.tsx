/**
 * Cadence pill (design-spec screens.md 6.2): 10.5px caps on a theme-chip
 * surface. The label is translated through the i18n table -- the cadence
 * values map 1:1 onto the 'Weekly' / 'Biweekly' / 'Monthly' / 'Yearly' keys
 * seeded from the prototype. Plain text, no emoji.
 */
import { StyleSheet, Text, View } from 'react-native';
import type { RecurringCadence } from '@goldfinch/shared/types';

import { useTheme } from '../../../src/ui/ThemeProvider';
import { useT } from '../../../src/i18n';
import type { I18nKey } from '../../../src/i18n';

const CADENCE_KEYS: Readonly<Record<RecurringCadence, I18nKey>> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

export function CadenceBadge({ cadence }: { cadence: RecurringCadence }) {
  const theme = useTheme();
  const t = useT();
  const label = t(CADENCE_KEYS[cadence]);
  return (
    <View
      accessibilityLabel={label}
      style={[
        styles.pill,
        {
          backgroundColor: theme.colors.surfaceAlt,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.chip,
        },
      ]}
    >
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: 10.5,
          fontWeight: '700',
          fontFamily: theme.fonts.sansSet.bold,
          textTransform: 'uppercase',
          letterSpacing: 0.63,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
});
