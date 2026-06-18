/**
 * "Pending" badge on unposted transactions: thin wrapper over the kit Badge
 * (components.md 5.4 -- 10.5px caps, accent2 on a 16% accent2 tint). The
 * readable, localized label is passed through; the uppercase transform is
 * visual only.
 */
import { useT } from '../../../src/i18n';
import { Badge } from '../../../src/ui/Badge';

export function PendingBadge() {
  const t = useT();
  return <Badge label={t('Pending')} variant="pending" />;
}
