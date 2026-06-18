/**
 * One in-flight (or failed) upload in the thumbnail grid (P7-9): progress bar
 * + percentage while the presigned PUT runs, and an explicit error state with
 * retry/dismiss when any pipeline step fails. Failures are always surfaced --
 * the entry stays on screen until the user acts on it.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RotateCw, X } from 'lucide-react-native';

import { useTheme } from '../../../src/ui/ThemeProvider';
import type { UploadEntry } from '../hooks/useAttachmentUploads';
import { TILE_SIZE } from './AttachmentTile';

export interface UploadTileProps {
  entry: UploadEntry;
  onRetry: (localId: string) => void;
  onDismiss: (localId: string) => void;
}

export function UploadTile({ entry, onRetry, onDismiss }: UploadTileProps) {
  const theme = useTheme();
  const isError = entry.phase === 'error';
  const percent = Math.round(entry.progress * 100);

  return (
    <View
      style={[
        styles.tile,
        {
          backgroundColor: theme.colors.surface,
          borderColor: isError ? theme.colors.danger : theme.colors.border,
          borderRadius: theme.radius.md,
          padding: theme.spacing.xs,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={{ color: theme.colors.textPrimary, fontSize: 10, fontWeight: '600' }}
      >
        {entry.fileName}
      </Text>

      {isError ? (
        <>
          <Text
            numberOfLines={3}
            style={[styles.grow, { color: theme.colors.danger, fontSize: 10 }]}
          >
            {entry.error ?? 'The upload failed.'}
          </Text>
          <View style={styles.actions}>
            {entry.canRetry ? (
              <Pressable
                onPress={() => onRetry(entry.localId)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Retry uploading ${entry.fileName}`}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <RotateCw size={16} color={theme.colors.accent} />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => onDismiss(entry.localId)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss failed upload ${entry.fileName}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <X size={16} color={theme.colors.textSecondary} />
            </Pressable>
          </View>
        </>
      ) : (
        <View style={[styles.grow, styles.progressArea]}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>
            {entry.phase === 'preparing' ? 'Preparing' : `${percent}%`}
          </Text>
          <View
            style={[
              styles.progressTrack,
              { backgroundColor: theme.colors.surfaceAlt, borderRadius: 2 },
            ]}
          >
            <View
              style={{
                width: `${entry.phase === 'preparing' ? 4 : Math.max(4, percent)}%`,
                height: '100%',
                backgroundColor: theme.colors.accent,
                borderRadius: 2,
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  grow: { flex: 1 },
  progressArea: { justifyContent: 'center', gap: 6 },
  progressTrack: { height: 4, width: '100%', overflow: 'hidden' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    alignItems: 'center',
  },
});
