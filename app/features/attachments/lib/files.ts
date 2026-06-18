/**
 * Attachment file helpers (P7-9): content-type resolution against the shared
 * allowlist and human-readable byte sizes. The server re-validates everything
 * (allowlist + ATTACHMENT_MAX_BYTES are signed into the presigned PUT), so
 * these checks exist to fail fast with a clear message before any network
 * round trip.
 */
import {
  ATTACHMENT_ALLOWED_CONTENT_TYPES,
  type AttachmentContentType,
} from '@goldfinch/shared/constants';

/** Extension fallback for platforms that report no MIME type (or report it wrong). */
const EXTENSION_CONTENT_TYPES: Record<string, AttachmentContentType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

function isAllowedContentType(value: string): value is AttachmentContentType {
  return (ATTACHMENT_ALLOWED_CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * Resolve a picked file to an allowed attachment content type, preferring the
 * platform-reported MIME type and falling back to the file extension. Returns
 * null when the file is not an allowed image/PDF type.
 */
export function resolveAttachmentContentType(file: {
  name: string;
  mimeType: string | null;
}): AttachmentContentType | null {
  const mime = file.mimeType?.toLowerCase().split(';')[0]?.trim();
  if (mime) {
    if (isAllowedContentType(mime)) return mime;
    // Common non-standard alias some pickers report.
    if (mime === 'image/jpg') return 'image/jpeg';
  }
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension) return null;
  return EXTENSION_CONTENT_TYPES[extension] ?? null;
}

export function isImageContentType(contentType: string): boolean {
  return contentType.startsWith('image/');
}

/** "812 B" / "4.2 KB" / "9.8 MB" -- display only, never used for validation. */
export function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return `${sizeBytes} B`;
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}
