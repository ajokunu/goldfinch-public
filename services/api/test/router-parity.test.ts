/**
 * Router <-> manifest parity. The gateway route table is DERIVED from
 * @goldfinch/shared API_ROUTES (and infra has its own parity test), so every
 * manifest key MUST resolve to a handler here — an unmapped key would deploy
 * as a live JWT-gated route that can only ever 404.
 */

import { describe, expect, it } from 'vitest';
import { API_ROUTES } from '@goldfinch/shared/constants';
import { routes } from '../src/router.js';

describe('router parity with the shared API_ROUTES manifest', () => {
  it('maps every manifest route key to a handler', () => {
    const missing = Object.values(API_ROUTES).filter(
      (routeKey) => typeof routes[routeKey] !== 'function',
    );
    expect(missing).toEqual([]);
  });

  it('keeps the documented aliases working', () => {
    expect(routes['GET /networth']).toBe(routes[API_ROUTES.summary]);
    expect(routes['PUT /budgets/{categoryId}']).toBe(routes[API_ROUTES.patchBudget]);
  });
});
