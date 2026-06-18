/**
 * Global setup: export the web app (expo export --platform web) with the
 * EXPO_PUBLIC_* values from app/eas.json, exactly as a shipping web build
 * would be produced. The tests then serve app/dist statically.
 *
 * GOLDFINCH_E2E_SKIP_EXPORT=1 reuses an existing app/dist for fast local
 * iteration on the tests themselves; CI and "run until green" runs export
 * fresh so the suite always exercises the current source.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { appDir, distDir, loadExpoPublicEnv } from './lib/easEnv';

function runExport(env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['expo', 'export', '--platform', 'web'], {
      cwd: appDir(),
      env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `expo export failed (code ${String(code)}, signal ${String(signal)})`,
          ),
        );
      }
    });
  });
}

export default async function globalSetup(): Promise<void> {
  const expoEnv = loadExpoPublicEnv();
  const indexHtml = path.join(distDir(), 'index.html');

  if (process.env['GOLDFINCH_E2E_SKIP_EXPORT'] === '1' && existsSync(indexHtml)) {
    // eslint-disable-next-line no-console -- runner progress output
    console.log(
      `[e2e] GOLDFINCH_E2E_SKIP_EXPORT=1 and ${indexHtml} exists; reusing dist`,
    );
    return;
  }

  // eslint-disable-next-line no-console -- runner progress output
  console.log(
    `[e2e] exporting web app with API ${expoEnv.EXPO_PUBLIC_API_URL} ...`,
  );
  await runExport({
    ...process.env,
    ...expoEnv,
    CI: '1',
  });

  if (!existsSync(indexHtml)) {
    throw new Error(`expo export completed but ${indexHtml} is missing`);
  }
}
