# @goldfinch/sync

Daily SimpleFIN sync Lambda (master plan parts 9 and 10). Bundled by the
SyncStack from `src/handler.ts` (export `handler`), triggered once a day by
EventBridge Scheduler, dead-lettered to SQS on terminal failure.

## Flow

1. `secrets.ts` reads the access URL from SSM SecureString
   `/goldfinch/prod/simplefin/access-url` (CMK-decrypted, module-scope cache
   with a 15-minute TTL). The value is never logged anywhere.
2. `state.ts` reads `SYNC#STATE` and computes the request window:
   `lastSuccessEpoch - OVERLAP_BUFFER_DAYS`, clamped to `now - MAX_HISTORY_DAYS`.
3. `fetch-retry.ts` wraps the shared SimpleFIN client: 429/5xx and network
   errors retry with exponential backoff + jitter (4 attempts); 402/403 are
   terminal classes and never retried.
4. `normalize.ts` enriches the shared normalizer output with `amountRaw`,
   `balanceRaw`/`availableBalanceRaw`, and `isLiability` (`types.ts` extends
   the shared entity contracts additively).
5. `writer.ts` upserts idempotently: `TXNPTR#<txnId>` pointers, pending to
   posted re-keying (stale `TXN#` row deleted in the same batch),
   `BatchWriteItem` in chunks of 25 with an `UnprocessedItems` backoff loop,
   and user-field merging (category, note, transfer flag, audit columns, and
   version bump survive every overwrite).
6. `state.ts` writes the run outcome; the cursor advances only on a fully
   successful, fully persisted run.
7. `metrics.ts` emits one EMF line into namespace `GoldFinch/Sync`:
   `TxnsUpserted`, `AccountsSynced`, `SyncErrors`, `TerminalErrors`.

## Scripts (tsx)

- `npm run claim-token` (`scripts/claim-simplefin-token.ts`): one-shot setup
  token claim, guarded by a `.claimed` sentinel. Prints ONLY the access URL on
  stdout for piping into `aws ssm put-parameter`; instructions go to stderr.
- `npm run verify-simplefin` (`scripts/verify-simplefin.ts`): live coverage
  check against `SIMPLEFIN_ACCESS_URL` - prints host, account/transaction
  counts, and errlist entries. `SIMPLEFIN_SAMPLE=1` dumps the raw account set.

## Environment

`TABLE_NAME` (required), `HOUSEHOLD_ID`, `SIMPLEFIN_PARAM_NAME`,
`OVERLAP_BUFFER_DAYS` (7), `MAX_HISTORY_DAYS` (90), `METRICS_NAMESPACE`
(`GoldFinch/Sync`), `ACCOUNT_TYPES_JSON` (optional JSON map of SimpleFIN
account id to checking|savings|credit|investment|loan|other; unmapped
accounts persist as `other`).

## Commands

- `npm run build` / `npm run typecheck`
- `npm test` (vitest: idempotency, pending-to-posted re-keying, user-field
  preservation, partial batch failure, terminal 402/403 classification)
