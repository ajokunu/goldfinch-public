/**
 * Custom bottom tab bar (design-spec shell.md 1.2/1.3): opaque `surface` bar
 * with a top hairline, per-tab dot indicator above the icon, stroke-weight
 * change on focus, and the localized label set. A custom bar is required
 * because the dot + stroke treatment is not expressible via screenOptions.
 *
 * Accessibility reimplements what React Navigation's default bar provides:
 * tab/button roles, selected state, localized labels, tabPress/tabLongPress
 * events (so screen listeners still fire), and per-route testIDs.
 *
 * Accepted deviation (shell.md 1.2): the prototype's translucent blur bar
 * needs expo-blur (install forbidden); the bar ships opaque `surface`.
 * expo-router's `href: null` screens arrive with a display:'none' item style
 * -- the pure filter in ./navActive re-applies that here.
 */
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';

import { useTheme } from '../ThemeProvider';
import { isHiddenTabItemStyle } from './navActive';

export interface TabBarProps extends BottomTabBarProps {
  /** Reports the laid-out bar height so the shell can anchor the FAB. */
  onHeight?: (height: number) => void;
}

const ICON_SIZE = 23;

export function TabBar({
  state,
  descriptors,
  navigation,
  insets,
  onHeight,
}: TabBarProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole={Platform.OS === 'web' ? 'tablist' : undefined}
      onLayout={(event) =>
        onHeight?.(Math.round(event.nativeEvent.layout.height))
      }
      style={[
        styles.bar,
        {
          paddingBottom: insets.bottom + 8,
          backgroundColor: theme.colors.tabBarBg,
          borderTopColor: theme.colors.line,
        },
      ]}
    >
      {state.routes.map((route, index) => {
        const descriptor = descriptors[route.key];
        if (!descriptor) return null;
        const { options } = descriptor;
        // Detail routes declared with `href: null` stay off the bar.
        if (isHiddenTabItemStyle(options.tabBarItemStyle)) return null;

        const focused = state.index === index;
        const label =
          typeof options.tabBarLabel === 'string'
            ? options.tabBarLabel
            : (options.title ?? route.name);
        const color = focused
          ? theme.colors.tabActive
          : theme.colors.tabInactive;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            // Exactly the default BottomTabBar dispatch (navigate-by-route,
            // scoped to this navigator) so behavior cannot drift.
            navigation.dispatch({
              ...CommonActions.navigate(route),
              target: state.key,
            });
          }
        };
        const onLongPress = () => {
          navigation.emit({ type: 'tabLongPress', target: route.key });
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={onLongPress}
            accessibilityRole={Platform.OS === 'web' ? 'tab' : 'button'}
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            testID={`tab-${route.name}`}
            style={styles.item}
          >
            <View style={styles.iconWrap}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: theme.colors.accent,
                    opacity: focused ? 1 : 0,
                  },
                ]}
              />
              {options.tabBarIcon?.({ focused, color, size: ICON_SIZE })}
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color, fontFamily: theme.fonts.sans },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 9,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  item: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  dot: {
    position: 'absolute',
    top: -7,
    width: 5,
    height: 5,
    borderRadius: 999,
  },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 0.1 },
});
