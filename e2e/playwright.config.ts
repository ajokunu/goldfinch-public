/**
 * Playwright configuration for the GoldFinch web walkthrough (the design
 * decisions doc, item 6: route-mocked API, every screen, at least two theme
 * directions, zero console errors).
 *
 * One worker / no parallelism: the suite is a single ordered walkthrough that
 * carries state (the theme switch) across steps, and the static server +
 * export are shared.
 */
import { defineConfig } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  outputDir: path.join(__dirname, 'artifacts', 'test-results'),
  globalSetup: path.join(__dirname, 'global-setup.ts'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // The walkthrough is one long test (export-backed first paint is slow).
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    browserName: process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium',
    // Phone-width viewport keeps the five-tab bottom bar (the desktop
    // sidebar takes over at >= 1024px; see app/(app)/_layout.tsx).
    viewport: { width: 390, height: 844 },
    // Deterministic mode resolution: 'system' preference + light scheme.
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    trace: 'retain-on-failure',
    screenshot: 'off',
  },
});
