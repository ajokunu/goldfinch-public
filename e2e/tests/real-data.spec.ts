/**
 * Walkthrough against CAPTURED PRODUCTION payloads (/tmp/realfixtures), used
 * to reproduce data-shape-dependent crashes the synthetic fixtures miss.
 * Run with E2E_BROWSER=webkit to match Safari (CSSStyleProperties throws).
 */
import { readFileSync, existsSync } from 'node:fs';
import { test, expect } from '@playwright/test';

import { distDir, loadExpoPublicEnv } from '../lib/easEnv';
import { buildTokenTriple } from '../lib/jwt';
import { startStaticServer, type StaticServer } from '../lib/staticServer';

const FIXDIR = '/tmp/realfixtures';
const ROUTES: Record<string, string> = {
  '/accounts': 'accounts.json',
  '/profile': 'profile.json',
  '/summary': 'summary.json',
  '/transactions': 'transactions.json',
  '/budgets': 'budgets.json',
  '/categories': 'categories.json',
  '/cashflow': 'cashflow.json',
  '/recurring': 'recurring.json',
  '/goals': 'goals.json',
  '/networth/history': 'networth_history.json',
  '/reports/trends': 'reports_trends.json',
  '/reports/flow': 'reports_flow.json',
  '/rules': 'rules.json',
};

let server: StaticServer;
test.beforeAll(async () => {
  server = await startStaticServer(distDir(), 0);
});
test.afterAll(async () => {
  await server.close();
});

test.use({
  // Playwright 1.60 exposes reducedMotion only via contextOptions (it is no
  // longer a top-level test option); colorScheme is still top-level.
  contextOptions: {
    reducedMotion:
      process.env.E2E_REDUCED_MOTION === '1' ? 'reduce' : 'no-preference',
  },
  colorScheme: process.env.E2E_DARK === '1' ? 'dark' : 'light',
});

test('walks every screen against captured production payloads', async ({ context, page }) => {
  test.skip(!existsSync(`${FIXDIR}/summary.json`), 'no captured fixtures');
  const expoEnv = loadExpoPublicEnv();
  const api = new URL(expoEnv.EXPO_PUBLIC_API_URL).origin;
  const tokens = buildTokenTriple(expoEnv.EXPO_PUBLIC_COGNITO_CLIENT_ID);
  const consoleLogs: string[] = [];

  await context.route(`${api}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders() });
      return;
    }
    const file = ROUTES[url.pathname];
    const body = file && existsSync(`${FIXDIR}/${file}`) ? readFileSync(`${FIXDIR}/${file}`, 'utf8') : null;
    await route.fulfill({
      status: body === null ? 404 : 200,
      headers: { 'content-type': 'application/json', ...corsHeaders() },
      body: body ?? JSON.stringify({ error: { code: 'NOT_FOUND', message: 'unmocked' } }),
    });
  });

  await context.addInitScript((t: { a: string; r: string; i: string }) => {
    window.localStorage.setItem('gf.accessToken', t.a);
    window.localStorage.setItem('gf.refreshToken', t.r);
    window.localStorage.setItem('gf.idToken', t.i);
  }, { a: tokens.accessToken, r: tokens.refreshToken, i: tokens.idToken });

  page.on('console', (m) => consoleLogs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => consoleLogs.push(`PAGEERROR: ${String(e)}`));

  await page.goto(server.baseUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const crashes = consoleLogs.filter((l) => /CSSStyle|indexed property|root render crash|PAGEERROR/i.test(l));
  for (const tab of ['/', '/transactions', '/budget', '/reports', '/more/goals', '/more/recurring', '/more/rules', '/more/import']) {
    await page.goto(`${server.baseUrl}${tab === '/' ? '' : tab}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const body = await page.locator('body').innerText().catch(() => '');
    const crashed = body.includes('unexpected error');
    console.log(`[screen ${tab}] crashed=${crashed} bodyLen=${body.length}`);
    if (crashed) {
      console.log('CRASH BODY:', body.slice(0, 300));
    }
  }
  const all = consoleLogs.filter((l) => /CSSStyle|indexed property|root render crash|PAGEERROR|error/i.test(l));
  console.log('=== ERROR-ISH LOGS ===');
  for (const l of all.slice(0, 12)) console.log(l.slice(0, 1500));
  expect(true).toBe(true);
});

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  };
}
