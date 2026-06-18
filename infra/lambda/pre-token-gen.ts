/**
 * Cognito Pre-Token-Generation trigger (V2_0 event version).
 *
 * Injects the constant household claim into the ACCESS token so the API never
 * has to translate Cognito sub -> household. Per the AUTHORITATIVE decisions
 * log: PK = USER#<household>, household = "goldfinch-home", always re-derived
 * server-side from the JWT. The V2 trigger is required because only V2 can
 * customize access-token claims.
 *
 * This function is infra-owned: it is tiny, has no dependencies beyond the
 * runtime, and needs no IAM beyond basic logging.
 */

interface AccessTokenGeneration {
  claimsToAddOrOverride?: Record<string, string>;
  claimsToSuppress?: string[];
  scopesToAdd?: string[];
  scopesToSuppress?: string[];
}

interface ClaimsAndScopeOverrideDetails {
  accessTokenGeneration?: AccessTokenGeneration;
  idTokenGeneration?: {
    claimsToAddOrOverride?: Record<string, string>;
    claimsToSuppress?: string[];
  };
}

export interface PreTokenGenV2Event {
  version: string;
  triggerSource: string;
  userPoolId: string;
  userName: string;
  request: {
    userAttributes: Record<string, string>;
    scopes?: string[];
  };
  response: {
    claimsAndScopeOverrideDetails?: ClaimsAndScopeOverrideDetails | null;
  };
}

const HOUSEHOLD_CLAIM = 'household';

export const handler = async (event: PreTokenGenV2Event): Promise<PreTokenGenV2Event> => {
  const household = process.env['HOUSEHOLD_ID'] ?? 'goldfinch-home';

  const existing = event.response.claimsAndScopeOverrideDetails ?? {};
  const accessTokenGeneration = existing.accessTokenGeneration ?? {};

  event.response.claimsAndScopeOverrideDetails = {
    ...existing,
    accessTokenGeneration: {
      ...accessTokenGeneration,
      claimsToAddOrOverride: {
        ...(accessTokenGeneration.claimsToAddOrOverride ?? {}),
        [HOUSEHOLD_CLAIM]: household,
      },
    },
  };

  return event;
};
