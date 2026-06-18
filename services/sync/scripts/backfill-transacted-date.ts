/**
 * One-off backfill: re-key transactions that were bucketed on their bank
 * CLEARING date (`posted`) back onto their real transaction date
 * (`transacted_at`).
 *
 * Background: an earlier `normalizeTransaction` keyed the SK / GSI1SK / GSI2SK
 * of a *posted* transaction off `posted`. A June-12 purchase that the bank
 * clears June-15 therefore landed in the June-15 budget week. The fix (in
 * packages/shared/src/simplefin.ts) now prefers `transacted_at`, but rows
 * already written under the old rule keep the wrong bucket until re-keyed.
 *
 * This script scans every TXN# row in the household partition and, for any row
 * whose real `transacted_at` date differs from its current SK bucket, moves it
 * atomically:
 *   - Put   the row at the new SK (GSI1SK / GSI2SK recomputed for the new date)
 *   - Delete the stale SK
 *   - Update the TXNPTR pointer's currentSk (guarded on the old SK)
 * all in a single DynamoDB TransactWriteItems, so a crash leaves no half-state.
 *
 * `postedDate` (the true clearing date) is preserved untouched. Rows without
 * `transacted_at` fall back to `postedDate` -> a no-op, by construction matching
 * the fix's own date rule so the two can never drift.
 *
 * DRY-RUN BY DEFAULT. It only writes when invoked with `--apply`.
 *
 *   # read-only preview (safe; prints the full plan + summary):
 *   AWS_REGION=us-east-1 npm run backfill-dates --workspace services/sync
 *
 *   # execute the re-keys (DEPLOY THE SYNC FIX FIRST -- see note below):
 *   AWS_REGION=us-east-1 npm run backfill-dates --workspace services/sync -- --apply
 *
 * ORDERING: production sync runs daily on an EventBridge schedule. Old sync
 * code re-keys a row back to its posted-date bucket whenever the incoming
 * normalized SK differs from the pointer. So the fixed sync Lambda MUST be
 * deployed before `--apply`, or the next scheduled run will undo this backfill
 * for everything in its fetch window.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { epochToIsoDate } from '@goldfinch/shared/simplefin';
import { gsi1Sk, gsi2Sk, txnPointerSk, txnSk, userPk } from '@goldfinch/shared/keys';

const TABLE_NAME = process.env.GOLDFINCH_TABLE ?? process.env.TABLE_NAME ?? 'GoldFinch';
const HOUSEHOLD = process.env.GOLDFINCH_HOUSEHOLD ?? 'goldfinch-home';
const APPLY = process.argv.includes('--apply');
const PK = userPk(HOUSEHOLD);

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Split a TXN sort key into its date bucket and (possibly '#'-bearing) txnId. */
function parseTxnSk(sk: string): { date: string; txnId: string } {
  const rest = sk.slice('TXN#'.length);
  const i = rest.indexOf('#');
  return { date: rest.slice(0, i), txnId: rest.slice(i + 1) };
}

interface TxnRow {
  SK: string;
  transactedAt?: number;
  postedDate?: string | null;
  GSI2PK?: string;
  categoryId?: string | null;
  payee?: string;
  pending?: boolean;
  [k: string]: unknown;
}

interface Plan {
  txnId: string;
  oldSk: string;
  newSk: string;
  oldDate: string;
  newDate: string;
  category: string;
  payee: string;
  hasGsi2: boolean;
  row: TxnRow;
}

async function scanTxnRows(): Promise<TxnRow[]> {
  const rows: TxnRow[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :t)',
        ExpressionAttributeValues: { ':pk': PK, ':t': 'TXN#' },
        ExclusiveStartKey,
      }),
    );
    rows.push(...((res.Items ?? []) as TxnRow[]));
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return rows;
}

/** The date the row SHOULD bucket on, mirroring normalizeTransaction's rule. */
function targetDate(row: TxnRow): string {
  if (typeof row.transactedAt === 'number') return epochToIsoDate(row.transactedAt);
  if (row.postedDate) return row.postedDate; // no transacted_at -> clearing date
  return parseTxnSk(row.SK).date; // nothing better -> leave as-is
}

function buildPlan(rows: TxnRow[]): Plan[] {
  const plans: Plan[] = [];
  for (const row of rows) {
    const { date: oldDate, txnId } = parseTxnSk(row.SK);
    const newDate = targetDate(row);
    if (newDate === oldDate) continue; // already correct
    plans.push({
      txnId,
      oldSk: row.SK,
      newSk: txnSk(newDate, txnId),
      oldDate,
      newDate,
      category: row.categoryId ?? '(uncat)',
      payee: (row.payee ?? '').slice(0, 24),
      hasGsi2: typeof row.GSI2PK === 'string',
      row,
    });
  }
  return plans;
}

async function rekey(plan: Plan): Promise<void> {
  const newItem: Record<string, unknown> = {
    ...plan.row,
    SK: plan.newSk,
    GSI1SK: gsi1Sk(plan.newDate, plan.txnId),
  };
  if (plan.hasGsi2) newItem.GSI2SK = gsi2Sk(plan.newDate, plan.txnId);

  await doc.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE_NAME,
            Item: newItem,
            ConditionExpression: 'attribute_not_exists(SK)',
          },
        },
        {
          Delete: {
            TableName: TABLE_NAME,
            Key: { PK, SK: plan.oldSk },
            ConditionExpression: 'attribute_exists(SK)',
          },
        },
        {
          Update: {
            TableName: TABLE_NAME,
            Key: { PK, SK: txnPointerSk(plan.txnId) },
            UpdateExpression: 'SET currentSk = :new REMOVE previousSk',
            ConditionExpression: 'currentSk = :old',
            ExpressionAttributeValues: { ':new': plan.newSk, ':old': plan.oldSk },
          },
        },
      ],
    }),
  );
}

function summarize(rows: TxnRow[], plans: Plan[]): void {
  const withTa = rows.filter((r) => typeof r.transactedAt === 'number').length;
  console.log(`\nTable=${TABLE_NAME}  household=${HOUSEHOLD}  region=${process.env.AWS_REGION ?? '(default)'}`);
  console.log(
    `TXN rows=${rows.length}  with_transactedAt=${withTa}  no_transactedAt=${rows.length - withTa}  to_rekey=${plans.length}`,
  );
  // Per-week-shift counts so the budget impact is legible at a glance.
  const byShift = new Map<string, number>();
  for (const p of plans) {
    const k = `${p.oldDate} -> ${p.newDate}`;
    byShift.set(k, (byShift.get(k) ?? 0) + 1);
  }
  console.log(`\n${'oldBucket -> newBucket'.padEnd(26)} count`);
  for (const [k, n] of [...byShift.entries()].sort()) console.log(`${k.padEnd(26)}  ${n}`);
}

async function main(): Promise<void> {
  const rows = await scanTxnRows();
  const plans = buildPlan(rows);

  console.log(`\n${'oldDate'.padEnd(10)} ${'newDate'.padEnd(10)} ${'category'.padEnd(12)} payee`);
  for (const p of plans.sort((a, b) => a.oldSk.localeCompare(b.oldSk))) {
    console.log(`${p.oldDate.padEnd(10)} ${p.newDate.padEnd(10)} ${p.category.slice(0, 12).padEnd(12)} ${p.payee}`);
  }
  summarize(rows, plans);

  if (!APPLY) {
    console.log('\nDRY RUN -- no writes. Re-run with `-- --apply` to execute (deploy the sync fix first).');
    return;
  }

  console.log(`\nAPPLYING ${plans.length} re-keys...`);
  let ok = 0;
  const failures: Array<{ txnId: string; error: string }> = [];
  for (const p of plans) {
    try {
      await rekey(p);
      ok += 1;
      if (ok % 25 === 0) console.log(`  ...${ok}/${plans.length}`);
    } catch (err) {
      failures.push({ txnId: p.txnId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  console.log(`\nDone: ${ok} re-keyed, ${failures.length} failed.`);
  for (const f of failures) console.log(`  FAIL ${f.txnId}: ${f.error}`);

  // Conservation check: row + pointer counts must be unchanged and 1:1.
  const after = await scanTxnRows();
  const stillOff = buildPlan(after).length;
  console.log(
    `\nVerify: TXN rows ${rows.length} -> ${after.length}  remaining_misbucketed=${stillOff}` +
      (after.length === rows.length && stillOff === 0 ? '  OK' : '  *** CHECK ***'),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
