/**
 * Data access for the notifications service, behind a small interface so unit
 * tests can run on an in-memory fake (see testing/memoryStore.ts) without the
 * AWS SDK. The real implementation targets the GoldFinch single table through
 * @aws-sdk/lib-dynamodb.
 *
 * Least-privilege note for the infra part: both Lambda roles need exactly
 * dynamodb Query + PutItem + DeleteItem on the TABLE ARN (no GSI -- month
 * spend reads base-table TXN# rows; no UpdateItem -- token disabling is a
 * full-item Put of the row just read). Neither role may see the SimpleFIN SSM
 * parameter; only /goldfinch/expo/access-token.
 */

import type {
  BudgetItem,
  CategoryItem,
  IsoMonth,
  IsoTimestamp,
  PushTokenItem,
  TransactionItem,
  UserProfileItem,
} from '@goldfinch/shared/types';
import {
  KEY_PREFIX,
  txnDateRangeBounds,
  userPk,
  type UserPk,
} from '@goldfinch/shared/keys';
import {
  NOTIF_KEY_PREFIX,
  sentNotifPeriodPrefix,
  type PushTicketSk,
} from './keys.js';
import type { PushTicketItem, SentNotifItem } from './types.js';

export interface NotificationStore {
  /** All PUSHTOKEN# rows in the household partition (including disabled ones). */
  loadPushTokens(): Promise<PushTokenItem[]>;
  /**
   * Mark a device token dead (invalid format, DeviceNotRegistered ticket or
   * receipt) by setting `disabledAt` -- the shared PUSH_TOKEN contract keeps
   * the row for registration history instead of deleting it.
   */
  disablePushToken(token: PushTokenItem, disabledAt: IsoTimestamp): Promise<void>;
  /** Persist tickets returned by Expo so the receipt sweep can resolve them later. */
  putPushTickets(tickets: readonly PushTicketItem[]): Promise<void>;
  /** All outstanding PUSHTICKET# rows (the sweep input). */
  listPushTickets(): Promise<PushTicketItem[]>;
  deletePushTicket(sk: PushTicketSk): Promise<void>;
  /** All SENTNOTIF# dedup markers for one period (read-only crossing filter). */
  listSentNotifs(period: IsoMonth): Promise<SentNotifItem[]>;
  /**
   * Conditional put of a SENTNOTIF# dedup marker, called ONLY after the Expo
   * relay accepted the send (P7-8 marker-after-send). Returns true when this
   * call created the item, false when a concurrent run already marked it.
   */
  tryPutSentNotif(item: SentNotifItem): Promise<boolean>;
  /** All BUDGET# rows (limits for the threshold evaluator). */
  loadBudgets(): Promise<BudgetItem[]>;
  /** All CATEGORY# rows (display names for payloads). */
  loadCategories(): Promise<CategoryItem[]>;
  /** All PROFILE# rows (notification preferences). */
  loadProfiles(): Promise<UserProfileItem[]>;
  /** One month's TRANSACTION rows (base-table SK range; spend aggregation input). */
  loadMonthTransactions(month: IsoMonth): Promise<TransactionItem[]>;
}

/**
 * Structural subset of DynamoDBDocumentClient so the implementation is testable
 * and this module compiles without the AWS SDK types in scope.
 */
export interface DocumentClientLike {
  send(command: unknown): Promise<unknown>;
}

/**
 * Injected command constructor. The parameter is typed `any` deliberately:
 * constructor parameters are contravariant, so the real lib-dynamodb command
 * classes (whose constructors require their specific *CommandInput types,
 * e.g. QueryCommandInput with a mandatory TableName) are not assignable to a
 * `new (input: Record<string, unknown>) => unknown` signature. `any` keeps
 * both the real SDK constructors and the test fakes assignable while this
 * module stays import-free of the AWS SDK; the inputs built below are
 * asserted shape-by-shape in store.test.ts.
 */
type DdbCommandConstructor = new (input: any) => unknown;

interface DdbCommandConstructors {
  QueryCommand: DdbCommandConstructor;
  PutCommand: DdbCommandConstructor;
  DeleteCommand: DdbCommandConstructor;
}

export interface DynamoStoreOptions {
  client: DocumentClientLike;
  commands: DdbCommandConstructors;
  tableName: string;
  household: string;
}

interface QueryOutputLike {
  Items?: Record<string, unknown>[];
  LastEvaluatedKey?: Record<string, unknown>;
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'ConditionalCheckFailedException'
  );
}

/** First and last calendar day of a yyyy-mm month. */
export function monthDateRange(month: IsoMonth): { from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(monthNum) || monthNum < 1 || monthNum > 12) {
    throw new RangeError(`expected yyyy-mm month, got "${month}"`);
  }
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * Real single-table store. The lib-dynamodb command classes are injected (see
 * aws.ts) so this file stays import-free of the AWS SDK and the unit-test build
 * never needs it.
 */
export function createDynamoStore(options: DynamoStoreOptions): NotificationStore {
  const { client, commands, tableName, household } = options;
  const pk: UserPk = userPk(household);

  async function queryRange<T>(
    condition: string,
    values: Record<string, unknown>,
  ): Promise<T[]> {
    const items: T[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const output = (await client.send(
        new commands.QueryCommand({
          TableName: tableName,
          KeyConditionExpression: condition,
          ExpressionAttributeValues: { ':pk': pk, ...values },
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        }),
      )) as QueryOutputLike;
      items.push(...((output.Items ?? []) as T[]));
      exclusiveStartKey = output.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }

  function queryByPrefix<T>(prefix: string): Promise<T[]> {
    return queryRange<T>('PK = :pk AND begins_with(SK, :prefix)', { ':prefix': prefix });
  }

  return {
    loadPushTokens: () => queryByPrefix<PushTokenItem>(NOTIF_KEY_PREFIX.pushToken),
    listPushTickets: () => queryByPrefix<PushTicketItem>(NOTIF_KEY_PREFIX.pushTicket),
    loadBudgets: () => queryByPrefix<BudgetItem>(KEY_PREFIX.budget),
    loadCategories: () => queryByPrefix<CategoryItem>(KEY_PREFIX.category),
    loadProfiles: () => queryByPrefix<UserProfileItem>(KEY_PREFIX.profile),
    listSentNotifs: (period) =>
      queryByPrefix<SentNotifItem>(sentNotifPeriodPrefix(period)),

    loadMonthTransactions(month) {
      const { from, to } = monthDateRange(month);
      const bounds = txnDateRangeBounds(from, to);
      return queryRange<TransactionItem>('PK = :pk AND SK BETWEEN :start AND :end', {
        ':start': bounds.start,
        ':end': bounds.end,
      });
    },

    async disablePushToken(token, disabledAt) {
      // Full-item Put of the row we just read (no UpdateItem in the IAM
      // grant); the shared contract keeps disabled rows for history.
      await client.send(
        new commands.PutCommand({
          TableName: tableName,
          Item: { ...token, disabledAt },
        }),
      );
    },

    async putPushTickets(tickets) {
      // At most (devices x notifications) items per run -- single digits for a
      // two-user household -- so parallel singleton puts beat BatchWrite's
      // unprocessed-item handling in simplicity.
      await Promise.all(
        tickets.map((ticket) =>
          client.send(new commands.PutCommand({ TableName: tableName, Item: ticket })),
        ),
      );
    },

    async deletePushTicket(sk) {
      await client.send(
        new commands.DeleteCommand({
          TableName: tableName,
          Key: { PK: pk, SK: sk },
        }),
      );
    },

    async tryPutSentNotif(item) {
      try {
        await client.send(
          new commands.PutCommand({
            TableName: tableName,
            Item: item,
            ConditionExpression: 'attribute_not_exists(SK)',
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
  };
}
