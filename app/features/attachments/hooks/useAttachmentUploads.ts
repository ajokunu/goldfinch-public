/**
 * Upload pipeline for transaction attachments (P7-9):
 *
 *   capture/pick -> client validation (allowlist + 10 MiB, same constants the
 *   server enforces) -> POST metadata for a presigned PUT -> XHR PUT with
 *   progress -> attachment-list invalidation.
 *
 * Every in-flight upload is a visible entry with progress; every failure path
 * is logged with context AND surfaced in the entry (or in pickError for
 * failures that happen before a file is accepted). When the PUT fails after
 * the metadata row was created, a best-effort cleanup DELETE removes the
 * orphaned 'pending' row (logged via fireAndForget if that also fails -- the
 * row then shows up as a broken tile with its own delete affordance, so
 * nothing is ever silently lost).
 */
import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ATTACHMENT_ALLOWED_CONTENT_TYPES,
  ATTACHMENT_MAX_BYTES,
  type AttachmentContentType,
} from '@goldfinch/shared/constants';

import { useCreateAttachment } from '../../../src/api/mutations';
import { deleteAttachment } from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';
import { ApiError } from '../../../src/api/errors';
import { pickFile, FilePickerError, type PickedFile } from '../../../src/lib/filePicker';
import { fireAndForget, logger } from '../../../src/lib/logger';
import { capturePhoto, CameraCaptureError } from '../lib/camera';
import { resolveAttachmentContentType, formatBytes } from '../lib/files';
import { uploadToPresignedUrl, AttachmentUploadError } from '../lib/upload';

export type UploadPhase = 'preparing' | 'uploading' | 'error';

export interface UploadEntry {
  localId: string;
  fileName: string;
  contentType: AttachmentContentType;
  /** Fraction 0..1 (only meaningful while phase === 'uploading'). */
  progress: number;
  phase: UploadPhase;
  /** Surfaced failure copy; set exactly when phase === 'error'. */
  error?: string;
  /** False for failures retrying cannot fix (e.g. file too large). */
  canRetry: boolean;
  /** Set once the metadata row exists server-side. */
  attachId?: string;
}

export type UploadSource = 'camera' | 'file';

export interface UseAttachmentUploadsResult {
  uploads: UploadEntry[];
  /** Pick/capture failure that happened before an upload entry existed. */
  pickError: string | null;
  add(source: UploadSource): void;
  retry(localId: string): void;
  dismiss(localId: string): void;
  /** attachIds owned by visible entries; the list view filters these out. */
  inFlightAttachIds: ReadonlySet<string>;
}

const TOO_LARGE_MESSAGE = `File is larger than the ${formatBytes(
  ATTACHMENT_MAX_BYTES,
)} attachment limit.`;

function unsupportedTypeMessage(fileName: string): string {
  return `"${fileName}" is not a supported type. Use JPEG, PNG, WebP, HEIC, or PDF.`;
}

/** Thrown for failures a retry cannot fix; carries user-facing copy. */
class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentValidationError';
  }
}

function failureMessage(error: unknown): string {
  if (
    error instanceof AttachmentValidationError ||
    error instanceof AttachmentUploadError ||
    error instanceof ApiError
  ) {
    return error.message;
  }
  return 'The upload failed. Try again.';
}

export function useAttachmentUploads(txnId: string): UseAttachmentUploadsResult {
  const queryClient = useQueryClient();
  const createAttachment = useCreateAttachment();

  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  /** Picked files retained for retry; keyed by localId. */
  const filesRef = useRef(new Map<string, PickedFile>());
  const nextIdRef = useRef(0);

  const updateEntry = useCallback(
    (localId: string, patch: Partial<UploadEntry>): void => {
      setUploads((entries) =>
        entries.map((entry) =>
          entry.localId === localId ? { ...entry, ...patch } : entry,
        ),
      );
    },
    [],
  );

  const removeEntry = useCallback((localId: string): void => {
    filesRef.current.delete(localId);
    setUploads((entries) => entries.filter((entry) => entry.localId !== localId));
  }, []);

  const runUpload = useCallback(
    async (
      localId: string,
      file: PickedFile,
      contentType: AttachmentContentType,
    ): Promise<void> => {
      let attachId: string | undefined;
      try {
        const blob = await file.blob();
        if (blob.size <= 0) {
          throw new AttachmentValidationError('The file is empty.');
        }
        if (blob.size > ATTACHMENT_MAX_BYTES) {
          throw new AttachmentValidationError(TOO_LARGE_MESSAGE);
        }

        const created = await createAttachment.mutateAsync({
          txnId,
          body: { fileName: file.name, contentType, sizeBytes: blob.size },
        });
        attachId = created.item.attachId;
        updateEntry(localId, { attachId, phase: 'uploading', progress: 0 });

        await uploadToPresignedUrl({
          url: created.uploadUrl,
          blob,
          contentType,
          onProgress: (fraction) => updateEntry(localId, { progress: fraction }),
        });

        removeEntry(localId);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.attachments.byTxn(txnId),
        });
      } catch (error) {
        logger.error('Attachment upload failed', {
          txnId,
          attachId,
          fileName: file.name,
          contentType,
          error,
        });
        if (attachId !== undefined) {
          // The metadata row exists but the object does not; remove it so a
          // retry starts clean. If this also fails it is logged, and the
          // orphan surfaces in the list as a broken tile with its own delete.
          const orphanId = attachId;
          fireAndForget(
            deleteAttachment(txnId, orphanId).then(() =>
              queryClient.invalidateQueries({
                queryKey: queryKeys.attachments.byTxn(txnId),
              }),
            ),
            'attachment metadata cleanup',
            { txnId, attachId: orphanId },
          );
        }
        updateEntry(localId, {
          phase: 'error',
          progress: 0,
          attachId: undefined,
          error: failureMessage(error),
          canRetry: !(error instanceof AttachmentValidationError),
        });
      }
    },
    [createAttachment, queryClient, removeEntry, txnId, updateEntry],
  );

  const add = useCallback(
    (source: UploadSource): void => {
      setPickError(null);
      const pick = async (): Promise<void> => {
        let file: PickedFile | null;
        try {
          file =
            source === 'camera'
              ? await capturePhoto()
              : await pickFile({ mimeTypes: ATTACHMENT_ALLOWED_CONTENT_TYPES });
        } catch (error) {
          // capturePhoto/pickFile already logged the failure with context.
          setPickError(
            error instanceof CameraCaptureError || error instanceof FilePickerError
              ? error.message
              : 'Choosing a file failed. Try again.',
          );
          return;
        }
        if (file === null) return; // user cancelled
        const picked = file;

        const contentType = resolveAttachmentContentType(picked);
        if (contentType === null) {
          logger.warn('Rejected attachment with unsupported content type', {
            txnId,
            fileName: picked.name,
            mimeType: picked.mimeType,
          });
          setPickError(unsupportedTypeMessage(picked.name));
          return;
        }
        if (picked.size !== null && picked.size > ATTACHMENT_MAX_BYTES) {
          logger.warn('Rejected attachment over the size cap', {
            txnId,
            fileName: picked.name,
            sizeBytes: picked.size,
          });
          setPickError(TOO_LARGE_MESSAGE);
          return;
        }

        nextIdRef.current += 1;
        const localId = `upload-${Date.now()}-${nextIdRef.current}`;
        filesRef.current.set(localId, picked);
        setUploads((entries) => [
          ...entries,
          {
            localId,
            fileName: picked.name,
            contentType,
            progress: 0,
            phase: 'preparing',
            canRetry: true,
          },
        ]);
        await runUpload(localId, picked, contentType);
      };
      // pick() handles every failure internally; this guards the impossible.
      fireAndForget(pick(), 'attachment add', { txnId, source });
    },
    [runUpload, txnId],
  );

  const retry = useCallback(
    (localId: string): void => {
      const file = filesRef.current.get(localId);
      const entry = uploads.find((candidate) => candidate.localId === localId);
      if (!file || !entry) {
        logger.warn('Retry requested for an unknown upload entry', { txnId, localId });
        removeEntry(localId);
        return;
      }
      updateEntry(localId, {
        phase: 'preparing',
        progress: 0,
        error: undefined,
        attachId: undefined,
      });
      fireAndForget(
        runUpload(localId, file, entry.contentType),
        'attachment retry',
        { txnId, localId, fileName: entry.fileName },
      );
    },
    [removeEntry, runUpload, txnId, updateEntry, uploads],
  );

  const dismiss = useCallback(
    (localId: string): void => removeEntry(localId),
    [removeEntry],
  );

  const inFlightAttachIds = new Set<string>();
  for (const entry of uploads) {
    if (entry.attachId !== undefined) inFlightAttachIds.add(entry.attachId);
  }

  return { uploads, pickError, add, retry, dismiss, inFlightAttachIds };
}
