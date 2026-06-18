/**
 * Desktop sidebar (design-spec shell.md 4.2, web >= 1024px only -- the
 * hosting layout gates on Platform + useWindowDimensions, so native never
 * renders this). Single source of navigation state stays the Tabs navigator;
 * the sidebar navigates with expo-router Links (real anchors on web) and
 * derives the active item from usePathname() via the pure matcher in
 * ./navActive (exact for '/', segment-prefix otherwise).
 *
 * Items: prototype DESK_NAV order with the LONG labels (Dashboard /
 * Transactions / ... -- not the phone tab labels), then a spec-extension
 * secondary group (Rules / Import / Settings) because desktop has no tab bar
 * or More hub to reach them through. Profile row pinned at the bottom shows
 * ID-token display claims and routes to Settings.
 */
import { useState, type ComponentType } from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { Link, usePathname, useRouter } from 'expo-router';
import {
  ArrowDownUp,
  ChartLine,
  Download,
  LayoutDashboard,
  PieChart,
  Repeat,
  Settings,
  SlidersHorizontal,
  Target,
  TrendingUp,
  type LucideProps,
} from 'lucide-react-native';

import { useT, type I18nKey } from '../../i18n';
import { withAlpha } from '../mixColor';
import { useTheme } from '../ThemeProvider';
import { isSidebarItemActive } from './navActive';
import { useProfileClaims } from './useProfileClaims';

interface SidebarEntry {
  /** Localized label key -- desktop uses the long titles (shell.md 4.2). */
  label: I18nKey;
  icon: ComponentType<LucideProps>;
  href:
    | '/'
    | '/transactions'
    | '/budget'
    | '/investments'
    | '/reports'
    | '/more/goals'
    | '/more/recurring'
    | '/more/rules'
    | '/more/import'
    | '/more/settings';
}

/** Prototype DESK_NAV order. */
const PRIMARY: readonly SidebarEntry[] = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { label: 'Transactions', icon: ArrowDownUp, href: '/transactions' },
  { label: 'Budget', icon: PieChart, href: '/budget' },
  // Desktop sidebar uses lucide chrome (the row passes strokeWidth); the
  // phosphor identity glyph is the mobile tab's job. TrendingUp reads as the
  // investments-growth destination at the sidebar's 19px size.
  { label: 'Investments', icon: TrendingUp, href: '/investments' },
  { label: 'Reports', icon: ChartLine, href: '/reports' },
  { label: 'Goals', icon: Target, href: '/more/goals' },
  { label: 'Recurring', icon: Repeat, href: '/more/recurring' },
] as const;

/**
 * SPEC EXTENSION (shell.md 4.2): without a tab bar or visible More hub these
 * would otherwise be unreachable on desktop. '/more' itself gets no entry.
 */
const SECONDARY: readonly SidebarEntry[] = [
  { label: 'Rules', icon: SlidersHorizontal, href: '/more/rules' },
  { label: 'Import', icon: Download, href: '/more/import' },
  { label: 'Settings', icon: Settings, href: '/more/settings' },
] as const;

/** goldfinch-mark.png is 427x576; height 36 at the source aspect ratio. */
const MARK_ASPECT_RATIO = 427 / 576;

export function Sidebar() {
  const theme = useTheme();
  const pathname = usePathname();

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.surface,
          borderRightColor: theme.colors.line,
        },
      ]}
    >
      <View style={styles.logoRow}>
        <Image
          source={require('../../../assets/goldfinch-mark.png')}
          accessible={false}
          resizeMode="contain"
          style={styles.logoMark}
        />
        <Text
          style={[
            styles.logoText,
            {
              color: theme.colors.textPrimary,
              fontFamily: theme.fonts.display,
            },
          ]}
        >
          GoldFinch
        </Text>
      </View>
      {PRIMARY.map((entry) => (
        <SidebarItem
          key={entry.href}
          entry={entry}
          active={isSidebarItemActive(pathname, entry.href)}
        />
      ))}
      <View style={[styles.divider, { backgroundColor: theme.colors.line }]} />
      {SECONDARY.map((entry) => (
        <SidebarItem
          key={entry.href}
          entry={entry}
          active={isSidebarItemActive(pathname, entry.href)}
        />
      ))}
      <View style={styles.spacer} />
      <SidebarProfile />
    </View>
  );
}

function SidebarItem({
  entry,
  active,
}: {
  entry: SidebarEntry;
  active: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const [hovered, setHovered] = useState(false);
  const [focusedVisible, setFocusedVisible] = useState(false);
  const IconComponent = entry.icon;

  const background = active
    ? theme.colors.accent
    : hovered
      ? theme.colors.surfaceAlt
      : 'transparent';
  const foreground = active
    ? theme.colors.onAccent
    : hovered
      ? theme.colors.textPrimary
      : theme.colors.textSecondary;

  // Visible keyboard focus ring (web only; onFocus never fires on native).
  const focusRing: ViewStyle | null =
    Platform.OS === 'web' && focusedVisible
      ? { boxShadow: `0 0 0 2px ${withAlpha(theme.colors.accent, 0.8)}` }
      : null;

  return (
    <Link href={entry.href} asChild>
      <Pressable
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onFocus={() => setFocusedVisible(true)}
        onBlur={() => setFocusedVisible(false)}
        accessibilityState={{ selected: active }}
        accessibilityLabel={t(entry.label)}
        testID={`sidebar-${entry.href === '/' ? 'index' : entry.href.slice(1).replace(/\//g, '-')}`}
        style={StyleSheet.flatten([
          styles.item,
          { borderRadius: theme.radius.sm, backgroundColor: background },
          focusRing,
        ])}
      >
        <IconComponent
          size={19}
          strokeWidth={active ? 2.3 : 2}
          color={foreground}
        />
        <Text
          numberOfLines={1}
          style={[
            styles.itemLabel,
            { color: foreground, fontFamily: theme.fonts.sans },
          ]}
        >
          {t(entry.label)}
        </Text>
      </Pressable>
    </Link>
  );
}

function SidebarProfile() {
  const theme = useTheme();
  const t = useT();
  const router = useRouter();
  const profile = useProfileClaims();
  const [hovered, setHovered] = useState(false);

  const primary = profile.name ?? profile.email;

  return (
    <Pressable
      onPress={() => router.push('/more/settings')}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={t('Settings')}
      testID="sidebar-profile"
      style={[
        styles.profileRow,
        {
          borderRadius: theme.radius.sm,
          backgroundColor: hovered ? theme.colors.surfaceAlt : 'transparent',
        },
      ]}
    >
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
              { color: theme.colors.onAccent, fontFamily: theme.fonts.sans },
            ]}
          >
            {profile.initial}
          </Text>
        ) : null}
      </View>
      {primary !== null ? (
        <View style={styles.profileBody}>
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
            {primary}
          </Text>
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
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 230,
    paddingVertical: 20,
    paddingHorizontal: 14,
    gap: 4,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
    paddingHorizontal: 12,
    paddingBottom: 18,
  },
  // Explicit width: RNW Image ignores aspectRatio-from-height on web and
  // falls back to the intrinsic 427px, blowing the row across the content.
  logoMark: { height: 36, width: Math.round(36 * MARK_ASPECT_RATIO) },
  logoText: { fontSize: 19 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  itemLabel: { fontSize: 14.5, fontWeight: '600', flexShrink: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 10 },
  spacer: { flex: 1 },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  avatar: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarInitial: { fontSize: 12, fontWeight: '700' },
  profileBody: { flex: 1, minWidth: 0 },
  profileName: { fontSize: 13, fontWeight: '600' },
  profileEmail: { fontSize: 11 },
});
