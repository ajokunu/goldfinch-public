/**
 * Add-action sheet body (design-spec shell.md 2.2, shell-owned): five action
 * rows launched from the FAB through the SheetHost. Every row closes the
 * sheet, then navigates via the EXISTING routes (decision 4: IA unchanged).
 * Icons are lucide-react-native per the section 6 mapping -- never emoji.
 *
 * The `?add=1` search param is the cross-screen contract (shell.md 2.2): the
 * target screen consumes it once (opens its add/editor flow, then clears the
 * param); rows whose target does not honor it yet still land on the real,
 * functional screen. Both bank rows route to /more/import because SimpleFIN
 * linking lives in the import feature's account step.
 *
 * Strings are i18n keys rendered through useT(); titles/subtitles re-render
 * on language change because the hook reads zustand state.
 */
import { useCallback, type ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  ChevronRight,
  Download,
  Landmark,
  Plus,
  Repeat,
  Target,
  type LucideProps,
} from 'lucide-react-native';

import { useT, type I18nKey } from '../i18n';
import { mixColor } from './mixColor';
import { useSheet } from './SheetHost';
import { useTheme } from './ThemeProvider';

type AddActionPath =
  | '/transactions'
  | '/more/goals'
  | '/more/recurring'
  | '/more/import';

interface AddAction {
  icon: ComponentType<LucideProps>;
  title: I18nKey;
  sub: I18nKey;
  /** Existing route the action lands on (decision 4: IA unchanged). */
  path: AddActionPath;
  /** Append the `add=1` param so the target opens its add flow once. */
  add?: boolean;
}

const ACTIONS: readonly AddAction[] = [
  {
    icon: Plus,
    title: 'Add transaction',
    sub: 'Log a manual expense or income',
    path: '/transactions',
    add: true,
  },
  {
    icon: Target,
    title: 'New goal',
    sub: 'Start saving toward something',
    path: '/more/goals',
    add: true,
  },
  {
    icon: Repeat,
    title: 'Add recurring bill',
    sub: 'Track a subscription or bill',
    path: '/more/recurring',
    add: true,
  },
  {
    icon: Landmark,
    title: 'Link account',
    sub: 'Connect a bank via SimpleFIN',
    path: '/more/import',
  },
  {
    icon: Download,
    title: 'Import CSV',
    sub: 'Bring in statement history',
    path: '/more/import',
  },
] as const;

export interface AddMenuSheetProps {
  /** Closes the hosting sheet before navigating. */
  onClose: () => void;
}

export function AddMenuSheet({ onClose }: AddMenuSheetProps) {
  const theme = useTheme();
  const t = useT();
  const router = useRouter();

  return (
    <View style={styles.list}>
      {ACTIONS.map((action) => {
        const ActionIcon = action.icon;
        return (
          <Pressable
            key={action.title}
            onPress={() => {
              onClose();
              router.push(
                action.add
                  ? { pathname: action.path, params: { add: '1' } }
                  : action.path,
              );
            }}
            accessibilityRole="button"
            accessibilityLabel={t(action.title)}
            accessibilityHint={t(action.sub)}
            style={({ pressed }) => [
              styles.row,
              {
                borderRadius: theme.radius.control,
                backgroundColor: pressed
                  ? theme.colors.surfaceAlt
                  : 'transparent',
              },
            ]}
          >
            <View
              style={[
                styles.iconWell,
                {
                  backgroundColor: mixColor(
                    theme.colors.accent,
                    0.15,
                    theme.colors.surface,
                  ),
                },
              ]}
            >
              <ActionIcon
                size={20}
                strokeWidth={2.2}
                color={theme.colors.accent}
              />
            </View>
            <View style={styles.body}>
              <Text
                numberOfLines={1}
                style={[
                  styles.title,
                  {
                    color: theme.colors.textPrimary,
                    fontFamily: theme.fonts.sans,
                  },
                ]}
              >
                {t(action.title)}
              </Text>
              <Text
                numberOfLines={1}
                style={[
                  styles.sub,
                  {
                    color: theme.colors.textSecondary,
                    fontFamily: theme.fonts.sans,
                  },
                ]}
              >
                {t(action.sub)}
              </Text>
            </View>
            <ChevronRight size={17} color={theme.colors.textFaint} />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * FAB entry point: returns an opener that mounts the add menu in the
 * shell-level SheetHost. Must be called under a SheetHost provider.
 */
export function useOpenAddMenu(): () => void {
  const sheet = useSheet();
  const t = useT();
  return useCallback(() => {
    sheet.open({
      title: t('Add'),
      body: <AddMenuSheet onClose={sheet.close} />,
    });
  }, [sheet, t]);
}

const styles = StyleSheet.create({
  list: { gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  iconWell: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 12.5 },
});
