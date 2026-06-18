/**
 * Module-scope DynamoDB DocumentClient (warm-invocation reuse, master plan
 * section 8 decision 7). Phase 7 adds the private attachments bucket (P7-9)
 * as the only other AWS service this Lambda may talk to (see s3.ts).
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Document-client form of a LastEvaluatedKey / ExclusiveStartKey. */
export type DdbKey = NonNullable<QueryCommandInput['ExclusiveStartKey']>;

/**
 * Drain a Query to completion. Used only for bounded result sets (accounts,
 * categories, budgets, one month of GSI2 spend rows, a cashflow date range) —
 * never for the paginated transactions list.
 */
export async function queryAll<T>(input: QueryCommandInput): Promise<T[]> {
  const items: T[] = [];
  let exclusiveStartKey: DdbKey | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({ ...input, ExclusiveStartKey: exclusiveStartKey }),
    );
    items.push(...((res.Items ?? []) as T[]));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey !== undefined);
  return items;
}

/**
 * True when `err` is a DynamoDB ConditionalCheckFailedException. When the write
 * was sent with ReturnValuesOnConditionCheckFailure=ALL_OLD, `Item` is present
 * exactly when the item exists (i.e. the condition that failed was the version
 * check, not attribute_exists) — which is how 404 is told apart from 409.
 */
export function isConditionalCheckFailure(
  err: unknown,
): err is Error & { Item?: Record<string, unknown> } {
  return err instanceof Error && err.name === 'ConditionalCheckFailedException';
}

/**
 * True when `err` is a TransactWriteItems cancellation whose ONLY failure is a
 * ConditionalCheckFailed reason — i.e. the conditional put lost the race or
 * the item already existed. Any other cancellation reason (throttling,
 * validation) must propagate, so callers can map exactly the idempotent-skip
 * case (P7-6 import pointers) and rethrow everything else.
 */
export function isTransactConditionalCheckFailure(err: unknown): boolean {
  if (!(err instanceof Error) || err.name !== 'TransactionCanceledException') {
    return false;
  }
  const reasons = (err as Error & {
    CancellationReasons?: Array<{ Code?: string }>;
  }).CancellationReasons;
  if (reasons === undefined || reasons.length === 0) {
    return false;
  }
  return reasons.every(
    (reason) => reason.Code === 'ConditionalCheckFailed' || reason.Code === 'None',
  ) && reasons.some((reason) => reason.Code === 'ConditionalCheckFailed');
}
