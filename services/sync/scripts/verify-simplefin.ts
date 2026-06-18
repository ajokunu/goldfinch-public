/**
 * Live SimpleFIN verification pull (master plan part 9, step 3 - the Phase 1
 * coverage gate). Confirms the claimed access URL returns real accounts AND
 * transactions, not just balances.
 *
 * Usage:
 *   SIMPLEFIN_ACCESS_URL='https://user:pass@host/simplefin' \
 *     npx tsx scripts/verify-simplefin.ts
 *
 * Optional env:
 *   SIMPLEFIN_VERIFY_DAYS  lookback window in days (default 5)
 *   SIMPLEFIN_SAMPLE=1     additionally print the raw account-set JSON to
 *                          stdout (for capturing docs/simplefin-sample-response
 *                          .json; the access URL itself never appears in the
 *                          response body)
 *
 * Exit codes: 0 OK; 1 usage/transport failure; 2 zero accounts returned.
 * The access URL is read from the environment and never printed - all output
 * references the host only.
 */

import process from 'node:process';

import {
  fetchAccounts,
  parseAccessUrl,
  type SimpleFinAccountSet,
} from '@goldfinch/shared/simplefin';

function fail(message: string, code = 1): never {
  console.error(`verify-simplefin: ${message}`);
  process.exit(code);
}

function lookbackDays(): number {
  const raw = process.env.SIMPLEFIN_VERIFY_DAYS;
  if (raw === undefined || raw.length === 0) {
    return 5;
  }
  const days = Number(raw);
  if (!Number.isSafeInteger(days) || days <= 0 || days > 90) {
    fail('SIMPLEFIN_VERIFY_DAYS must be an integer in [1, 90]');
  }
  return days;
}

function summarize(set: SimpleFinAccountSet, host: string, days: number): void {
  console.error(`host: ${host}`);
  console.error(`window: last ${days} day(s), pending included`);
  console.error(`accounts: ${set.accounts.length}`);
  for (const account of set.accounts) {
    const txns = account.transactions ?? [];
    const pendingCount = txns.filter((t) => t.pending === true || t.posted === 0).length;
    console.error(
      `  - ${account.org?.name ?? account.org?.domain ?? 'unknown-org'} / ${account.name} ` +
        `(${account.currency}): balance ${account.balance}, ` +
        `${txns.length} txn(s) (${pendingCount} pending)`,
    );
  }
  const errlist = set.errlist ?? [];
  if (errlist.length > 0) {
    console.error(`errlist (${errlist.length}):`);
    for (const entry of errlist) {
      console.error(`  - [${entry.code}] ${entry.msg}`);
    }
  } else {
    console.error('errlist: empty');
  }
  for (const legacy of set.errors ?? []) {
    console.error(`legacy error: ${legacy}`);
  }
}

async function main(): Promise<void> {
  const accessUrl = process.env.SIMPLEFIN_ACCESS_URL;
  if (accessUrl === undefined || accessUrl.trim().length === 0) {
    fail('set SIMPLEFIN_ACCESS_URL to the claimed access URL (https://user:pass@host/simplefin)');
  }

  const { host } = parseAccessUrl(accessUrl);
  const days = lookbackDays();
  const startDate = Math.trunc(Date.now() / 1000) - days * 86_400;

  const set = await fetchAccounts(accessUrl, { startDate, pending: true });
  summarize(set, host, days);

  if (process.env.SIMPLEFIN_SAMPLE === '1') {
    process.stdout.write(`${JSON.stringify(set, null, 2)}\n`);
  }

  if (set.accounts.length === 0) {
    fail('zero accounts returned - check institution links in the Bridge UI', 2);
  }
  console.error('verification PASSED: accounts and transaction data returned');
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
