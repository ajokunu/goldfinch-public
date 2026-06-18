/**
 * Attachment viewer feature entry point (P7-9): full-screen view of one
 * transaction attachment behind /attachments/[txnId]/[attachId].
 *
 * - Metadata comes from the cached attachment list for the transaction (the
 *   API has no single-attachment metadata route); the bytes come from a
 *   short-lived presigned GET URL.
 * - Images render inline with an explicit failed state + retry (a retry
 *   refetches a fresh presigned URL, which is the usual fix for expiry).
 * - PDFs render a document card with an "Open PDF" action through
 *   expo-web-browser (in-app browser natively, a new tab on web).
 * - Delete is a two-step confirm; success navigates back, failure is
 *   surfaced inline. Uploaded-by attribution and size/date metadata shown.
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
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ChevronLeft, FileText, Trash2 } from 'lucide-react-native';

import { Screen } from '../../src/ui/Screen';
import { useTheme } from '../../src/ui/ThemeProvider';
import { EmptyState, ErrorState, LoadingState } from '../../src/ui/States';
import { useDeleteAttachment } from '../../src/api/mutations';
import { formatAsOf } from '../../src/lib/dates';
import { logger } from '../../src/lib/logger';
import { useAttachmentDownloadUrl, useAttachmentsQuery } from './hooks/useAttachments';
import { attributionLabel, useCurrentUserSub } from './hooks/useCurrentUserSub';
import { formatBytes, isImageContentType } from './lib/files';

export interface AttachmentViewerScreenProps {
  txnId: string | null;
  attachId: string | null;
}

export default function AttachmentViewerScreen({
  txnId,
  attachId,
}: AttachmentViewerScreenProps) {
  if (txnId === null || attachId === null) {
    return (
      <Screen>
        <ErrorState message="This attachment link is incomplete." />
      </Screen>
    );
  }
  return <ViewerBody txnId={txnId} attachId={attachId} />;
}

function ViewerBody({ txnId, attachId }: { txnId: string; attachId: string }) {
  const theme = useTheme();
  const router = useRouter();
  const currentSub = useCurrentUserSub();

  const listQuery = useAttachmentsQuery(txnId);
  const attachment = listQuery.data?.find((item) => item.attachId === attachId);

  const download = useAttachmentDownloadUrl(txnId, attachId, attachment !== undefined);

  const deleteMutation = useDeleteAttachment();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [openPdfError, setOpenPdfError] = useState<string | null>(null);

  const goBack = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // Cold deep link: there is no history; land on the transactions tab.
      router.replace('/transactions');
    }
  };

  const handleDeletePress = (): void => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    deleteMutation.mutate(
      { txnId, attachId },
      { onSuccess: () => goBack() },
    );
  };

  const retryImage = (): void => {
    setImageFailed(false);
    // A fresh refetch mints a new presigned URL (the usual fix for expiry).
    void download.refetch();
  };

  const openPdf = async (url: string): Promise<void> => {
    setOpenPdfError(null);
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (error) {
      logger.error('Opening PDF attachment failed', { txnId, attachId, error });
      setOpenPdfError('The PDF could not be opened. Try again.');
    }
  };

  // ---- content area --------------------------------------------------------
  let content;
  if (listQuery.isPending) {
    content = <LoadingState />;
  } else if (listQuery.isError) {
    content = (
      <ErrorState
        message={`The attachment could not be loaded. ${listQuery.error.message}`}
        onRetry={() => void listQuery.refetch()}
      />
    );
  } else if (attachment === undefined) {
    content = (
      <EmptyState
        title="Attachment not found"
        body="It may have been deleted on another device."
      />
    );
  } else if (download.isError) {
    content = (
      <ErrorState
        message={`The download link could not be created. ${download.error.message}`}
        onRetry={() => void download.refetch()}
      />
    );
  } else if (download.isPending || download.data === undefined) {
    content = <LoadingState />;
  } else if (isImageContentType(attachment.contentType)) {
    content = imageFailed ? (
      <ErrorState
        message="The image could not be loaded. The link may have expired."
        onRetry={retryImage}
      />
    ) : (
      <View style={styles.imageWrap}>
        <Image
          source={{ uri: download.data }}
          resizeMode="contain"
          style={styles.image}
          accessibilityLabel={attachment.fileName}
          onError={(event) => {
            logger.error('Attachment image failed to load', {
              txnId,
              attachId,
              error: event.nativeEvent?.error,
            });
            setImageFailed(true);
          }}
        />
      </View>
    );
  } else {
    const url = download.data;
    content = (
      <View style={[styles.pdfCard, { padding: theme.spacing.xl }]}>
        <FileText size={48} color={theme.colors.textSecondary} />
        <Text
          style={{
            color: theme.colors.textPrimary,
            fontSize: theme.text.body,
            fontWeight: '600',
            textAlign: 'center',
            marginTop: theme.spacing.md,
          }}
          numberOfLines={2}
        >
          {attachment.fileName}
        </Text>
        <Pressable
          onPress={() => void openPdf(url)}
          accessibilityRole="button"
          accessibilityLabel="Open PDF"
          style={({ pressed }) => ({
            backgroundColor: theme.colors.accent,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing.lg,
            paddingVertical: theme.spacing.sm + 2,
            marginTop: theme.spacing.lg,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text
            style={{
              color: theme.colors.onAccent,
              fontSize: theme.text.body,
              fontWeight: '600',
            }}
          >
            Open PDF
          </Text>
        </Pressable>
        {openPdfError ? (
          <Text
            style={{
              color: theme.colors.danger,
              fontSize: theme.text.caption,
              marginTop: theme.spacing.md,
              textAlign: 'center',
            }}
          >
            {openPdfError}
          </Text>
        ) : null}
      </View>
    );
  }

  // ---- metadata + delete footer (only when the attachment exists) ----------
  const uploadedAtSeconds = attachment
    ? Math.floor(Date.parse(attachment.createdAt) / 1000)
    : null;

  return (
    <Screen padded={false}>
      <View
        style={[
          styles.header,
          {
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.sm,
            borderBottomColor: theme.colors.border,
          },
        ]}
      >
        <Pressable
          onPress={goBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <ChevronLeft size={26} color={theme.colors.textPrimary} />
        </Pressable>
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: theme.colors.textPrimary,
            fontSize: theme.text.body,
            fontWeight: '600',
            marginHorizontal: theme.spacing.sm,
          }}
        >
          {attachment?.fileName ?? 'Attachment'}
        </Text>
        {attachment !== undefined ? (
          deleteMutation.isPending ? (
            <ActivityIndicator color={theme.colors.danger} size="small" />
          ) : (
            <Pressable
              onPress={handleDeletePress}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                confirmingDelete ? 'Confirm delete attachment' : 'Delete attachment'
              }
              style={({ pressed }) => [
                styles.deleteButton,
                {
                  backgroundColor: confirmingDelete
                    ? theme.colors.danger
                    : 'transparent',
                  borderRadius: theme.radius.sm,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xs,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Trash2
                size={18}
                color={confirmingDelete ? theme.colors.onAccent : theme.colors.danger}
              />
              {confirmingDelete ? (
                <Text
                  style={{
                    color: theme.colors.onAccent,
                    fontSize: theme.text.caption,
                    fontWeight: '600',
                    marginLeft: theme.spacing.xs,
                  }}
                >
                  Tap to confirm
                </Text>
              ) : null}
            </Pressable>
          )
        ) : null}
      </View>

      <View style={styles.content}>{content}</View>

      {attachment !== undefined ? (
        <View
          style={{
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            borderTopColor: theme.colors.border,
            borderTopWidth: StyleSheet.hairlineWidth,
          }}
        >
          <Text
            style={{ color: theme.colors.textSecondary, fontSize: theme.text.caption }}
          >
            {attributionLabel('Uploaded', attachment.uploadedBy, currentSub)}
            {uploadedAtSeconds !== null && Number.isFinite(uploadedAtSeconds)
              ? ` on ${formatAsOf(uploadedAtSeconds)}`
              : ''}
            {` (${formatBytes(attachment.sizeBytes)})`}
          </Text>
          {deleteMutation.isError ? (
            <Text
              style={{
                color: theme.colors.danger,
                fontSize: theme.text.caption,
                marginTop: theme.spacing.xs,
              }}
            >
              The attachment could not be deleted. {deleteMutation.error.message}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  deleteButton: { flexDirection: 'row', alignItems: 'center' },
  content: { flex: 1 },
  imageWrap: { flex: 1 },
  image: { flex: 1, width: '100%' },
  pdfCard: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
