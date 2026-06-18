/**
 * Current-user identity for attribution lines (P7-9 "edited by" / "uploaded
 * by"). The API stamps lastEditedBy/uploadedBy with the Cognito sub; the only
 * sub the client can resolve to a person is its own (from the stored ID
 * token), so attribution renders as "you" vs "another household member".
 * There is no profile-lookup route in the API manifest, so the other member's
 * display name cannot be resolved client-side; the household has exactly two
 * members, which keeps "another household member" unambiguous.
 */
import { useEffect, useState } from 'react';

import { getIdToken } from '../../../src/auth/tokenStore';
import { decodeJwtPayload } from '../../../src/lib/jwt';
import { logger } from '../../../src/lib/logger';

/**
 * The current user's Cognito sub from the stored ID token.
 * undefined = still loading; null = no readable claim (logged).
 */
export function useCurrentUserSub(): string | null | undefined {
  const [sub, setSub] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getIdToken()
      .then((idToken) => {
        const payload = idToken ? decodeJwtPayload(idToken) : null;
        const value = payload?.['sub'];
        if (!cancelled) setSub(typeof value === 'string' ? value : null);
        if (typeof value !== 'string') {
          logger.warn('No sub claim readable from the stored ID token');
        }
      })
      .catch((error: unknown) => {
        logger.error('Reading identity claims for attribution failed', { error });
        if (!cancelled) setSub(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return sub;
}

/**
 * "<action> by you" / "<action> by another household member", degrading to
 * "by a household member" while the current sub is unknown.
 */
export function attributionLabel(
  action: string,
  actorSub: string,
  currentSub: string | null | undefined,
): string {
  if (currentSub === undefined || currentSub === null) {
    return `${action} by a household member`;
  }
  return actorSub === currentSub
    ? `${action} by you`
    : `${action} by another household member`;
}
