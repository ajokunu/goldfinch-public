/**
 * POST /import/transactions (P7-6).
 *
 * Idempotency: each row is written in one TransactWriteItems pair — a
 * TXNPTR#import:<importId>:<rowHash> pointer (conditional put) plus the TXN#
 * row — literally the same pointer machinery the sync writer uses. Retrying a
 * batch can never double-import: a pointer that already exists cancels the
 * transaction and the row is reported as a duplicate.
 *
 * No silent row drops: EVERY row is validated up front (400 VALIDATION_ERROR
 * with the offending row index before anything is written), and the response
 * accounts for every received row — received == created + duplicates, always.
 *
 * Hashing contract: the server recomputes row hashes with computeRowHashes,
 * which assigns occurrence indexes in REQUEST ORDER (the rows array order is
 * part of the contract). When a row carries an explicit `occurrence`, it must
 * agree with the order-derived hash — a mismatch is a 400, never a silently
 * different identity than the client previewed.
 *
 * Manual accounts: after the batch, the target account's balance is bumped by
 * the sum of the CREATED rows only (duplicates contribute nothing), so a
 * retried batch cannot double-count the balance either. SimpleFIN-synced
 * accounts are never touched — the bridge owns their balances.
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import {
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  IMPORT_MAX_ROWS_PER_BATCH,
  MAX_TEXT_LENGTHS,
  SCHEMA_VERSION,
} from '@goldfinch/shared/constants';
import { computeRowHashes, rowHash } from '@goldfinch/shared/csv';
import {
  acctSk,
  categorySk,
  computeGsi2Keys,
  gsi1Pk,
  gsi1Sk,
  importTxnPointerSk,
  txnSk,
  userPk,
} from '@goldfinch/shared/keys';
import { addMinor, parseCurrencyAmount } from '@goldfinch/shared/money';
import type {
  AccountItem,
  CategoryItem,
  ImportTransactionsResponse,
  ImportTxnPointerItem,
  IsoDate,
  MinorUnits,
  TransactionItem,
} from '@goldfinch/shared/types';
import { IMPORT_WRITE_CONCURRENCY } from '../config.js';
import { getIdentity } from '../context.js';
import { ddb, isTransactConditionalCheckFailure } from '../ddb.js';
import { nowIso } from '../dates.js';
import { type ApiEnv, getEnv } from '../env.js';
import { ApiError, json, parseJsonBody, requirePathParam } from '../http.js';
import { logger } from '../logger.js';
import { requireIsoDate } from '../validate.js';

interface ValidatedRow {
  index: number;
  date: IsoDate;
  amountMinor: MinorUnits;
  payee: string;
  categoryId: string | null;
  note?: string;
  hash: string;
}

function rowError(index: number, message: string): ApiError {
  return new ApiError(400, 'VALIDATION_ERROR', message, { row: index });
}

function validateRow(
  raw: unknown,
  index: number,
  currency: string,
): Omit<ValidatedRow, 'hash'> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw rowError(index, `rows[${index}] must be an object`);
  }
  const row = raw as Record<string, unknown>;
  let date: IsoDate;
  try {
    date = requireIsoDate(row['date'], `rows[${index}].date`);
  } catch (err) {
    throw rowError(index, err instanceof Error ? err.message : String(err));
  }
  const amount = row['amount'];
  if (typeof amount !== 'string' || amount.length === 0) {
    throw rowError(index, `rows[${index}].amount must be a decimal string`);
  }
  let amountMinor: MinorUnits;
  try {
    amountMinor = parseCurrencyAmount(amount, currency);
  } catch (err) {
    throw rowError(
      index,
      `rows[${index}].amount is not a valid ${currency} amount: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const payeeRaw = row['payee'];
  if (typeof payeeRaw !== 'string') {
    throw rowError(index, `rows[${index}].payee must be a string`);
  }
  const payee = payeeRaw.replace(/\s+/g, ' ').trim();
  if (payee.length === 0) {
    throw rowError(index, `rows[${index}].payee must not be blank`);
  }
  if (payee.length > MAX_TEXT_LENGTHS.importPayee) {
    throw rowError(
      index,
      `rows[${index}].payee must be at most ${MAX_TEXT_LENGTHS.importPayee} characters`,
    );
  }
  const categoryRaw = row['categoryId'];
  if (categoryRaw !== undefined && categoryRaw !== null && typeof categoryRaw !== 'string') {
    throw rowError(index, `rows[${index}].categoryId must be a string or null`);
  }
  const noteRaw = row['note'];
  if (noteRaw !== undefined && noteRaw !== null && typeof noteRaw !== 'string') {
    throw rowError(index, `rows[${index}].note must be a string`);
  }
  if (
    typeof noteRaw === 'string' &&
    noteRaw.length > MAX_TEXT_LENGTHS.transactionNote
  ) {
    throw rowError(
      index,
      `rows[${index}].note must be at most ${MAX_TEXT_LENGTHS.transactionNote} characters`,
    );
  }
  const occurrenceRaw = row['occurrence'];
  if (
    occurrenceRaw !== undefined &&
    (!Number.isSafeInteger(occurrenceRaw) || (occurrenceRaw as number) < 0)
  ) {
    throw rowError(index, `rows[${index}].occurrence must be a non-negative integer`);
  }
  return {
    index,
    date,
    amountMinor,
    payee,
    categoryId:
      categoryRaw === undefined || categoryRaw === null || categoryRaw.length === 0
        ? null
        : categoryRaw,
    ...(noteRaw !== undefined && noteRaw !== null && noteRaw.length > 0
      ? { note: noteRaw }
      : {}),
  };
}

export async function importTransactions(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household, sub } = getIdentity(event);
  const env = getEnv();
  const body = parseJsonBody(event);

  const rawImportId = body['importId'];
  if (typeof rawImportId !== 'string' || rawImportId.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'importId must be a non-empty string');
  }
  if (rawImportId.includes('#') || rawImportId.includes(':')) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'importId must not contain "#" or ":"');
  }
  // Fresh typed bindings: narrowing does not survive into the writeRow closure.
  const importId: string = rawImportId;
  const rawAccountId = body['accountId'];
  if (typeof rawAccountId !== 'string' || rawAccountId.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'accountId must be a non-empty string');
  }
  const accountId: string = rawAccountId;
  const rawRows = body['rows'];
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'rows must be a non-empty array');
  }
  if (rawRows.length > IMPORT_MAX_ROWS_PER_BATCH) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `rows must not exceed ${IMPORT_MAX_ROWS_PER_BATCH} per batch`,
    );
  }

  const pk = userPk(household);
  const accountRes = await ddb.send(
    new GetCommand({ TableName: env.tableName, Key: { PK: pk, SK: acctSk(accountId) } }),
  );
  const maybeAccount = accountRes.Item as AccountItem | undefined;
  if (maybeAccount === undefined) {
    throw new ApiError(404, 'NOT_FOUND', `account "${accountId}" not found`);
  }
  const account: AccountItem = maybeAccount;

  // Validate EVERY row before any write — a bad row fails the whole batch
  // with its index, so a partial batch can only ever be a write-time outage
  // (which the pointer idempotency makes safely retryable).
  const validated = rawRows.map((raw, index) => validateRow(raw, index, account.currency));

  // Recompute hashes in request order (the contract). An explicit client
  // occurrence must agree with the order-derived identity.
  const hashes = computeRowHashes(validated);
  const rows: ValidatedRow[] = validated.map((row, i) => {
    const raw = rawRows[i] as Record<string, unknown>;
    const explicit = raw['occurrence'];
    const hash = hashes[i] as string;
    if (explicit !== undefined && rowHash(row, explicit as number) !== hash) {
      throw rowError(
        i,
        `rows[${i}].occurrence does not match the request row order ` +
          '(client and server must hash the same ordering)',
      );
    }
    return { ...row, hash };
  });

  // Resolve every referenced category once; unknown/archived -> 400.
  const categoryIds = [...new Set(rows.flatMap((row) => (row.categoryId === null ? [] : [row.categoryId])))];
  const categories = new Map<string, CategoryItem>();
  await Promise.all(
    categoryIds.map(async (categoryId) => {
      const res = await ddb.send(
        new GetCommand({
          TableName: env.tableName,
          Key: { PK: pk, SK: categorySk(categoryId) },
        }),
      );
      const category = res.Item as CategoryItem | undefined;
      if (category === undefined || category.archived) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          `categoryId "${categoryId}" is not a known active category`,
        );
      }
      categories.set(categoryId, category);
    }),
  );

  const now = nowIso();
  let created = 0;
  let duplicates = 0;
  let createdDeltaMinor = 0;

  async function writeRow(row: ValidatedRow): Promise<void> {
    // The synthetic stable id makes TXNPTR#<txnId> == importTxnPointerSk —
    // the same pointer machinery as sync (P7-6).
    const txnId = `import:${importId}:${row.hash}`;
    const sk = txnSk(row.date, txnId);
    const pointerSk = importTxnPointerSk(importId, row.hash);

    const category = row.categoryId !== null ? categories.get(row.categoryId) : undefined;
    const gsi2Keys =
      row.categoryId !== null && category !== undefined
        ? computeGsi2Keys({
            household,
            categoryId: row.categoryId,
            categoryType: category.type,
            isTransfer: false,
            date: row.date,
            txnId,
          })
        : null;

    const txnItem: TransactionItem = {
      PK: pk,
      SK: sk,
      entityType: 'TRANSACTION',
      schemaVersion: SCHEMA_VERSION,
      amountMinor: row.amountMinor,
      currency: account.currency,
      payee: row.payee,
      payeeLower: row.payee.toLowerCase(),
      ...(row.note !== undefined ? { note: row.note, noteLower: row.note.toLowerCase() } : {}),
      categoryId: row.categoryId,
      accountId,
      pending: false,
      isTransfer: false,
      postedDate: row.date,
      simplefinTxnId: txnId,
      source: 'import',
      importId,
      // The category came from the user's column mapping, so it is a user
      // decision: AI/rules must never overwrite it.
      categorizedBy: row.categoryId !== null ? 'user' : null,
      userCategorized: row.categoryId !== null,
      lastEditedBy: sub,
      version: 1,
      GSI1PK: gsi1Pk(household, accountId),
      GSI1SK: gsi1Sk(row.date, txnId),
      ...(gsi2Keys !== null ? gsi2Keys : {}),
      createdAt: now,
    };
    const pointerItem: ImportTxnPointerItem = {
      PK: pk,
      SK: pointerSk,
      entityType: 'IMPORT_TXN_POINTER',
      schemaVersion: SCHEMA_VERSION,
      importId,
      rowHash: row.hash,
      currentSk: sk,
      createdAt: now,
    };

    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: env.tableName,
                Item: { ...pointerItem },
                ConditionExpression: 'attribute_not_exists(SK)',
              },
            },
            {
              Put: {
                TableName: env.tableName,
                Item: { ...txnItem },
              },
            },
          ],
        }),
      );
      created += 1;
      createdDeltaMinor = addMinor(createdDeltaMinor, row.amountMinor);
    } catch (err) {
      if (isTransactConditionalCheckFailure(err)) {
        // The pointer already exists: this exact row was imported before.
        duplicates += 1;
        return;
      }
      logger.error('import row write failed', {
        importId,
        accountId,
        row: row.index,
        err,
      });
      throw err;
    }
  }

  // Bounded concurrency, chunk by chunk; counts are accumulated in closure.
  for (let i = 0; i < rows.length; i += IMPORT_WRITE_CONCURRENCY) {
    await Promise.all(rows.slice(i, i + IMPORT_WRITE_CONCURRENCY).map(writeRow));
  }

  // Manual account balances accrue from imported rows (P7-6). Synced accounts
  // are owned by the bridge and never adjusted here.
  if (account.source === 'manual' && createdDeltaMinor !== 0) {
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.tableName,
          Key: { PK: pk, SK: acctSk(accountId) },
          UpdateExpression:
            'ADD #balanceMinor :delta SET #balanceDate = :nowEpoch, #lastSyncedAt = :now',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: {
            '#balanceMinor': 'balanceMinor',
            '#balanceDate': 'balanceDate',
            '#lastSyncedAt': 'lastSyncedAt',
          },
          ExpressionAttributeValues: {
            ':delta': createdDeltaMinor,
            ':nowEpoch': Math.floor(Date.now() / 1000),
            ':now': now,
          },
        }),
      );
    } catch (err) {
      // The rows ARE imported (and a retry will see them as duplicates with a
      // zero delta), so this must be loud: the balance needs the delta below.
      logger.error('manual account balance update failed after import', {
        importId,
        accountId,
        deltaMinor: createdDeltaMinor,
        err,
      });
      throw err;
    }
  }

  const responseBody: ImportTransactionsResponse = {
    importId,
    received: rows.length,
    created,
    duplicates,
  };
  return json(200, responseBody);
}
