/**
 * Full-app walkthrough over the exported web bundle (design decisions doc,
 * item 6): inject a fixture Cognito session into the storage the web app
 * actually uses (localStorage gf.* keys -- see app/src/lib/storage.ts and
 * app/src/auth/tokenStore.ts), route-mock every API endpoint, walk all five
 * tabs plus the More destinations, switch the theme direction in Settings
 * (meridian -> quant) and re-walk dashboard + reports, asserting key content
 * per screen and ZERO console errors throughout. Screenshots land in
 * e2e/artifacts/screens/.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { installApiMock, type ApiMock } from '../lib/apiMock';
import { apiOrigin, distDir, loadExpoPublicEnv } from '../lib/easEnv';
import { buildTokenTriple, FIXTURE_IDENTITY } from '../lib/jwt';
import { startStaticServer, type StaticServer } from '../lib/staticServer';

const SCREENS_DIR = path.join(__dirname, '..', 'artifacts', 'screens');

let server: StaticServer;

test.use({
  // Playwright 1.60 exposes reducedMotion only via contextOptions (it is no
  // longer a top-level test option). E2E_REDUCED_MOTION=1 emulates the OS
  // prefers-reduced-motion media feature, which every motion primitive in
  // app/src/ui/motion respects (PHASE9-DECISIONS P9-3 kill-switch contract);
  // the walkthrough must pass in BOTH modes.
  contextOptions: {
    reducedMotion:
      process.env.E2E_REDUCED_MOTION === '1' ? 'reduce' : 'no-preference',
  },
});

test.beforeAll(async () => {
  mkdirSync(SCREENS_DIR, { recursive: true });
  server = await startStaticServer(distDir(), 0);
});

test.afterAll(async () => {
  await server.close();
});

/** First visible element containing the text (tab screens stay mounted but hidden). */
function seen(page: Page, text: string | RegExp): Locator {
  return page.getByText(text).filter({ visible: true }).first();
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SCREENS_DIR, `${name}.png`) });
}

/**
 * The net-worth hero is the CountUp motion primitive
 * (app/src/ui/motion/CountUp.tsx). With animations enabled it renders
 * per-digit rolling 0-9 strips -- the formatted amount is exposed through the
 * accessible label, never as one text node; under reduced motion it renders
 * the same formatted value as static text (with the same label). Assert the
 * contract that holds in both modes: visible hero, exact amount in the label.
 */
async function expectHeroAmount(page: Page, amount: RegExp): Promise<void> {
  const hero = page
    .getByTestId('networth-hero')
    .filter({ visible: true })
    .first();
  await expect(hero).toBeVisible();
  await expect(hero).toHaveAttribute('aria-label', amount);
}

interface Recorders {
  consoleErrors: string[];
  pageErrors: string[];
  externalRequests: string[];
  api: ApiMock;
}

function expectClean(recorders: Recorders, where: string): void {
  expect
    .soft(recorders.consoleErrors, `console errors after ${where}`)
    .toEqual([]);
  expect.soft(recorders.pageErrors, `page errors after ${where}`).toEqual([]);
  expect
    .soft(recorders.api.unmatched, `unmocked API calls after ${where}`)
    .toEqual([]);
}

test('walks every screen in two theme directions with a mocked API and zero console errors', async ({
  context,
  page,
}) => {
  const expoEnv = loadExpoPublicEnv();
  const api = apiOrigin();
  const tokens = buildTokenTriple(expoEnv.EXPO_PUBLIC_COGNITO_CLIENT_ID);

  const recorders: Recorders = {
    consoleErrors: [],
    pageErrors: [],
    externalRequests: [],
    api: { unmatched: [], authViolations: [], served: 0 },
  };

  // Catch-all (registered FIRST so the API route, registered later, wins):
  // same-origin static assets continue to the local server; anything else
  // that is neither the app nor the mocked API is recorded and answered 204
  // so it can fail the test without spraying net::ERR console noise.
  const appOrigin = new URL(server.baseUrl).origin;
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin) {
      await route.continue();
      return;
    }
    recorders.externalRequests.push(
      `${route.request().method()} ${url.origin}${url.pathname}`,
    );
    await route.fulfill({ status: 204 });
  });
  recorders.api = await installApiMock(context, api, tokens.accessToken);

  // Auth + storage injection: the exact SecureStore key names from
  // app/src/config.ts, which the web storage adapter maps onto localStorage.
  await context.addInitScript(
    (injected: { access: string; refresh: string; id: string }) => {
      window.localStorage.setItem('gf.accessToken', injected.access);
      window.localStorage.setItem('gf.refreshToken', injected.refresh);
      window.localStorage.setItem('gf.idToken', injected.id);
    },
    {
      access: tokens.accessToken,
      refresh: tokens.refreshToken,
      id: tokens.idToken,
    },
  );

  page.on('console', (message) => {
    if (message.type() === 'error') {
      recorders.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    recorders.pageErrors.push(error.message);
  });

  let meridianHeadingFont = '';

  await test.step('dashboard (meridian)', async () => {
    await page.goto(`${server.baseUrl}/`);
    const greeting = page.getByRole('heading', {
      name: new RegExp(
        `Good (morning|afternoon|evening), ${FIXTURE_IDENTITY.givenName}`,
      ),
    });
    await expect(greeting).toBeVisible({ timeout: 60_000 });
    await expect(seen(page, 'Net worth')).toBeVisible();
    await expectHeroAmount(page, /45,537\.97/);
    await expect(seen(page, /spending/i)).toBeVisible();
    await expect(seen(page, 'Upcoming bills')).toBeVisible();
    await expect(seen(page, 'Recent activity')).toBeVisible();
    await expect(seen(page, 'Blue Bottle Coffee')).toBeVisible();
    meridianHeadingFont = await greeting.evaluate(
      (el) => getComputedStyle(el).fontFamily,
    );
    await shoot(page, '01-home-meridian');
    expectClean(recorders, 'dashboard (meridian)');
  });

  await test.step('activity tab', async () => {
    await page.getByTestId('tab-transactions').click();
    await expect(page.getByPlaceholder('Search payees')).toBeVisible();
    await expect(seen(page, 'Whole Foods Market')).toBeVisible();
    await expect(seen(page, 'Acme Corp Payroll')).toBeVisible();
    // Loading/empty/error discipline: the pending fixture renders its badge.
    await expect(seen(page, 'City Parking')).toBeVisible();
    await shoot(page, '02-activity-meridian');
    expectClean(recorders, 'activity');
  });

  await test.step('budget tab', async () => {
    await page.getByTestId('tab-budget').click();
    await expect(seen(page, 'Cash flow')).toBeVisible();
    await expect(seen(page, 'Categories')).toBeVisible();
    await expect(seen(page, 'Groceries')).toBeVisible();
    await shoot(page, '03-budget-meridian');
    expectClean(recorders, 'budget');
  });

  await test.step('reports tab (meridian)', async () => {
    await page.getByTestId('tab-reports').click();
    await expect(seen(page, 'Net worth trend')).toBeVisible();
    await expect(seen(page, 'Monthly trends')).toBeVisible();
    await expect(seen(page, 'Income / Spend')).toBeVisible();
    await shoot(page, '04-reports-meridian');
    expectClean(recorders, 'reports');
  });

  await test.step('more hub', async () => {
    await page.getByTestId('tab-more').click();
    await expect(seen(page, 'Savings targets & projections')).toBeVisible();
    await expect(seen(page, 'Bills, subscriptions & income')).toBeVisible();
    await expect(seen(page, 'Auto-categorize transactions')).toBeVisible();
    await expect(seen(page, 'Bring in CSV statements')).toBeVisible();
    await expect(seen(page, 'Accounts, security, profile')).toBeVisible();
    await expect(seen(page, FIXTURE_IDENTITY.fullName)).toBeVisible();
    await expect(seen(page, FIXTURE_IDENTITY.email)).toBeVisible();
    await shoot(page, '05-more-meridian');
    expectClean(recorders, 'more hub');
  });

  await test.step('goals', async () => {
    await seen(page, 'Savings targets & projections').click();
    await expect(seen(page, 'Emergency fund')).toBeVisible();
    await expect(seen(page, 'Japan trip 2027')).toBeVisible();
    // With goals present the add affordance is an icon button whose
    // accessible name is the localized 'New goal' (accessibility preserved).
    await expect(
      page
        .getByRole('button', { name: 'New goal' })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
    await shoot(page, '06-goals-meridian');
    expectClean(recorders, 'goals');
    await page.goBack();
  });

  await test.step('recurring', async () => {
    await seen(page, 'Bills, subscriptions & income').click();
    await expect(seen(page, 'Netflix')).toBeVisible();
    await expect(seen(page, 'Upcoming')).toBeVisible();
    await expect(seen(page, /Review/)).toBeVisible();
    await shoot(page, '07-recurring-meridian');
    expectClean(recorders, 'recurring');
    await page.goBack();
  });

  await test.step('rules', async () => {
    await seen(page, 'Auto-categorize transactions').click();
    await expect(seen(page, 'New rule')).toBeVisible();
    await expect(seen(page, /netflix/)).toBeVisible();
    await expect(seen(page, 'Entertainment')).toBeVisible();
    await shoot(page, '08-rules-meridian');
    expectClean(recorders, 'rules');
    await page.goBack();
  });

  await test.step('import', async () => {
    await seen(page, 'Bring in CSV statements').click();
    await expect(seen(page, 'Import transactions from CSV')).toBeVisible();
    await shoot(page, '09-import-meridian');
    expectClean(recorders, 'import');
    await page.goBack();
  });

  await test.step('settings + theme direction switch', async () => {
    await seen(page, 'Accounts, security, profile').click();
    await expect(seen(page, 'Appearance')).toBeVisible();
    await expect(seen(page, 'Mode')).toBeVisible();
    await expect(seen(page, 'Language')).toBeVisible();
    await expect(seen(page, 'Sign out')).toBeVisible();
    for (const direction of ['meridian', 'quant', 'studio', 'halo']) {
      const card = page.getByTestId(`theme-direction-${direction}`);
      await expect(card).toBeVisible();
      // The cards keep their radio semantics and accessible names. (NOTE:
      // react-native-web 0.21 no longer maps accessibilityState.checked to
      // aria-checked, so selection is asserted via the check badge -- the
      // only svg a direction card renders -- and the persisted preference.)
      await expect(card).toHaveAttribute('role', 'radio');
      await expect(card).toHaveAttribute('aria-label', /.+/);
    }
    await expect(
      page.getByTestId('theme-direction-meridian').locator('svg'),
    ).toHaveCount(1);
    await expect(
      page.getByTestId('theme-direction-quant').locator('svg'),
    ).toHaveCount(0);
    await shoot(page, '10-settings-meridian');

    await page.getByTestId('theme-direction-quant').click();
    await expect(
      page.getByTestId('theme-direction-quant').locator('svg'),
    ).toHaveCount(1);
    await expect(
      page.getByTestId('theme-direction-meridian').locator('svg'),
    ).toHaveCount(0);
    // The choice persists through the zustand pref store (gf.prefs).
    await expect
      .poll(async () =>
        page.evaluate(() => window.localStorage.getItem('gf.prefs') ?? ''),
      )
      .toContain('"themeDirection":"quant"');
    await shoot(page, '11-settings-quant');
    expectClean(recorders, 'settings');
  });

  await test.step('dashboard re-walk (quant)', async () => {
    await page.getByTestId('tab-index').click();
    const greeting = page.getByRole('heading', {
      name: new RegExp(
        `Good (morning|afternoon|evening), ${FIXTURE_IDENTITY.givenName}`,
      ),
    });
    await expect(greeting).toBeVisible();
    await expect(seen(page, 'Net worth')).toBeVisible();
    await expectHeroAmount(page, /45,537\.97/);
    await expect(seen(page, 'Upcoming bills')).toBeVisible();
    await expect(seen(page, 'Recent activity')).toBeVisible();
    // The direction switch re-themes the live screen: the display face of
    // the greeting heading changes with the direction's font stack.
    const quantHeadingFont = await greeting.evaluate(
      (el) => getComputedStyle(el).fontFamily,
    );
    expect(quantHeadingFont).not.toEqual(meridianHeadingFont);
    await shoot(page, '12-home-quant');
    expectClean(recorders, 'dashboard (quant)');
  });

  await test.step('reports re-walk (quant)', async () => {
    await page.getByTestId('tab-reports').click();
    await expect(seen(page, 'Net worth trend')).toBeVisible();
    await expect(seen(page, 'Monthly trends')).toBeVisible();
    await expect(seen(page, 'Income / Spend')).toBeVisible();
    await shoot(page, '13-reports-quant');
    expectClean(recorders, 'reports (quant)');
  });

  await test.step('final invariants', async () => {
    expect(recorders.consoleErrors, 'console errors across the walk').toEqual([]);
    expect(recorders.pageErrors, 'uncaught page errors across the walk').toEqual([]);
    expect(recorders.api.unmatched, 'API calls with no fixture').toEqual([]);
    expect(
      recorders.api.authViolations,
      'API calls missing the injected bearer token',
    ).toEqual([]);
    expect(
      recorders.externalRequests,
      'requests that escaped to neither the app nor the mocked API',
    ).toEqual([]);
    expect(recorders.api.served, 'mocked API responses served').toBeGreaterThan(10);
  });
});
