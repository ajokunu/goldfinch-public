/**
 * Sandbox build for the app-level Stryker run (app/stryker.config.json).
 *
 * Stryker's buildCommand is executed via execa WITHOUT a shell, so `&&`
 * chaining is not available; this script compiles every per-package
 * mutation harness sequentially instead. It runs from the sandbox copy of
 * app/, where 'typescript' resolves up the tree to the repo's hoisted
 * node_modules.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');

const projects = [
  'src/ui/tsconfig.stryker.json',
  'features/transactions/tsconfig.stryker.json',
  'features/goals/tsconfig.stryker.json',
  'features/budget/tsconfig.stryker.json',
  'features/dashboard/tsconfig.stryker.json',
  'features/reports/tsconfig.stryker.json',
];

for (const project of projects) {
  const result = spawnSync(process.execPath, [tsc, '-p', project], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`stryker-build: tsc -p ${project} failed`);
    process.exit(result.status ?? 1);
  }
}
