/**
 * OAuth redirect landing for the WEB build (https://<domain>/callback).
 *
 * expo-auth-session opens Managed Login in a popup on web; when Cognito
 * redirects the popup here, maybeCompleteAuthSession() relays the auth params
 * to the opener and closes the popup. If this page is reached as a top-level
 * navigation instead (no opener), we bounce back to the root, where the
 * Stack.Protected guards route to sign-in or the tabs.
 *
 * Native never renders this route: goldfinch://callback is consumed inside
 * the expo-web-browser auth session.
 */
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { useTheme } from '../../src/ui/ThemeProvider';

WebBrowser.maybeCompleteAuthSession();

export default function CallbackScreen() {
  const theme = useTheme();
  const router = useRouter();

  useEffect(() => {
    const hasOpener =
      typeof window !== 'undefined' && window.opener !== null && window.opener !== undefined;
    if (!hasOpener) {
      router.replace('/');
    }
  }, [router]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.bg,
      }}
    >
      <ActivityIndicator size="large" color={theme.colors.accent} />
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.body,
          marginTop: theme.spacing.md,
        }}
      >
        Completing sign-in
      </Text>
    </View>
  );
}
