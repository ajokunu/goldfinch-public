/**
 * Per-row error report (P7-6: no silently dropped rows). Every row that did
 * not import appears here with its file line and reason. Identical reasons
 * are grouped so a large failed batch stays readable -- the group header
 * always carries the full row count, so nothing is hidden even when the
 * line-number list is elided.
 */
import { StyleSheet, Text, View } from 'react-native';
import { CircleAlert } from 'lucide-react-native';

import { useTheme } from '../../../src/ui/ThemeProvider';
import type { RowFailure } from '../lib/mapping';

/** Max line numbers spelled out per reason group. */
const MAX_LINES_LISTED = 40;

interface FailureGroup {
  reason: string;
  lines: number[];
}

function groupFailures(failures: readonly RowFailure[]): FailureGroup[] {
  const groups = new Map<string, number[]>();
  for (const failure of failures) {
    const lines = groups.get(failure.reason);
    if (lines === undefined) {
      groups.set(failure.reason, [failure.line]);
    } else {
      lines.push(failure.line);
    }
  }
  return [...groups.entries()]
    .map(([reason, lines]) => ({ reason, lines: [...lines].sort((a, b) => a - b) }))
    .sort((a, b) => (a.lines[0] ?? 0) - (b.lines[0] ?? 0));
}

export function ErrorReportList({ failures }: { failures: readonly RowFailure[] }) {
  const theme = useTheme();
  if (failures.length === 0) return null;
  const groups = groupFailures(failures);

  return (
    <View>
      {groups.map((group) => {
        const shown = group.lines.slice(0, MAX_LINES_LISTED);
        const hidden = group.lines.length - shown.length;
        return (
          <View
            key={group.reason}
            style={[
              styles.group,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                borderRadius: theme.radius.md,
                marginBottom: theme.spacing.sm,
                padding: theme.spacing.md,
              },
            ]}
          >
            <View style={styles.heading}>
              <CircleAlert size={16} color={theme.colors.danger} style={{ marginTop: 2 }} />
              <Text
                style={{
                  color: theme.colors.textPrimary,
                  fontSize: theme.text.body,
                  fontWeight: '600',
                  flex: 1,
                  marginLeft: theme.spacing.xs,
                }}
              >
                {group.lines.length} {group.lines.length === 1 ? 'row' : 'rows'}: {group.reason}
              </Text>
            </View>
            <Text
              style={{
                color: theme.colors.textSecondary,
                fontSize: theme.text.caption,
                marginTop: theme.spacing.xs,
              }}
            >
              {group.lines.length === 1 ? 'Line' : 'Lines'} {shown.join(', ')}
              {hidden > 0 ? ` and ${hidden} more` : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { borderWidth: 1 },
  heading: { flexDirection: 'row' },
});
