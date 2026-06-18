/**
 * Sign-in screen: launches Cognito Managed Login (OAuth code + PKCE) via the
 * system browser / popup. Passkeys and EMAIL_OTP live inside Managed Login;
 * this screen never collects credentials itself.
 */
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../src/auth/AuthProvider';
import { logger } from '../../src/lib/logger';
import { Screen } from '../../src/ui/Screen';
import { useTheme } from '../../src/ui/ThemeProvider';

export default function SignInScreen() {
  const theme = useTheme();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signIn();
      if (result.status === 'error') {
        setError(result.message);
      }
      // 'cancelled' returns silently; 'success' re-routes via the root guard.
    } catch (error) {
      // promptAsync can reject outside SignInResult's error channel; the
      // call site is void-ed, so log here instead of dropping it (P7-10).
      logger.error('sign-in flow threw outside the result channel', { error });
    } finally {
      setBusy(false);
    }
  }, [busy, signIn]);

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.center}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logo}
          accessibilityLabel="GoldFinch logo"
          resizeMode="contain"
        />
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.title,
            fontWeight: '700',
            marginTop: theme.spacing.md,
          }}
        >
          GoldFinch
        </Text>
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: theme.text.body,
            marginTop: theme.spacing.xs,
            textAlign: 'center',
          }}
        >
          Private household finance
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => void handleSignIn()}
          disabled={busy}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: theme.colors.accent,
              borderRadius: theme.radius.md,
              paddingHorizontal: theme.spacing.xl,
              paddingVertical: theme.spacing.sm + 4,
              marginTop: theme.spacing.xl,
              opacity: pressed || busy ? 0.8 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.onAccent} />
          ) : (
            <Text
              style={{
                color: theme.colors.onAccent,
                fontSize: theme.text.body,
                fontWeight: '600',
              }}
            >
              Sign in
            </Text>
          )}
        </Pressable>

        {error ? (
          <Text
            style={{
              color: theme.colors.danger,
              fontSize: theme.text.caption,
              marginTop: theme.spacing.md,
              textAlign: 'center',
            }}
          >
            {error}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  button: { alignItems: 'center', minWidth: 180 },
  logo: { width: 140, height: 140 },
});
