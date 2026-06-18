/**
 * Loads the shell's display identity from the stored Cognito ID token
 * (design-spec shell.md 3.1): tokenStore keeps the ID token for exactly this,
 * decoded with the unverified-payload reader in app/src/lib/jwt.ts. Display
 * only -- never an authorization input, never sent to the API.
 *
 * Failure shape: any unavailable/undecodable claim path logs a warning with
 * context and renders the EMPTY_PROFILE (profile chrome without identity
 * text), exactly as the spec's "claims unavailable" branch requires.
 */
import { useEffect, useState } from 'react';

import { getIdToken } from '../../auth/tokenStore';
import { decodeJwtPayload } from '../../lib/jwt';
import { logger } from '../../lib/logger';
import {
  EMPTY_PROFILE,
  profileFromClaims,
  type ProfileClaims,
} from './profileClaims';

export type { ProfileClaims } from './profileClaims';

export function useProfileClaims(): ProfileClaims {
  const [profile, setProfile] = useState<ProfileClaims>(EMPTY_PROFILE);

  useEffect(() => {
    let mounted = true;
    getIdToken()
      .then((idToken) => {
        if (idToken === null) {
          logger.warn('profile claims unavailable', {
            reason: 'no ID token in secure storage',
          });
          return;
        }
        const payload = decodeJwtPayload(idToken);
        if (payload === null) {
          logger.warn('profile claims unavailable', {
            reason: 'ID token payload did not decode',
          });
          return;
        }
        if (mounted) setProfile(profileFromClaims(payload));
      })
      .catch((error: unknown) => {
        logger.warn('profile claims unavailable', { error });
      });
    return () => {
      mounted = false;
    };
  }, []);

  return profile;
}
