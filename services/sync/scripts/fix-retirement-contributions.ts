/**
 * One-off fix: record investment-account contributions as POSITIVE income.
 *
 * Brokerage feeds (e.g. a 401k provider) report a contribution as a
 * NEGATIVE amount -- the "cash deployed to buy the fund" leg -- so it read as a
 * cost everywhere: negative income in an income category, or an outflow in
 * Transfers. The sync now flips these to positive and files them under a
 * dedicated "Retirement Contributions" INCOME category (see normalize.ts), but
 * rows already written under the old behaviour need a one-time backfill.
 *
 * This script:
 *   1. ensures the CATEGORY#retirement-contributions row exists (type INCOME);
 *   2. finds every contribution-payee txn on an investment account and, for any
 *      that is still negative / mis-categorized, sets amountMinor + amountRaw
 *      positive, categoryId = retirement-contributions, isTransfer = false, and
 *      bumps version (no SK change -> no re-key).
 *
 * DEPLOY THE SYNC FIX FIRST: amountMinor is a bank-owned field re-written every
 * sync, so the fixed sync Lambda must be live or the next run reverts the sign.
 *
 * DRY-RUN BY DEFAULT. Writes only with `--apply`.
 *   AWS_REGION=us-east-1 npm run fix-contributions --workspace services/sync
 *   AWS_REGION=us-east-1 npm run fix-contributions --workspace services/sync -- --apply
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { RETIREMENT_CONTRIBUTIONS_CATEGORY_ID, SCHEMA_VERSION } from '@goldfinch/shared/constants';
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

async function ensureCategory(): Promise<string> {
  try {
    await doc.send(
      new PutCommand({
        TableName: TABLE_NAME,
        ConditionExpression: 'attribute_not_exists(SK)',
        Item: {
          PK,
          SK: `CATEGORY#${RETIREMENT_CONTRIBUTIONS_CATEGORY_ID}`,
          entityType: 'CATEGORY',
          schemaVersion: SCHEMA_VERSION,
          categoryId: RETIREMENT_CONTRIBUTIONS_CATEGORY_ID,
          name: 'Retirement Contributions',
          type: 'INCOME',
          sortOrder: 15,
          archived: false,
          isDefault: false,
          createdAt: NOW_ISO,
        },
      }),
    );
    return 'created';
  } catch (err) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') return 'exists';
    throw err;
  }
}

async function main(): Promise<void> {
  // investment account ids
  const investment = new Set(
    (await queryPrefix('ACCT#'))
      .filter((a) => a['accountType'] === 'investment')
      .map((a) => String(a['SK']).slice('ACCT#'.length)),
  );

  // contribution-payee txns on investment accounts that still need fixing
  const txns = (await queryPrefix('TXN#')).filter(
    (t) =>
      investment.has(String(t['accountId'])) &&
      /contribution/i.test(String(t['payee'] ?? '')),
  );
  const plans = txns
    .map((t) => {
      const amountMinor = Number(t['amountMinor']);
      const needs =
        amountMinor < 0 ||
        t['categoryId'] !== RETIREMENT_CONTRIBUTIONS_CATEGORY_ID ||
        t['isTransfer'] === true;
      return { t, amountMinor, needs };
    })
    .filter((p) => p.needs);

  console.log(`\nTable=${TABLE_NAME} household=${HOUSEHOLD} region=${process.env.AWS_REGION ?? '(default)'}`);
  console.log(`investment accounts=${investment.size}  contribution txns=${txns.length}  need fixing=${plans.length}\n`);
  for (const p of plans) {
    const sk = String(p.t['SK']);
    console.log(
      `  ${sk.split('#')[1]}  ${(p.amountMinor / 100).toFixed(2)} -> +${(Math.abs(p.amountMinor) / 100).toFixed(2)}  ` +
        `cat=${String(p.t['categoryId'])} -> ${RETIREMENT_CONTRIBUTIONS_CATEGORY_ID}  ${String(p.t['payee'])}`,
    );
  }

  if (!APPLY) {
    console.log('\nDRY RUN -- no writes. Re-run with `-- --apply` (deploy the sync fix first).');
    return;
  }

  console.log(`\nensure category row... ${await ensureCategory()}`);
  let ok = 0;
  for (const p of plans) {
    const sk = String(p.t['SK']);
    const positiveRaw =
      typeof p.t['amountRaw'] === 'string'
        ? (p.t['amountRaw'] as string).replace(/^-/, '')
        : (Math.abs(p.amountMinor) / 100).toFixed(2);
    await doc.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK, SK: sk },
        ConditionExpression: 'attribute_exists(SK)',
        UpdateExpression:
          'SET amountMinor = :am, amountRaw = :ar, categoryId = :c, isTransfer = :f, updatedAt = :u ADD version :one',
        ExpressionAttributeValues: {
          ':am': Math.abs(p.amountMinor),
          ':ar': positiveRaw,
          ':c': RETIREMENT_CONTRIBUTIONS_CATEGORY_ID,
          ':f': false,
          ':u': NOW_ISO,
          ':one': 1,
        },
      }),
    );
    ok += 1;
  }
  console.log(`\nDone: ${ok}/${plans.length} contributions fixed.`);

  // verify
  const after = (await queryPrefix('TXN#')).filter(
    (t) => investment.has(String(t['accountId'])) && /contribution/i.test(String(t['payee'] ?? '')),
  );
  const stillBad = after.filter(
    (t) => Number(t['amountMinor']) < 0 || t['categoryId'] !== RETIREMENT_CONTRIBUTIONS_CATEGORY_ID,
  ).length;
  console.log(`Verify: ${after.length} contribution txns, remaining negative/mis-categorized=${stillBad}` + (stillBad === 0 ? '  OK' : '  *** CHECK ***'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
