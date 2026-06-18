/**
 * Presigned-PUT upload with progress (P7-9).
 *
 * XMLHttpRequest instead of fetch because fetch exposes no upload progress on
 * any of our platforms; RN and the browser both implement xhr.upload progress
 * events. The Content-Type header MUST be exactly the value the API signed
 * into the URL (it also signed the Content-Length, which XHR derives from the
 * Blob), otherwise S3 rejects the signature.
 */
import { logger } from '../../../src/lib/logger';

export class AttachmentUploadError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'AttachmentUploadError';
    this.status = status;
  }
}

export interface UploadToPresignedUrlOptions {
  url: string;
  blob: Blob;
  /** Must match the content type signed into the presigned URL. */
  contentType: string;
  /** Fraction 0..1; called at least once with 1 on success. */
  onProgress?: (fraction: number) => void;
}

/**
 * PUT the blob to the presigned URL. Resolves on any 2xx; rejects with
 * AttachmentUploadError (after logging) on HTTP failure, network error,
 * abort, or timeout -- failures are never silent.
 */
export function uploadToPresignedUrl(
  options: UploadToPresignedUrlOptions,
): Promise<void> {
  const { url, blob, contentType, onProgress } = options;
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const fail = (error: AttachmentUploadError): void => {
      logger.error('Presigned upload failed', {
        status: error.status,
        sizeBytes: blob.size,
        contentType,
        error,
      });
      reject(error);
    };

    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);

    if (xhr.upload) {
      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress?.(Math.min(1, event.loaded / event.total));
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      fail(
        new AttachmentUploadError(
          `The storage service rejected the upload (HTTP ${xhr.status}).`,
          xhr.status,
        ),
      );
    };
    xhr.onerror = () =>
      fail(new AttachmentUploadError('The upload failed (network error).'));
    xhr.onabort = () => fail(new AttachmentUploadError('The upload was cancelled.'));
    xhr.ontimeout = () => fail(new AttachmentUploadError('The upload timed out.'));

    xhr.send(blob);
  });
}
