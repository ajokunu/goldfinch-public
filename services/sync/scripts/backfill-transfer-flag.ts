/**
 * One-off backfill: stamp isTransfer=true on existing transactions that sit in a
 * TRANSFER-typed category but were stored with isTransfer=false (or absent).
 *
 * Why: the client weekly-spend donut excludes a row on isTransfer===true OR a
 * TRANSFER-typed category lookup — and that lookup can miss before categories
 * finish loading, leaking genuine transfers (e.g. a savings-account transfer)
 * into This Week. The forward fix makes the API PATCH + AI categorizer set
 * isTransfer coherently with the category type; this backfill repairs rows
 * written before that fix so every consumer excludes them reliably.
 *
 * isTransfer is a user/creation-owned field (sync preserves it), so no GSI2
 * churn results — TRANSFER-category rows already carry no GSI2 keys.
 *
 * DRY-RUN BY DEFAULT. Writes only with `--apply`. Deploy the API + AI Lambdas
 * (forward fix) before running, so a later categorize can't re-introduce the
 * inconsistency.
 *
 *   AWS_REGION=us-east-1 npm run backfill-transfer-flag --workspace services/sync
 *   AWS_REGION=us-east-1 npm run backfill-transfer-flag --workspace services/sync -- --apply
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { userPk } from '@goldfinch/shared/keys';

const TABLE_NAME = process.env.GOLDFINCH_TABLE ?? process.env.TABLE_NAME ?? 'GoldFinch';
const HOUSEHOLD = process.env.GOLDFINCH_HOUSEHOLD ?? 'goldfinch-home';
const APPLY = process.argv.includes('--apply');
const NOW_ISO = new Date().toISOString();
const PK = userPk(HOUSEHOLD);

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

async function queryPrefix(prefix: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :p)',
        ExpressionAttributeValues: { ':pk': PK, ':p': prefix },
        ExclusiveStartKey,
      }),
    );
    out.push(...((res.Items ?? []) as Record<string, unknown>[]));
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return out;
}

async function main(): Promise<void> {
  // The set of TRANSFER-typed category slugs.
  const transferCategoryIds = new Set(
    (await queryPrefix('CATEGORY#'))
      .filter((c) => c['type'] === 'TRANSFER')
      .map((c) => String(c['categoryId'] ?? String(c['SK']).slice('CATEGORY#'.length))),
  );

  // TXN rows in a TRANSFER category that are not already flagged isTransfer=true.
  const txns = (await queryPrefix('TXN#')).filter(
    (t) =>
      typeof t['categoryId'] === 'string' &&
      transferCategoryIds.has(t['categoryId'] as string) &&
      t['isTransfer'] !== true,
  );

  console.log(`\nTable=${TABLE_NAME} household=${HOUSEHOLD} region=${process.env.AWS_REGION ?? '(default)'}`);
  console.log(
    `TRANSFER categories=${transferCategoryIds.size}  rows to flag=${txns.length}\n`,
  );
  for (const t of txns) {
    console.log(
      `  ${String(t['SK']).split('#')[1]}  cat=${String(t['categoryId'])}  isTransfer ${String(t['isTransfer'])} -> true  ${String(t['payee'] ?? '')}`,
    );
  }

  if (!APPLY) {
    console.log('\nDRY RUN -- no writes. Re-run with `-- --apply` (deploy the forward fix first).');
    return;
  }

  let ok = 0;
  for (const t of txns) {
    await doc.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK, SK: String(t['SK']) },
        ConditionExpression: 'attribute_exists(SK)',
        UpdateExpression: 'SET isTransfer = :true, updatedAt = :now ADD version :one',
        ExpressionAttributeValues: { ':true': true, ':now': NOW_ISO, ':one': 1 },
      }),
    );
    ok += 1;
  }
  console.log(`\nDone: ${ok}/${txns.length} rows flagged isTransfer=true.`);

  const after = (await queryPrefix('TXN#')).filter(
    (t) =>
      typeof t['categoryId'] === 'string' &&
      transferCategoryIds.has(t['categoryId'] as string) &&
      t['isTransfer'] !== true,
  ).length;
  console.log(`Verify: remaining TRANSFER-category rows not flagged = ${after}` + (after === 0 ? '  OK' : '  *** CHECK ***'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
