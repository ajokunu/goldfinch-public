/**
 * Step 4: batched import progress and the final report (P7-6).
 *
 * While running: batch/row progress against IMPORT_MAX_ROWS_PER_BATCH-sized
 * batches. When finished (or failed): a full accounting of every data row in
 * the file -- imported, skipped duplicates, and a per-row error report
 * covering normalization failures, server-rejected batches, and unattempted
 * batches. Imported + duplicates + reported failures always equals the
 * file's data row count: nothing is dropped silently.
 */
import { StyleSheet, Text, View } from 'react-native';
import { CircleCheck, CircleAlert } from 'lucide-react-native';
import type { AccountDto } from '@goldfinch/shared/types';

import { useTheme } from '../../../src/ui/ThemeProvider';
import type { ImportRunState } from '../hooks/useImportRunner';
import type { RowFailure } from '../lib/mapping';
import { Button } from './Buttons';
import { ErrorReportList } from './ErrorReportList';

export interface RunStepProps {
  state: ImportRunState;
  account: AccountDto;
  fileName: string;
  /** Failures known before any request was sent (parse/normalize/oversize). */
  preFailures: readonly RowFailure[];
  onRetry: () => void;
  onStartOver: () => void;
}

export function RunStep({
  state,
  account,
  fileName,
  preFailures,
  onRetry,
  onStartOver,
}: RunStepProps) {
  const theme = useTheme();

  const allFailures: RowFailure[] = [...preFailures, ...state.failures];
  const accountedRows = state.created + state.duplicates + allFailures.length;
  const totalDataRows = state.rowsTotal + preFailures.length;
  const progress =
    state.rowsTotal > 0 ? Math.min(state.rowsProcessed / state.rowsTotal, 1) : 0;

  const caption = {
    color: theme.colors.textSecondary,
    fontSize: theme.text.caption,
  } as const;

  // 'idle' renders the progress scaffold too: the runner flips to 'running'
  // synchronously when the wizard enters this step.
  if (state.phase === 'running' || state.phase === 'idle') {
    return (
      <View>
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.heading,
            fontWeight: '700',
            marginBottom: theme.spacing.xs,
          }}
        >
          Importing into {account.name}
        </Text>
        <Text style={[caption, { marginBottom: theme.spacing.md }]}>
          Batch {Math.min(state.batchesDone + 1, state.batchesTotal)} of {state.batchesTotal}
          {' | '}
          {state.rowsProcessed} of {state.rowsTotal} rows processed
        </Text>
        <View
          style={[
            styles.track,
            {
              backgroundColor: theme.colors.surfaceAlt,
              borderRadius: theme.radius.sm,
              marginBottom: theme.spacing.md,
            },
          ]}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: state.rowsTotal, now: state.rowsProcessed }}
        >
          <View
            style={[
              styles.fill,
              {
                backgroundColor: theme.colors.accent,
                borderRadius: theme.radius.sm,
                width: `${Math.round(progress * 100)}%`,
              },
            ]}
          />
        </View>
        <Text style={caption}>
          {state.created} imported, {state.duplicates} already-imported rows skipped so far.
          Keep this screen open until the import finishes.
        </Text>
      </View>
    );
  }

  const failed = state.phase === 'failed';

  return (
    <View>
      <View style={[styles.headline, { marginBottom: theme.spacing.sm }]}>
        {failed ? (
          <CircleAlert size={24} color={theme.colors.danger} />
        ) : (
          <CircleCheck size={24} color={theme.colors.positive} />
        )}
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.heading,
            fontWeight: '700',
            marginLeft: theme.spacing.sm,
            flex: 1,
          }}
        >
          {failed ? 'Import stopped' : 'Import complete'}
        </Text>
      </View>

      {failed && state.errorMessage !== null ? (
        <Text
          style={{
            color: theme.colors.danger,
            fontSize: theme.text.body,
            marginBottom: theme.spacing.md,
          }}
        >
          {state.errorMessage}
        </Text>
      ) : null}

      <SummaryLine
        label={`Imported into ${account.name}`}
        value={String(state.created)}
      />
      <SummaryLine
        label="Skipped as already imported (re-import protection)"
        value={String(state.duplicates)}
      />
      <SummaryLine label="Rows not imported (listed below)" value={String(allFailures.length)} />
      <SummaryLine
        label={`Rows accounted for from ${fileName}`}
        value={`${accountedRows} of ${totalDataRows}`}
      />

      {state.duplicates > 0 ? (
        <Text style={[caption, { marginTop: theme.spacing.sm }]}>
          Duplicates are rows this exact file already imported into this
          account before -- the import id is derived from the file and
          account, so re-importing or retrying never creates second copies.
        </Text>
      ) : null}

      {allFailures.length > 0 ? (
        <>
          <Text
            style={{
              color: theme.colors.textPrimary,
              fontSize: theme.text.body,
              fontWeight: '700',
              marginTop: theme.spacing.md,
              marginBottom: theme.spacing.sm,
            }}
          >
            Rows that did not import
          </Text>
          <ErrorReportList failures={allFailures} />
        </>
      ) : null}

      <View style={{ height: theme.spacing.md }} />
      {failed ? (
        <>
          <Button label="Retry import" onPress={onRetry} />
          <View style={{ height: theme.spacing.sm }} />
        </>
      ) : null}
      <Button
        label="Import another file"
        variant={failed ? 'secondary' : 'primary'}
        onPress={onStartOver}
      />
    </View>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.summaryLine,
        {
          borderBottomColor: theme.colors.border,
          paddingVertical: theme.spacing.sm,
        },
      ]}
    >
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.body,
          flex: 1,
          marginRight: theme.spacing.sm,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: theme.colors.textPrimary,
          fontSize: theme.text.body,
          fontWeight: '700',
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { height: '100%' },
  headline: { alignItems: 'center', flexDirection: 'row' },
  summaryLine: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  track: { height: 10, overflow: 'hidden' },
});
