/**
 * ONE-SHOT SimpleFIN setup-token claim (master plan part 9, step 2).
 *
 * Usage:
 *   SIMPLEFIN_SETUP_TOKEN=<base64 token> npx tsx scripts/claim-simplefin-token.ts
 *
 * Exchanges the single-use setup token for the permanent access URL and prints
 * the access URL - and nothing else - to STDOUT so it can be piped straight
 * into SSM without touching the shell history or a file:
 *
 *   SIMPLEFIN_SETUP_TOKEN=... npx tsx scripts/claim-simplefin-token.ts | \
 *     xargs -I{} aws ssm put-parameter \
 *       --name /goldfinch/prod/simplefin/access-url \
 *       --type SecureString \
 *       --key-id alias/goldfinch/simplefin \
 *       --value {} \
 *       --overwrite
 *
 * Safety properties:
 *   - The setup token DIES on the first successful POST. A `.claimed` sentinel
 *     file (timestamp + host only, never the secret) refuses a second run so a
 *     fat-fingered re-invocation cannot 403-storm a fresh token.
 *   - No AWS SDK dependency; this script runs anywhere Node 20+ runs.
 *   - All human-readable output goes to STDERR; STDOUT carries only the URL.
 */

import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  SimpleFinClaimError,
  claimAccessUrl,
  parseAccessUrl,
} from '@goldfinch/shared/simplefin';

const here = path.dirname(fileURLToPath(import.meta.url));
const sentinelPath = path.join(here, '..', '.claimed');

function fail(message: string): never {
  console.error(`claim-simplefin-token: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (existsSync(sentinelPath)) {
    fail(
      `sentinel ${sentinelPath} exists - a token was already claimed from this checkout. ` +
        'Setup tokens are single-use; if you genuinely need a NEW access URL, generate a ' +
        'new setup token in the SimpleFIN Bridge UI, delete the sentinel, and re-run.',
    );
  }

  const setupToken = process.env.SIMPLEFIN_SETUP_TOKEN;
  if (setupToken === undefined || setupToken.trim().length === 0) {
    fail('set SIMPLEFIN_SETUP_TOKEN to the base64 setup token from the Bridge UI');
  }

  let accessUrl: string;
  try {
    accessUrl = await claimAccessUrl(setupToken);
  } catch (err) {
    if (err instanceof SimpleFinClaimError && err.status === 403) {
      fail(
        'claim returned 403: this setup token was already claimed (or is invalid). ' +
          'Generate a fresh setup token in the Bridge UI and try again.',
      );
    }
    fail(err instanceof Error ? err.message : String(err));
  }

  const { host } = parseAccessUrl(accessUrl);
  writeFileSync(
    sentinelPath,
    `${JSON.stringify({ claimedAt: new Date().toISOString(), host }, null, 2)}\n`,
  );

  console.error(`Claimed access URL from ${host}.`);
  console.error('STDOUT below carries the access URL (the only secret). Store it with:');
  console.error('  aws ssm put-parameter --name /goldfinch/prod/simplefin/access-url \\');
  console.error('    --type SecureString --key-id alias/goldfinch/simplefin \\');
  console.error("    --value '<paste-or-pipe>' --overwrite");
  console.error('Never commit it, log it, or place it in an env var on the Lambda.');
  process.stdout.write(`${accessUrl}\n`);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
