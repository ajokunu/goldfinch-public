/**
 * Route-mocks the entire GoldFinch API origin inside a Playwright browser
 * context. Every GET endpoint the client's read hooks can fire (see
 * app/src/api/endpoints.ts) is served from the fixtures module; anything
 * unmatched is fulfilled with a 404 ErrorEnvelope AND recorded so the test
 * can fail loudly with the offending method+path instead of a vague timeout.
 *
 * The exported bundle calls the API cross-origin (EXPO_PUBLIC_API_URL), so
 * the mock also answers CORS preflights and attaches allow-origin headers --
 * Playwright-fulfilled responses still go through the browser's CORS checks.
 */
import type { BrowserContext, Route } from '@playwright/test';

import {
  cashflowResponse,
  currentIsoMonth,
  getAccountResponse,
  healthResponse,
  isoDaysFromToday,
  listAccountsResponse,
  listBudgetsResponse,
  listCategoriesResponse,
  listGoalsResponse,
  listHoldingsResponse,
  listRecurringResponse,
  listRulesResponse,
  listTransactionsResponse,
  netWorthHistoryResponse,
  profileResponse,
  reportsFlowResponse,
  reportsTrendsResponse,
  summaryResponse,
  type TransactionFilter,
} from './fixtures';

export interface ApiMock {
  /** Requests that hit the API origin but matched no mocked endpoint. */
  unmatched: string[];
  /** API requests that arrived without the injected bearer access token. */
  authViolations: string[];
  /** Total matched API calls served (sanity signal for the walkthrough). */
  served: number;
}

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,accept',
  'access-control-max-age': '600',
};

async function fulfillJson(
  route: Route,
  status: number,
  body: unknown,
): Promise<void> {
  await route.fulfill({
    status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
}

function transactionFilterFrom(url: URL): TransactionFilter {
  const params = url.searchParams;
  const limitText = params.get('limit');
  const filter: TransactionFilter = {};
  const from = params.get('from');
  if (from !== null) filter.from = from;
  const to = params.get('to');
  if (to !== null) filter.to = to;
  const q = params.get('q');
  if (q !== null) filter.q = q;
  if (params.get('pendingOnly') === 'true') filter.pendingOnly = true;
  if (limitText !== null) {
    const limit = Number(limitText);
    if (Number.isFinite(limit)) filter.limit = limit;
  }
  return filter;
}

/**
 * Resolve one mocked endpoint. Returns null when the path matches nothing --
 * the caller records it and serves a 404 envelope.
 */
function resolveEndpoint(
  method: string,
  url: URL,
): { status: number; body: unknown } | null {
  if (method !== 'GET') {
    // The walkthrough is read-only by design (live-data discipline); any
    // write reaching the network is a bug worth failing on.
    return null;
  }
  const path = url.pathname;

  if (path === '/health') return { status: 200, body: healthResponse() };
  if (path === '/profile') return { status: 200, body: profileResponse() };
  if (path === '/summary') return { status: 200, body: summaryResponse() };
  if (path === '/accounts') {
    return { status: 200, body: listAccountsResponse() };
  }

  const accountTxns = /^\/accounts\/([^/]+)\/transactions$/.exec(path);
  if (accountTxns !== null) {
    const accountId = decodeURIComponent(accountTxns[1] ?? '');
    return {
      status: 200,
      body: listTransactionsResponse({
        ...transactionFilterFrom(url),
        accountId,
      }),
    };
  }

  const accountHoldings = /^\/accounts\/([^/]+)\/holdings$/.exec(path);
  if (accountHoldings !== null) {
    const accountId = decodeURIComponent(accountHoldings[1] ?? '');
    return { status: 200, body: listHoldingsResponse(accountId) };
  }

  const account = /^\/accounts\/([^/]+)$/.exec(path);
  if (account !== null) {
    const dto = getAccountResponse(decodeURIComponent(account[1] ?? ''));
    return dto === null
      ? {
          status: 404,
          body: {
            error: { code: 'NOT_FOUND', message: 'account not found' },
          },
        }
      : { status: 200, body: dto };
  }

  if (path === '/transactions') {
    return {
      status: 200,
      body: listTransactionsResponse(transactionFilterFrom(url)),
    };
  }
  if (path === '/budgets') return { status: 200, body: listBudgetsResponse() };
  if (path === '/categories') {
    return { status: 200, body: listCategoriesResponse() };
  }
  if (path === '/cashflow') {
    const from = url.searchParams.get('from') ?? currentIsoMonth();
    const to = url.searchParams.get('to') ?? currentIsoMonth();
    return { status: 200, body: cashflowResponse(from, to) };
  }
  if (path === '/recurring') {
    return { status: 200, body: listRecurringResponse() };
  }
  if (path === '/goals') return { status: 200, body: listGoalsResponse() };
  if (path === '/rules') return { status: 200, body: listRulesResponse() };
  if (path === '/networth/history') {
    return { status: 200, body: netWorthHistoryResponse() };
  }
  if (path === '/reports/trends') {
    const monthsText = url.searchParams.get('months');
    const months = monthsText === null ? 6 : Number(monthsText);
    return {
      status: 200,
      body: reportsTrendsResponse(
        Number.isInteger(months) && months > 0 && months <= 24 ? months : 6,
      ),
    };
  }
  if (path === '/reports/flow') {
    const month = url.searchParams.get('month') ?? currentIsoMonth();
    return { status: 200, body: reportsFlowResponse(month) };
  }

  return null;
}

/**
 * Install the API mock on a context. Returns the recorder the test asserts
 * against (unmatched + auth violations must be empty at the end).
 */
export async function installApiMock(
  context: BrowserContext,
  apiOrigin: string,
  expectedAccessToken: string,
): Promise<ApiMock> {
  const recorder: ApiMock = { unmatched: [], authViolations: [], served: 0 };

  await context.route(`${apiOrigin}/**`, async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());

    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { ...CORS_HEADERS } });
      return;
    }

    const authorization = await request.headerValue('authorization');
    if (authorization !== `Bearer ${expectedAccessToken}`) {
      recorder.authViolations.push(`${method} ${url.pathname}`);
    }

    const resolved = resolveEndpoint(method, url);
    if (resolved === null) {
      recorder.unmatched.push(`${method} ${url.pathname}${url.search}`);
      await fulfillJson(route, 404, {
        error: {
          code: 'NOT_FOUND',
          message: `e2e mock has no fixture for ${method} ${url.pathname}`,
        },
      });
      return;
    }

    recorder.served += 1;
    await fulfillJson(route, resolved.status, resolved.body);
  });

  return recorder;
}

/** Exported for the walkthrough's date-window sanity assertions. */
export { isoDaysFromToday };
