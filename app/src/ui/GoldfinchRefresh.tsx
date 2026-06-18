/**
 * Pull-to-refresh with the goldfinch mark (PHASE9-DECISIONS P9-2 item 7):
 * while a refetch is in flight the brand silhouette dips/lifts top-center
 * instead of the stock spinner. The pairing rule lives HERE, once:
 *
 * - iOS: the native spinner is tinted transparent (the gesture and the
 *   in-flight gap survive) and GoldfinchRefreshMark renders the bobbing
 *   Skia mark over that gap.
 * - Android: SwipeRefreshLayout's floating circle cannot be hidden without
 *   losing the gesture, so it stays (themed accent-on-surface) and the mark
 *   stays out of its way -- one indicator per platform, never two.
 * - Web: no pull gesture exists; both halves render nothing extra.
 *
 * Screens must use BOTH halves together: GoldfinchRefreshControl as the
 * ScrollView's refreshControl, GoldfinchRefreshMark as a sibling rendered
 * after the ScrollView (it positions itself absolute top-center). Motion
 * settings are respected inside the RefreshMark primitive (reduced motion
 * keeps a static mark -- feedback survives -- and only kills the bob).
 */
import { Platform, RefreshControl, StyleSheet, type RefreshControlProps } from 'react-native';

import { RefreshMark } from './motion';
import { useTheme } from './ThemeProvider';

/**
 * Drop-in RefreshControl. Spread LAST: on Android the ScrollView clones this
 * element with `style` and the scroll content as `children`, and those
 * injected props must reach the real RefreshControl untouched.
 */
export function GoldfinchRefreshControl(props: RefreshControlProps) {
  const theme = useTheme();
  return (
    <RefreshControl
      tintColor="transparent"
      colors={[theme.colors.accent]}
      progressBackgroundColor={theme.colors.surface}
      {...props}
    />
  );
}

export interface GoldfinchRefreshMarkProps {
  /** True while the refetch is in flight (the refreshControl's flag). */
  active: boolean;
}

/** The mark overlay half; render after the ScrollView it accompanies. */
export function GoldfinchRefreshMark({ active }: GoldfinchRefreshMarkProps) {
  const theme = useTheme();
  // Android keeps its material spinner (see module doc); web has no pull
  // gesture and no CanvasKit runtime.
  if (Platform.OS !== 'ios') return null;
  return (
    <RefreshMark
      active={active}
      color={theme.colors.accent}
      style={styles.mark}
      testID="goldfinch-refresh-mark"
    />
  );
}

const styles = StyleSheet.create({
  mark: { position: 'absolute', top: 14, left: 0, right: 0, alignItems: 'center' },
});
