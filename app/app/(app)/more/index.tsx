/**
 * More hub (shell-owned): entry rows for the low-frequency destinations.
 * See the IA documentation in app/(app)/_layout.tsx. Feature parts own the
 * destination screens; this hub stays a static, typed list of links.
 *
 * Redesign per design-spec shell.md 3.1: localized screen title in the
 * direction display font, one destinations card of hairline-separated rows
 * (kit ListRow icon-tile treatment), a profile card built from the stored
 * Cognito ID token's display claims (never the prototype's mock identity),
 * and the brand footer with the live app version.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Download,
  Repeat,
  Settings,
  SlidersHorizontal,
  Target,
  type LucideIcon,
} from 'lucide-react-native';

import { useT, type I18nKey } from '../../../src/i18n';
import { Card } from '../../../src/ui/Card';
import { IconButton } from '../../../src/ui/IconButton';
import { ListRow } from '../../../src/ui/ListRow';
import { Screen } from '../../../src/ui/Screen';
import { BrandFooter } from '../../../src/ui/shell/BrandFooter';
import { useProfileClaims } from '../../../src/ui/shell/useProfileClaims';
import { useTheme } from '../../../src/ui/ThemeProvider';

interface MoreEntry {
  /** Route inside this stack (typed-route literal once typegen runs). */
  path: '/more/goals' | '/more/recurring' | '/more/rules' | '/more/import' | '/more/settings';
  /** i18n keys (shell.md 3.1 prototype copy) -- rendered through t(). */
  label: I18nKey;
  detail: I18nKey;
  icon: LucideIcon;
}

const ENTRIES: readonly MoreEntry[] = [
  {
    path: '/more/goals',
    label: 'Goals',
    detail: 'Savings targets & projections',
    icon: Target,
  },
  {
    path: '/more/recurring',
    label: 'Recurring',
    detail: 'Bills, subscriptions & income',
    icon: Repeat,
  },
  {
    path: '/more/rules',
    label: 'Rules',
    detail: 'Auto-categorize transactions',
    icon: SlidersHorizontal,
  },
  {
    path: '/more/import',
    label: 'Import',
    detail: 'Bring in CSV statements',
    icon: Download,
  },
  {
    path: '/more/settings',
    label: 'Settings',
    detail: 'Accounts, security, profile',
    icon: Settings,
  },
] as const;

export default function MoreHubScreen() {
  const theme = useTheme();
  const t = useT();
  const router = useRouter();
  const profile = useProfileClaims();

  // Primary identity line: name claim when present, else the email alone
  // (shell.md 3.1.3); nothing hardcoded -- decode failures already logged by
  // the hook leave the card chrome without identity text.
  const primaryIdentity = profile.name ?? profile.email;

  return (
    <Screen scroll>
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontFamily: theme.fonts.display,
          fontSize: theme.components.screenTitle.fontSize,
          letterSpacing: theme.components.screenTitle.letterSpacing,
          marginBottom: 16,
        }}
      >
        {t('More')}
      </Text>

      <Card style={styles.destinations}>
        {ENTRIES.map((entry, index) => (
          <View key={entry.path}>
            {index > 0 ? (
              <View
                style={[
                  styles.hairline,
                  { backgroundColor: theme.colors.line },
                ]}
              />
            ) : null}
            <ListRow
              label={t(entry.label)}
              sub={t(entry.detail)}
              icon={entry.icon}
              onPress={() => router.push(entry.path)}
            />
          </View>
        ))}
      </Card>

      <Card style={styles.profileCard}>
        <View style={styles.profileRow}>
          <View
            style={[
              styles.avatar,
              {
                backgroundColor: theme.colors.accent,
                borderRadius: theme.radius.token,
              },
            ]}
          >
            {profile.initial !== null ? (
              <Text
                style={[
                  styles.avatarInitial,
                  {
                    color: theme.colors.onAccent,
                    fontFamily: theme.fonts.sans,
                  },
                ]}
              >
                {profile.initial}
              </Text>
            ) : null}
          </View>
          <View style={styles.profileBody}>
            {primaryIdentity !== null ? (
              <Text
                numberOfLines={1}
                style={[
                  styles.profileName,
                  {
                    color: theme.colors.textPrimary,
                    fontFamily: theme.fonts.sans,
                  },
                ]}
              >
                {primaryIdentity}
              </Text>
            ) : null}
            {profile.name !== null && profile.email !== null ? (
              <Text
                numberOfLines={1}
                style={[
                  styles.profileEmail,
                  {
                    color: theme.colors.textSecondary,
                    fontFamily: theme.fonts.sans,
                  },
                ]}
              >
                {profile.email}
              </Text>
            ) : null}
          </View>
          <IconButton
            icon={Settings}
            variant="pill"
            iconSize={18}
            accessibilityLabel={t('Settings')}
            onPress={() => router.push('/more/settings')}
          />
        </View>
      </Card>

      <BrandFooter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  destinations: { padding: 6 },
  hairline: { height: StyleSheet.hairlineWidth },
  profileCard: { marginTop: 14 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  avatar: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarInitial: { fontSize: 17, fontWeight: '700' },
  profileBody: { flex: 1, minWidth: 0, gap: 2 },
  profileName: { fontSize: 15.5, fontWeight: '700' },
  profileEmail: { fontSize: 12.5 },
});
