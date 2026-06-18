/**
 * Attachment viewer route (P7-9): full-screen view of one transaction
 * attachment, fetched via the presigned download URL from
 * GET /transactions/{txnId}/attachments/{attachId}.
 *
 * Thin typed route binding; the screen body is owned by the attachments
 * feature (features/attachments/). Hidden from the tab bar via href: null in
 * app/(app)/_layout.tsx.
 */
import { useLocalSearchParams } from 'expo-router';

import AttachmentViewerScreen from '../../../../features/attachments';

export default function AttachmentViewerRoute() {
  const { txnId, attachId } = useLocalSearchParams<{
    txnId: string;
    attachId: string;
  }>();
  return (
    <AttachmentViewerScreen
      txnId={typeof txnId === 'string' && txnId.length > 0 ? txnId : null}
      attachId={typeof attachId === 'string' && attachId.length > 0 ? attachId : null}
    />
  );
}
