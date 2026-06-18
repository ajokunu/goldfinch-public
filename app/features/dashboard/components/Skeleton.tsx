/**
 * Lightweight loading skeleton: plain blocks shaped like each card's content,
 * wrapped in the motion module's LoadingPulse breathe (PHASE9-DECISIONS
 * P9-1: feature code consumes motion primitives only -- the primitive owns
 * the loop, the reduced-motion collapse, and the global kill switch).
 */
import { StyleSheet, View, type DimensionValue } from 'react-native';

import { LoadingPulse } from '../../../src/ui/motion';
import { useTheme } from '../../../src/ui/ThemeProvider';
import { Card } from './Card';

function Block({ width, height }: { width: DimensionValue; height: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width,
        height,
        backgroundColor: theme.colors.surfaceAlt,
        borderRadius: theme.radius.sm,
      }}
    />
  );
}

/**
 * Generic card skeleton: a short title block, an optional large headline
 * block (net-worth card), then `rows` two-column row placeholders. One
 * LoadingPulse drives the whole group, so the blocks breathe in sync off a
 * single animated node.
 */
export function CardSkeleton({
  rows = 3,
  headline = false,
}: {
  rows?: number;
  headline?: boolean;
}) {
  const theme = useTheme();
  return (
    <Card>
      <LoadingPulse>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Loading"
          style={{ gap: theme.spacing.sm }}
        >
          <Block width="40%" height={theme.text.heading} />
          {headline ? (
            <Block width="70%" height={theme.text.title + 8} />
          ) : null}
          {Array.from({ length: rows }, (_, index) => (
            <View key={index} style={styles.row}>
              <Block width="55%" height={theme.text.body} />
              <Block width="22%" height={theme.text.body} />
            </View>
          ))}
        </View>
      </LoadingPulse>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
});
