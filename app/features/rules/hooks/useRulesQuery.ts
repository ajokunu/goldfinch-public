/**
 * Rules list query: GET /rules through the shared endpoint + query-key
 * factory, re-sorted client-side with the shared compareRulePrecedence so
 * the list always renders in true evaluation order (matchType precedence,
 * then priority ascending, then longer pattern, then ruleId) even if a
 * cached payload predates a reorder.
 */
import { useQuery } from '@tanstack/react-query';
import { compareRulePrecedence } from '@goldfinch/shared/rules';

import { listRules } from '../../../src/api/endpoints';
import { queryKeys } from '../../../src/api/queryKeys';

export function useRulesQuery() {
  return useQuery({
    queryKey: queryKeys.rules.all(),
    queryFn: ({ signal }) => listRules(signal),
    select: (response) => [...response.items].sort(compareRulePrecedence),
  });
}
