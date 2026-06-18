/**
 * One uploaded attachment in the thumbnail grid (P7-9): image attachments
 * render a presigned-URL thumbnail, PDFs render a document tile. Every tile
 * opens the full-screen viewer; the corner button drives a two-step delete
 * (first tap arms, second tap on the now-danger button confirms -- the same
 * cross-platform confirm pattern as the budget feature, since Alert.alert
 * does not exist on web).
 *
 * A thumbnail that fails to load (expired URL, or a 'pending' metadata row
 * whose object never arrived) shows an explicit broken state -- never a
 * silent blank -- and still opens the viewer, where retry lives.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FileText, ImageOff, Trash2, X } from 'lucide-react-native';
import type { AttachmentDto } from '@goldfinch/shared/types';

import { useTheme } from '../../../src/ui/ThemeProvider';
import { logger } from '../../../src/lib/logger';
import { useAttachmentDownloadUrl } from '../hooks/useAttachments';
import { isImageContentType } from '../lib/files';

export const TILE_SIZE = 96;

export interface AttachmentTileProps {
  txnId: string;
  attachment: AttachmentDto;
  /** Two-step delete: true once the first delete tap armed this tile. */
  confirmingDelete: boolean;
  /** True while the DELETE for this tile is in flight. */
  deleting: boolean;
  onOpen: (attachment: AttachmentDto) => void;
  onDeletePress: (attachment: AttachmentDto) => void;
}

export function AttachmentTile({
  txnId,
  attachment,
  confirmingDelete,
  deleting,
  onOpen,
  onDeletePress,
}: AttachmentTileProps) {
  const theme = useTheme();
  const isImage = isImageContentType(attachment.contentType);
  const [thumbFailed, setThumbFailed] = useState(false);

  const download = useAttachmentDownloadUrl(
    txnId,
    attachment.attachId,
    isImage && !thumbFailed,
  );

  let body;
  if (!isImage) {
    body = (
      <View style={styles.center}>
        <FileText size={28} color={theme.colors.textSecondary} />
        <Text
          numberOfLines={2}
          style={{
            color: theme.colors.textSecondary,
            fontSize: 10,
            textAlign: 'center',
            marginTop: theme.spacing.xs,
            paddingHorizontal: theme.spacing.xs,
          }}
        >
          {attachment.fileName}
        </Text>
      </View>
    );
  } else if (thumbFailed || download.isError) {
    body = (
      <View style={styles.center}>
        <ImageOff size={24} color={theme.colors.textSecondary} />
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 10,
            textAlign: 'center',
            marginTop: theme.spacing.xs,
          }}
        >
          Preview unavailable
        </Text>
      </View>
    );
  } else if (download.isPending || download.data === undefined) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} size="small" />
      </View>
    );
  } else {
    body = (
      <Image
        source={{ uri: download.data }}
        resizeMode="cover"
        style={styles.thumb}
        accessibilityLabel={attachment.fileName}
        onError={(event) => {
          logger.warn('Attachment thumbnail failed to load', {
            txnId,
            attachId: attachment.attachId,
            error: event.nativeEvent?.error,
          });
          setThumbFailed(true);
        }}
      />
    );
  }

  return (
    <Pressable
      onPress={() => onOpen(attachment)}
      disabled={deleting}
      accessibilityRole="button"
      accessibilityLabel={`Open attachment ${attachment.fileName}`}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: theme.colors.surface,
          borderColor: confirmingDelete ? theme.colors.danger : theme.colors.border,
          borderRadius: theme.radius.md,
          opacity: pressed || deleting ? 0.6 : 1,
        },
      ]}
    >
      {body}
      {deleting ? (
        <View style={[styles.center, StyleSheet.absoluteFill]}>
          <ActivityIndicator color={theme.colors.danger} size="small" />
        </View>
      ) : (
        <Pressable
          onPress={() => onDeletePress(attachment)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={
            confirmingDelete
              ? `Confirm removing ${attachment.fileName}`
              : `Remove ${attachment.fileName}`
          }
          style={[
            styles.deleteButton,
            {
              backgroundColor: confirmingDelete
                ? theme.colors.danger
                : theme.colors.surfaceAlt,
              borderColor: theme.colors.border,
            },
          ]}
        >
          {confirmingDelete ? (
            <Trash2 size={12} color={theme.colors.onAccent} />
          ) : (
            <X size={12} color={theme.colors.textSecondary} />
          )}
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  deleteButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
