/**
 * Attachments section for the transaction detail view (P7-9): thumbnail grid
 * of uploaded attachments, in-flight upload tiles with progress, capture/pick
 * entry points, and per-tile two-step delete. Mounted inside the transaction
 * detail modal; tapping a tile closes the modal (via onBeforeNavigate) before
 * pushing the full-screen viewer route, because a screen pushed underneath an
 * open RN <Modal> would be invisible on native.
 *
 * All list/empty/error states use the shared state components -- no silent
 * blanks; pick, validation, upload, and delete failures all render inline.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Camera, Paperclip } from 'lucide-react-native';
import type { AttachmentDto } from '@goldfinch/shared/types';

import { useTheme } from '../../../src/ui/ThemeProvider';
import { EmptyState, ErrorState, LoadingState } from '../../../src/ui/States';
import { useDeleteAttachment } from '../../../src/api/mutations';
import { useAttachmentsQuery } from '../hooks/useAttachments';
import { useAttachmentUploads } from '../hooks/useAttachmentUploads';
import { AttachmentTile } from './AttachmentTile';
import { UploadTile } from './UploadTile';

export interface AttachmentsSectionProps {
  txnId: string;
  /** Called right before navigating to the viewer (close the host modal). */
  onBeforeNavigate?: () => void;
}

export function AttachmentsSection({ txnId, onBeforeNavigate }: AttachmentsSectionProps) {
  const theme = useTheme();
  const router = useRouter();

  const listQuery = useAttachmentsQuery(txnId);
  const uploadsApi = useAttachmentUploads(txnId);
  const deleteAttachment = useDeleteAttachment();
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const openViewer = (attachment: AttachmentDto): void => {
    onBeforeNavigate?.();
    router.push({
      pathname: '/attachments/[txnId]/[attachId]',
      params: { txnId, attachId: attachment.attachId },
    });
  };

  const handleDeletePress = (attachment: AttachmentDto): void => {
    if (confirmingDeleteId !== attachment.attachId) {
      // First tap arms the tile; the second tap on the danger button confirms.
      setConfirmingDeleteId(attachment.attachId);
      return;
    }
    setConfirmingDeleteId(null);
    deleteAttachment.mutate({ txnId, attachId: attachment.attachId });
  };

  const deletingAttachId =
    deleteAttachment.isPending ? deleteAttachment.variables.attachId : null;

  const visibleAttachments = (listQuery.data ?? []).filter(
    (attachment) => !uploadsApi.inFlightAttachIds.has(attachment.attachId),
  );

  let body;
  if (listQuery.isPending) {
    body = <LoadingState />;
  } else if (listQuery.isError) {
    body = (
      <ErrorState
        message={`Attachments could not be loaded. ${listQuery.error.message}`}
        onRetry={() => void listQuery.refetch()}
      />
    );
  } else if (visibleAttachments.length === 0 && uploadsApi.uploads.length === 0) {
    body = (
      <EmptyState
        title="No attachments yet"
        body="Add a receipt photo or a PDF document."
      />
    );
  } else {
    body = (
      <View style={[styles.grid, { gap: theme.spacing.sm }]}>
        {visibleAttachments.map((attachment) => (
          <AttachmentTile
            key={attachment.attachId}
            txnId={txnId}
            attachment={attachment}
            confirmingDelete={confirmingDeleteId === attachment.attachId}
            deleting={deletingAttachId === attachment.attachId}
            onOpen={openViewer}
            onDeletePress={handleDeletePress}
          />
        ))}
        {uploadsApi.uploads.map((entry) => (
          <UploadTile
            key={entry.localId}
            entry={entry}
            onRetry={uploadsApi.retry}
            onDismiss={uploadsApi.dismiss}
          />
        ))}
      </View>
    );
  }

  const errorTextStyle = {
    color: theme.colors.danger,
    fontSize: theme.text.caption,
    marginTop: theme.spacing.sm,
  } as const;

  const actionButtonStyle = ({ pressed }: { pressed: boolean }) => [
    styles.actionButton,
    {
      backgroundColor: pressed ? theme.colors.surfaceAlt : theme.colors.surface,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
  ];

  return (
    <View>
      <Text
        style={{
          color: theme.colors.textSecondary,
          fontSize: theme.text.caption,
          marginBottom: theme.spacing.xs,
        }}
      >
        Attachments
      </Text>

      {body}

      <View style={[styles.actions, { gap: theme.spacing.sm, marginTop: theme.spacing.sm }]}>
        <Pressable
          onPress={() => uploadsApi.add('camera')}
          accessibilityRole="button"
          accessibilityLabel="Take a photo attachment"
          style={actionButtonStyle}
        >
          <Camera size={16} color={theme.colors.accent} />
          <Text style={[styles.actionLabel, { color: theme.colors.textPrimary }]}>
            Take photo
          </Text>
        </Pressable>
        <Pressable
          onPress={() => uploadsApi.add('file')}
          accessibilityRole="button"
          accessibilityLabel="Add a file attachment"
          style={actionButtonStyle}
        >
          <Paperclip size={16} color={theme.colors.accent} />
          <Text style={[styles.actionLabel, { color: theme.colors.textPrimary }]}>
            Add file
          </Text>
        </Pressable>
      </View>

      {uploadsApi.pickError ? <Text style={errorTextStyle}>{uploadsApi.pickError}</Text> : null}
      {deleteAttachment.isError ? (
        <Text style={errorTextStyle}>
          The attachment could not be removed. {deleteAttachment.error.message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  actions: { flexDirection: 'row' },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: { fontSize: 14, fontWeight: '600' },
});
