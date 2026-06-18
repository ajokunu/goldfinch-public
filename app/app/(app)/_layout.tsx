/**
 * Authenticated shell navigation -- Phase 7 information architecture, shell
 * restyle per ops/design-spec/shell.md (decisions 2/4).
 *
 * The IA is six primary tabs plus a More section for the low-frequency
 * management screens. Tab labels are the prototype set (shell.md 1.1,
 * decision 4) plus the Investments aggregate tab (P7-3 top-level holdings
 * view) and are localized via src/i18n useT(); `title` stays the English
 * label for web document titles. Routes are unchanged except the added
 * Investments destination:
 *
 *   Tab 1 Home          /                      features/dashboard
 *   Tab 2 Activity      /transactions          features/transactions
 *   Tab 3 Budget        /budget                features/budget
 *   Tab 4 Investments   /investments           features/investments (P7-3)
 *   Tab 5 Reports       /reports               features/reports (P7-4)
 *   Tab 6 More          /more                  shell-owned hub stack:
 *           Goals       /more/goals            features/goals (P7-2)
 *           Recurring   /more/recurring        features/recurring (P7-1)
 *           Rules       /more/rules            features/rules (P7-5)
 *           Import      /more/import           features/import (P7-6)
 *           Settings    /more/settings         shell-owned
 *
 * Detail routes live inside this group (href: null keeps them off the tab
 * bar) so the auth guard in app/_layout.tsx covers them:
 *
 *   Account detail / holdings  /accounts/[accountId]               (P7-3)
 *   Attachment viewer          /attachments/[txnId]/[attachId]     (P7-9)
 *
 * Shell pieces mounted here (shell.md 1/2/4):
 * - SheetHost: the one shell-level sheet provider (add menu) with the
 *   background push effect.
 * - TabBar (custom, shell.md 1.2/1.3): dot indicator + stroke-weight active
 *   treatment; reports its height so the FAB tracks real insets.
 * - AddFab (shell.md 2.1): Home / Activity / Budget only, never on desktop.
 * - Desktop sidebar (shell.md 4): web >= 1024px swaps the bottom bar for the
 *   230px sidebar, reactively on resize -- gated on Platform.OS === 'web' +
 *   useWindowDimensions so native (tablets included) always keeps the tabs.
 *   The single Tabs navigator stays the source of navigation state on both
 *   sides of the breakpoint; content is centered at max-width 1040 (shell.md
 *   4.3).
 *
 * Icons are lucide-react-native chrome (house no-emoji rule); `transactions`
 * is ArrowDownUp per the prototype glyph (shell.md 1.1). The Investments tab
 * is the one identity destination, so its glyph is the phosphor duotone
 * ChartLineUpIcon from src/ui/icons (per the house icon rule), not lucide.
 * The same tree serves native tabs and web URLs.
 */
import { useCallback, useState } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Tabs, usePathname } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import {
  ArrowDownUp,
  ChartLine,
  LayoutDashboard,
  Menu,
  PieChart,
} from 'lucide-react-native';

import { useT } from '../../src/i18n';
import { ChartLineUpIcon } from '../../src/ui/icons';
import { SheetHost } from '../../src/ui/SheetHost';
import { useTabTransition } from '../../src/ui/motion';
import { useTheme } from '../../src/ui/ThemeProvider';
import { AddFab } from '../../src/ui/shell/AddFab';
import { isFabPathname } from '../../src/ui/shell/navActive';
import { Sidebar } from '../../src/ui/shell/Sidebar';
import { TabBar } from '../../src/ui/shell/TabBar';
import { useWidgetSync } from '../../features/widget/useWidgetSync';

/** Desktop sidebar breakpoint (shell.md 4.1, decision 4). */
const DESKTOP_MIN_WIDTH = 1024;
/** Centered content cap on desktop (shell.md 4.3 SPEC DECISION). */
const DESKTOP_CONTENT_MAX_WIDTH = 1040;
/** FAB floats 18px above the tab bar (shell.md 2.1). */
const FAB_GAP = 18;

export default function AppTabsLayout() {
  const theme = useTheme();
  // Localized tab labels re-render on language change because useT() reads
  // zustand state (shell.md 8.2).
  const t = useT();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;
  // Tab/page switch crossfade + drift (PHASE9-DECISIONS P9-2 item 2), built
  // by the motion module from the tokens + kill-switch contract. The same
  // navigator serves the desktop sidebar, so sidebar content switches get
  // the identical crossfade.
  const tabTransition = useTabTransition();

  // Keep the home-screen widget's cached weekly-spend snapshot fresh: rebuilds
  // and writes it on app foreground and after each sync. No-op on web and when
  // the native widget bridge is absent. Mounted in the authed shell so it only
  // runs for a signed-in household.
  useWidgetSync();

  // The custom bar reports its laid-out height so the FAB clears it exactly
  // (insets included) without @react-navigation/bottom-tabs context hooks.
  const [tabBarHeight, setTabBarHeight] = useState(0);
  const renderTabBar = useCallback(
    (props: BottomTabBarProps) => (
      <TabBar {...props} onHeight={setTabBarHeight} />
    ),
    [],
  );
  // Desktop hides the bottom bar entirely; the sidebar takes over.
  const renderNoTabBar = useCallback(() => null, []);

  return (
    <SheetHost>
      <View style={[styles.frame, { backgroundColor: theme.colors.bg }]}>
        {isDesktop ? <Sidebar /> : null}
        <View style={styles.content}>
          <View
            style={[styles.canvas, isDesktop ? styles.canvasDesktop : null]}
          >
            <Tabs
              tabBar={isDesktop ? renderNoTabBar : renderTabBar}
              screenOptions={{ headerShown: false, ...tabTransition }}
            >
              <Tabs.Screen
                name="index"
                options={{
                  title: 'Home',
                  tabBarLabel: t('Home'),
                  tabBarIcon: ({ color, focused }) => (
                    <LayoutDashboard
                      color={color}
                      size={23}
                      strokeWidth={focused ? 2.4 : 2}
                    />
                  ),
                }}
              />
              <Tabs.Screen
                name="transactions"
                options={{
                  title: 'Activity',
                  tabBarLabel: t('Activity'),
                  tabBarIcon: ({ color, focused }) => (
                    <ArrowDownUp
                      color={color}
                      size={23}
                      strokeWidth={focused ? 2.4 : 2}
                    />
                  ),
                }}
              />
              <Tabs.Screen
                name="budget"
                options={{
                  title: 'Budget',
                  tabBarLabel: t('Budget'),
                  tabBarIcon: ({ color, focused }) => (
                    <PieChart
                      color={color}
                      size={23}
                      strokeWidth={focused ? 2.4 : 2}
                    />
                  ),
                }}
              />
              <Tabs.Screen
                name="investments"
                options={{
                  title: 'Investments',
                  tabBarLabel: t('Investments'),
                  // Identity glyph: phosphor duotone (house rule), so this
                  // tab takes weight/size/color -- NOT lucide's strokeWidth.
                  tabBarIcon: ({ color, focused }) => (
                    <ChartLineUpIcon
                      color={color}
                      size={23}
                      weight={focused ? 'fill' : 'duotone'}
                    />
                  ),
                }}
              />
              <Tabs.Screen
                name="reports"
                options={{
                  title: 'Reports',
                  tabBarLabel: t('Reports'),
                  tabBarIcon: ({ color, focused }) => (
                    <ChartLine
                      color={color}
                      size={23}
                      strokeWidth={focused ? 2.4 : 2}
                    />
                  ),
                }}
              />
              <Tabs.Screen
                name="more"
                options={{
                  title: 'More',
                  tabBarLabel: t('More'),
                  tabBarIcon: ({ color, focused }) => (
                    <Menu
                      color={color}
                      size={23}
                      strokeWidth={focused ? 2.4 : 2}
                    />
                  ),
                }}
              />
              {/* Detail routes: reachable by navigation, hidden from the tab bar. */}
              <Tabs.Screen
                name="accounts/[accountId]"
                options={{ href: null }}
              />
              <Tabs.Screen
                name="attachments/[txnId]/[attachId]"
                options={{ href: null }}
              />
            </Tabs>
          </View>
          <AddFab
            visible={!isDesktop && isFabPathname(pathname)}
            bottom={tabBarHeight + FAB_GAP}
          />
        </View>
      </View>
    </SheetHost>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, flexDirection: 'row' },
  content: { flex: 1 },
  canvas: { flex: 1, width: '100%', alignSelf: 'center' },
  canvasDesktop: { maxWidth: DESKTOP_CONTENT_MAX_WIDTH },
});
