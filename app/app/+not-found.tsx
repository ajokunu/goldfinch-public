import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { CircleHelp } from 'lucide-react-native';

import { Screen } from '../src/ui/Screen';
import { useTheme } from '../src/ui/ThemeProvider';

export default function NotFoundScreen() {
  const theme = useTheme();
  return (
    <Screen>
      <View style={styles.center}>
        <CircleHelp size={32} color={theme.colors.textSecondary} />
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.heading,
            fontWeight: '600',
            marginTop: theme.spacing.md,
          }}
        >
          Page not found
        </Text>
        <Link
          href="/"
          style={{
            color: theme.colors.accent,
            fontSize: theme.text.body,
            marginTop: theme.spacing.md,
          }}
        >
          Go home
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
