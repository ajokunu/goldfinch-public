/**
 * DynamoDB access for the AI insights Lambda.
 *
 * Least-privilege surface: Query on the household partition (CATEGORY#, RULE#,
 * TXN# ranges), GetItem/PutItem on INSIGHT#SUMMARY#, and conditional
 * UpdateItem on TXN# items. No scans, no writes outside the household
 * partition, no SSM, no KMS.
 *
 * The conditional update is the second line of defense for the
 * "userOverridden never overwritten" invariant: even if the in-memory filter
 * raced a concurrent user edit, the ConditionExpression refuses to clobber a
 * user-set or already-set category.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { NativeAttributeValue } from '@aws-sdk/lib-dynamodb';

import {
  KEY_PREFIX,
  computeGsi2Keys,
  parseTxnSk,
  txnDateRangeBounds,
  userPk,
} from '@goldfinch/shared/keys';
import type {
  CategoryItem,
  CategoryType,
  IsoDate,
  IsoMonth,
  IsoTimestamp,
  TransactionItem,
} from '@goldfinch/shared/types';

import type { RuleRecord } from './ruleSource.js';
import type { InsightSummaryItem } from './summary.js';
import { insightSummarySk } from './summary.js';

export type CategorySource = 'rule' | 'ai';

export interface ApplyCategoryInput {
  /** The transaction's current sort key (TXN#<date>#<txnId>). */
  txnSk: TransactionItem['SK'];
  categoryId: string;
  source: CategorySource;
  /**
   * Inputs to the shared sparse-GSI2 rule (computeGsi2Keys): only a
   * non-transfer transaction assigned an EXPENSE category gets the GSI2
   * spend-index keys.
   */
  categoryType: CategoryType;
  /** The transaction's isTransfer flag. */
  isTransfer: boolean;
  now: IsoTimestamp;
  /** Present only for source === 'ai'. */
  aiConfidence?: number;
  /** Inference-profile ID; present only for source === 'ai'. */
  aiModel?: string;
}

export interface GoldFinchStore {
  loadCategories(): Promise<CategoryItem[]>;
  /**
   * Raw RULE#-namespace records: shared-contract RULE items plus legacy
   * CATEGORY_RULE items during the migration window. Callers discriminate on
   * entityType via ruleSource.convertRuleRecords.
   */
  loadRules(): Promise<RuleRecord[]>;
  /** Uncategorized, non-user-touched transactions in [from, to]. */
  queryUncategorizedTransactions(from: IsoDate, to: IsoDate): Promise<TransactionItem[]>;
  /** Every transaction in [from, to] (for summary rollups). */
  queryTransactionsInRange(from: IsoDate, to: IsoDate): Promise<TransactionItem[]>;
  /** Returns false when the conditional write was refused (user got there first). */
  applyCategory(input: ApplyCategoryInput): Promise<boolean>;
  getMonthlySummary(month: IsoMonth): Promise<InsightSummaryItem | undefined>;
  putMonthlySummary(item: InsightSummaryItem): Promise<void>;
}

export interface StoreOptions {
  tableName: string;
  household: string;
  /** Injectable for tests / shared client reuse. */
  client?: DynamoDBDocumentClient;
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'ConditionalCheckFailedException'
  );
}

export function createStore(options: StoreOptions): GoldFinchStore {
  const { tableName, household } = options;
  if (tableName.length === 0) {
    throw new Error('store requires a non-empty tableName (GOLDFINCH_TABLE_NAME)');
  }
  const client =
    options.client ??
    DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  const pk = userPk(household);

  async function queryAll<T>(
    keyCondition: string,
    values: Record<string, NativeAttributeValue>,
    filter?: string,
  ): Promise<T[]> {
    const items: T[] = [];
    let exclusiveStartKey: Record<string, NativeAttributeValue> | undefined;
    do {
      const output = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: keyCondition,
          ...(filter !== undefined ? { FilterExpression: filter } : {}),
          ExpressionAttributeValues: values,
          ...(exclusiveStartKey !== undefined
            ? { ExclusiveStartKey: exclusiveStartKey }
            : {}),
        }),
      );
      items.push(...((output.Items ?? []) as T[]));
      exclusiveStartKey = output.LastEvaluatedKey;
    } while (exclusiveStartKey !== undefined);
    return items;
  }

  return {
    async loadCategories(): Promise<CategoryItem[]> {
      return queryAll<CategoryItem>('PK = :pk AND begins_with(SK, :prefix)', {
        ':pk': pk,
        ':prefix': KEY_PREFIX.category,
      });
    },

    async loadRules(): Promise<RuleRecord[]> {
      return queryAll<RuleRecord>('PK = :pk AND begins_with(SK, :prefix)', {
        ':pk': pk,
        ':prefix': KEY_PREFIX.rule,
      });
    },

    async queryUncategorizedTransactions(
      from: IsoDate,
      to: IsoDate,
    ): Promise<TransactionItem[]> {
      const bounds = txnDateRangeBounds(from, to);
      return queryAll<TransactionItem>(
        'PK = :pk AND SK BETWEEN :start AND :end',
        {
          ':pk': pk,
          ':start': bounds.start,
          ':end': bounds.end,
          ':null': null,
          ':false': false,
          ':txn': 'TRANSACTION',
        },
        '(attribute_not_exists(categoryId) OR categoryId = :null) AND ' +
          '(attribute_not_exists(userCategorized) OR userCategorized = :false) AND ' +
          'entityType = :txn',
      );
    },

    async queryTransactionsInRange(
      from: IsoDate,
      to: IsoDate,
    ): Promise<TransactionItem[]> {
      const bounds = txnDateRangeBounds(from, to);
      return queryAll<TransactionItem>(
        'PK = :pk AND SK BETWEEN :start AND :end',
        {
          ':pk': pk,
          ':start': bounds.start,
          ':end': bounds.end,
          ':txn': 'TRANSACTION',
        },
        'entityType = :txn',
      );
    },

    async applyCategory(input: ApplyCategoryInput): Promise<boolean> {
      const { date, txnId } = parseTxnSk(input.txnSk);
      const sets = [
        'categoryId = :categoryId',
        'categorizedBy = :source',
        'updatedAt = :now',
        'version = if_not_exists(version, :zero) + :one',
      ];
      const values: Record<string, NativeAttributeValue> = {
        ':categoryId': input.categoryId,
        ':source': input.source,
        ':now': input.now,
        ':zero': 0,
        ':one': 1,
        ':null': null,
        ':false': false,
      };
      // Keep isTransfer coherent with the category type (same rule as the API
      // PATCH path): an assigned TRANSFER category marks the row a transfer so
      // every spend consumer excludes it without a category-type lookup.
      // Monotonic-OR: an already-flagged transfer stays one.
      const effectiveIsTransfer = input.categoryType === 'TRANSFER' || input.isTransfer;
      sets.push('isTransfer = :isTransfer');
      values[':isTransfer'] = effectiveIsTransfer;
      // Single source of truth for the sparse GSI2 spend-index rule; shared
      // with the API PATCH path so the two writers can never diverge.
      const gsi2Keys = computeGsi2Keys({
        household,
        categoryId: input.categoryId,
        categoryType: input.categoryType,
        isTransfer: effectiveIsTransfer,
        date,
        txnId,
      });
      if (gsi2Keys !== null) {
        sets.push('GSI2PK = :gsi2pk', 'GSI2SK = :gsi2sk');
        values[':gsi2pk'] = gsi2Keys.GSI2PK;
        values[':gsi2sk'] = gsi2Keys.GSI2SK;
      }
      if (input.source === 'ai') {
        sets.push(
          'aiConfidence = :aiConfidence',
          'aiModel = :aiModel',
          'aiCategorizedAt = :now',
        );
        values[':aiConfidence'] = input.aiConfidence ?? null;
        values[':aiModel'] = input.aiModel ?? null;
      }
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: pk, SK: input.txnSk },
            UpdateExpression: `SET ${sets.join(', ')}`,
            // Refuse to touch user-categorized or already-categorized rows,
            // and never upsert a phantom transaction.
            ConditionExpression:
              'attribute_exists(PK) AND ' +
              '(attribute_not_exists(userCategorized) OR userCategorized = :false) AND ' +
              '(attribute_not_exists(categoryId) OR categoryId = :null)',
            ExpressionAttributeValues: values,
          }),
        );
        return true;
      } catch (error) {
        if (isConditionalCheckFailed(error)) {
          return false;
        }
        throw error;
      }
    },

    async getMonthlySummary(month: IsoMonth): Promise<InsightSummaryItem | undefined> {
      const output = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: pk, SK: insightSummarySk(month) },
        }),
      );
      return output.Item as InsightSummaryItem | undefined;
    },

    async putMonthlySummary(item: InsightSummaryItem): Promise<void> {
      await client.send(
        new PutCommand({
          TableName: tableName,
          // Interfaces have no index signature; the document client wants a
          // Record<string, NativeAttributeValue>. Structurally compatible.
          Item: item as unknown as Record<string, NativeAttributeValue>,
        }),
      );
    },
  };
}
