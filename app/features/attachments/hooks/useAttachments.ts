/**
 * Attachment read hooks (P7-9), shared by the transaction-detail attachments
 * section and the full-screen viewer. Keys come from the shared factory;
 * download-URL queries extend the byTxn prefix so list invalidation also
 * sweeps any presigned URLs for that transaction.
 */
import { useQuery } from '@tanstack/react-query';
import { ATTACHMENT_PRESIGN_TTL_SECONDS } from '@goldfinch/shared/constants';

import { getAttachmentDownload, listAttachments } from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';

/** GET /transactions/{txnId}/attachments -- metadata list. */
export function useAttachmentsQuery(txnId: string) {
  return useQuery({
    queryKey: queryKeys.attachments.byTxn(txnId),
    queryFn: ({ signal }) => listAttachments(txnId, signal),
    select: (response) => response.items,
  });
}

/**
 * Presigned URLs live ATTACHMENT_PRESIGN_TTL_SECONDS (300s); treat them as
 * fresh for one minute less so a URL handed to <Image> never starts its
 * fetch already expired.
 */
const DOWNLOAD_URL_FRESH_MS = (ATTACHMENT_PRESIGN_TTL_SECONDS - 60) * 1000;

/** GET .../attachments/{attachId} -- short-lived presigned download URL. */
export function useAttachmentDownloadUrl(
  txnId: string,
  attachId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: [...queryKeys.attachments.byTxn(txnId), 'download', attachId] as const,
    queryFn: ({ signal }) => getAttachmentDownload(txnId, attachId, signal),
    select: (response) => response.downloadUrl,
    enabled,
    staleTime: DOWNLOAD_URL_FRESH_MS,
    gcTime: DOWNLOAD_URL_FRESH_MS,
  });
}
