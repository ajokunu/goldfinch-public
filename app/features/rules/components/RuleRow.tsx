/**
 * One rule in the evaluation-ordered list: the assigned category's identity
 * icon well (CategoryIcon, ops/design-spec/icons.md), match summary,
 * bounds/priority detail, and a quick enabled toggle. Tapping the row opens
 * the editor.
 */
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { RuleDto } from '@goldfinch/shared/types';

import { CategoryIcon } from '../../../src/ui/icons';
import { useTheme } from '../../../src/ui/ThemeProvider';
import {
  hoverBackground,
  hoverTransitionStyle,
  useHover,
} from '../../../src/ui/useHover';
import { useReducedMotion } from '../../../src/ui/useReducedMotion';
import { MATCH_TYPE_LABELS, ruleBoundsLabel } from '../lib/form';

export interface RuleRowProps {
  rule: RuleDto;
  categoryName: string;
  /** P10: the assigned category's chosen glyph key (absent = auto glyph). */
  categoryIconKey?: string;
  /** P10: the assigned category's chosen palette key (absent = hash color). */
  categoryColorKey?: string;
  onPress: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  /** True while this row's enabled PATCH is in flight. */
  toggling: boolean;
}

export function RuleRow({
  rule,
  categoryName,
  categoryIconKey,
  categoryColorKey,
  onPress,
  onToggleEnabled,
  toggling,
}: RuleRowProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { hovered, hoverProps } = useHover();

  const detailParts = [
    `Assigns ${categoryName}`,
    ruleBoundsLabel(rule),
    `Priority ${rule.priority}`,
    rule.enabled ? null : 'Disabled',
  ].filter((part): part is string => part !== null);

  return (
    <Pressable
      onPress={onPress}
      {...hoverProps}
      accessibilityRole="button"
      accessibilityLabel={`Edit rule: ${MATCH_TYPE_LABELS[rule.matchType]} ${rule.pattern}`}
      style={({ pressed }) => [
        styles.row,
        hoverTransitionStyle(reduced),
        {
          backgroundColor: hovered
            ? hoverBackground(theme, theme.colors.surface)
            : theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          marginBottom: theme.spacing.xs,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={[styles.icon, { opacity: rule.enabled ? 1 : 0.55 }]}>
        <CategoryIcon
          categoryId={rule.categoryId}
          categoryName={categoryName}
          iconKey={categoryIconKey}
          colorKey={categoryColorKey}
          size={34}
          iconSize={17}
        />
      </View>
      <View style={[styles.text, { opacity: rule.enabled ? 1 : 0.55 }]}>
        <Text
          numberOfLines={1}
          style={{ color: theme.colors.textPrimary, fontSize: theme.text.body }}
        >
          <Text style={{ color: theme.colors.textSecondary }}>
            {MATCH_TYPE_LABELS[rule.matchType]}{' '}
          </Text>
          <Text style={{ fontWeight: '600' }}>{`"${rule.pattern}"`}</Text>
        </Text>
        <Text
          numberOfLines={2}
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.text.caption,
            marginTop: 2,
          }}
        >
          {detailParts.join(' | ')}
        </Text>
      </View>
      <Switch
        value={rule.enabled}
        onValueChange={onToggleEnabled}
        disabled={toggling}
        trackColor={{ true: theme.colors.accent }}
        accessibilityLabel={`Rule enabled: ${rule.pattern}`}
      />
      <ChevronRight
        size={18}
        color={theme.colors.textSecondary}
        style={{ marginLeft: theme.spacing.xs }}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: { marginRight: 10, flexShrink: 0 },
  text: { flex: 1, marginRight: 8 },
});
