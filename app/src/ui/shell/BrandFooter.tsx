/**
 * Brand footer (design-spec shell.md 3.1 item 4, shared by the More hub and
 * Settings): goldfinch mark, "GoldFinch" wordmark in the direction display
 * font, and a localized version line. "GoldFinch" is the product wordmark (a
 * proper noun, never translated); the version is live data from
 * expo-application, not the prototype's hardcoded "2.4.0".
 */
import { Image, StyleSheet, Text, View } from 'react-native';
import * as Application from 'expo-application';

import { useT } from '../../i18n';
import { useTheme } from '../ThemeProvider';

/** goldfinch-mark.png is 427x576; height 40 at the source aspect ratio. */
const MARK_ASPECT_RATIO = 427 / 576;

export function BrandFooter() {
  const theme = useTheme();
  const t = useT();
  // Same fallback the pre-redesign Settings footer used: web builds have no
  // native application version.
  const version = Application.nativeApplicationVersion ?? '0.1.0';

  return (
    <View style={styles.root}>
      <Image
        source={require('../../../assets/goldfinch-mark.png')}
        accessible={false}
        resizeMode="contain"
        style={styles.mark}
      />
      <Text
        style={[
          styles.wordmark,
          {
            color: theme.colors.textPrimary,
            fontFamily: theme.fonts.display,
          },
        ]}
      >
        GoldFinch
      </Text>
      <Text
        style={[
          styles.version,
          { color: theme.colors.textFaint, fontFamily: theme.fonts.sans },
        ]}
      >
        {`${t('Version')} ${version}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    gap: 7,
    paddingTop: 26,
    paddingBottom: 6,
  },
  // Explicit width: RNW web ignores aspectRatio-from-height (see Sidebar).
  mark: { height: 40, width: Math.round(40 * MARK_ASPECT_RATIO), opacity: 0.92 },
  wordmark: { fontSize: 15 },
  version: { fontSize: 11 },
});
