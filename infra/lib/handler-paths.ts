import * as fs from 'fs';
import * as path from 'path';

/**
 * Lambda handler entry points, expressed as repo-root-relative constants.
 *
 * The services/* workspaces are authored by other parts of the build and may
 * not exist yet when this app is synthesized (the infra and service code are
 * built in parallel). resolveHandler() keeps synth-time bundling the ONLY
 * coupling between infra and services: if a real entry file exists it is used;
 * otherwise a throwing stub is generated under infra/.synth-stubs so synth,
 * tests, and cdk diff still work before the service code lands.
 */
export const API_HANDLER_ENTRY = 'services/api/src/handler.ts';
export const SYNC_HANDLER_ENTRY = 'services/sync/src/handler.ts';
export const AI_HANDLER_ENTRY = 'services/ai/src/handler.ts';
/** SyncCompleted / budget-threshold push events (export `handler`). */
export const NOTIFICATIONS_HANDLER_ENTRY = 'services/notifications/src/handler.ts';
/** Expo push receipt sweep (export `handler`), scheduled after the send window. */
export const NOTIFICATIONS_RECEIPTS_HANDLER_ENTRY = 'services/notifications/src/receipts.ts';
/** Owned by infra itself (tiny Cognito trigger), always present. */
export const PRE_TOKEN_GEN_ENTRY = 'infra/lambda/pre-token-gen.ts';
/** Owned by infra itself (Cognito CustomMessage trigger), always present. */
export const CUSTOM_MESSAGE_ENTRY = 'infra/lambda/custom-message.ts';

/** Absolute path to the repo root (this file lives at infra/lib/). */
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

const STUB_DIR = path.join(REPO_ROOT, 'infra', '.synth-stubs');

const STUB_SOURCE = [
  '// Auto-generated synth-time stub. The real handler is built by another',
  '// workspace and replaces this file as the bundle entry once it exists.',
  'export const handler = async (): Promise<never> => {',
  "  throw new Error('GoldFinch handler stub: real implementation not deployed yet');",
  '};',
  '',
].join('\n');

/**
 * Resolve a repo-root-relative handler entry to an absolute path, generating a
 * stub when the real file does not exist yet.
 */
export function resolveHandler(repoRelativeEntry: string): string {
  const real = path.join(REPO_ROOT, repoRelativeEntry);
  if (fs.existsSync(real)) {
    return real;
  }
  const stub = path.join(STUB_DIR, repoRelativeEntry.replace(/[\\/]/g, '__'));
  fs.mkdirSync(STUB_DIR, { recursive: true });
  if (!fs.existsSync(stub)) {
    fs.writeFileSync(stub, STUB_SOURCE);
  }
  return stub;
}

/**
 * Path to the root lockfile used by NodejsFunction bundling. npm workspaces
 * keep a single lockfile at the repo root; it exists after `npm install`.
 * Before install (e.g. unit tests that skip bundling) a minimal stub lockfile
 * is generated so NodejsFunction's lockfile discovery does not fail.
 */
export function rootLockFile(): string {
  const lock = path.join(REPO_ROOT, 'package-lock.json');
  if (fs.existsSync(lock)) {
    return lock;
  }
  const fallback = path.join(STUB_DIR, 'package-lock.json');
  fs.mkdirSync(STUB_DIR, { recursive: true });
  if (!fs.existsSync(fallback)) {
    fs.writeFileSync(
      fallback,
      JSON.stringify({ name: 'goldfinch-synth-stub', lockfileVersion: 3, packages: {} }, null, 2),
    );
  }
  return fallback;
}
