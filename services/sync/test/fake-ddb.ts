/**
 * In-memory DynamoDB DocumentClient fake covering exactly the surface the
 * sync Lambda uses: exact-key Query, begins_with Query, SK BETWEEN Query,
 * PutCommand, UpdateCommand (SET / REMOVE / if_not_exists — both the
 * `if_not_exists(x, d) + n` counter form and the plain `if_not_exists(x, d)`
 * preserve form — plus the attribute_exists condition), DeleteCommand, and
 * BatchWriteCommand with programmable UnprocessedItems injection. A stateful
 * fake (rather than per-call mocks) lets the tests assert end-state table
 * invariants: no duplicate rows, stale SKs deleted, pointers updated, user
 * fields untouched.
 */

import {
  BatchWriteCommand,
  DeleteCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import type { DocClient } from '../src/writer.js';

type Item = Record<string, unknown>;

type WriteRequest = {
  PutRequest?: { Item: Item };
  DeleteRequest?: { Key: { PK: string; SK: string } };
};

function itemKey(pk: string, sk: string): string {
  return `${pk}|${sk}`;
}

function conditionalCheckFailed(): Error {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
}

/** Split a comma-separated expression list, ignoring commas inside parens. */
function splitTopLevel(part: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of part) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) {
    out.push(current.trim());
  }
  return out;
}

export class FakeDdb {
  readonly items = new Map<string, Item>();

  /**
   * Per-BatchWrite-call counts of requests to return as UnprocessedItems
   * (taken from the END of each request chunk, not applied). Consumed
   * left-to-right; exhausted plan means everything succeeds.
   */
  unprocessedPlan: number[] = [];

  /** When true, every BatchWrite returns ALL its requests unprocessed. */
  failAllBatches = false;

  /** First n DeleteCommands throw (simulates a throttle/crash mid re-key). */
  failDeletes = 0;

  /**
   * Hook invoked at the start of every write command (BatchWrite, Put,
   * Update, Delete) BEFORE it is applied - lets a test interleave a simulated
   * user PATCH with an in-flight sync run.
   */
  beforeWrite?: () => void;

  batchWriteCalls = 0;
  queryCalls = 0;
  updateCalls = 0;
  deleteCalls = 0;

  /** The writer/state modules accept Pick<DynamoDBDocumentClient, 'send'>. */
  asDocClient(): DocClient {
    return this as unknown as DocClient;
  }

  getItem(pk: string, sk: string): Item | undefined {
    return this.items.get(itemKey(pk, sk));
  }

  /** Seed/overwrite an item directly (e.g. to simulate a user PATCH between syncs). */
  putItem(item: Item): void {
    this.items.set(itemKey(String(item.PK), String(item.SK)), { ...item });
  }

  /** Remove an item directly (e.g. to simulate a row vanishing under its pointer). */
  deleteItem(pk: string, sk: string): void {
    this.items.delete(itemKey(pk, sk));
  }

  listSks(pk: string, prefix: string): string[] {
    const sks: string[] = [];
    for (const item of this.items.values()) {
      if (item.PK === pk && typeof item.SK === 'string' && item.SK.startsWith(prefix)) {
        sks.push(item.SK);
      }
    }
    return sks.sort();
  }

  async send(command: unknown): Promise<unknown> {
    if (command instanceof QueryCommand) {
      return this.query(command);
    }
    if (command instanceof BatchWriteCommand) {
      this.beforeWrite?.();
      return this.batchWrite(command);
    }
    if (command instanceof UpdateCommand) {
      this.beforeWrite?.();
      return this.update(command);
    }
    if (command instanceof DeleteCommand) {
      this.beforeWrite?.();
      return this.delete(command);
    }
    if (command instanceof PutCommand) {
      this.beforeWrite?.();
      const item = command.input.Item as Item;
      this.items.set(itemKey(String(item.PK), String(item.SK)), { ...item });
      return {};
    }
    throw new Error(`FakeDdb: unsupported command ${String((command as object)?.constructor?.name)}`);
  }

  private query(command: QueryCommand): { Items: Item[] } {
    this.queryCalls += 1;
    const input = command.input;
    const values = input.ExpressionAttributeValues ?? {};
    const pk = values[':pk'] as string;
    const expression = input.KeyConditionExpression ?? '';

    let matches: Item[] = [];
    if (expression.includes('begins_with')) {
      const prefix = values[':prefix'] as string;
      for (const item of this.items.values()) {
        if (item.PK === pk && typeof item.SK === 'string' && item.SK.startsWith(prefix)) {
          matches.push({ ...item });
        }
      }
      matches.sort((a, b) => (String(a.SK) < String(b.SK) ? -1 : 1));
    } else if (expression.includes('BETWEEN')) {
      const start = values[':start'] as string;
      const end = values[':end'] as string;
      for (const item of this.items.values()) {
        if (
          item.PK === pk &&
          typeof item.SK === 'string' &&
          item.SK >= start &&
          item.SK <= end
        ) {
          matches.push({ ...item });
        }
      }
      matches.sort((a, b) => (String(a.SK) < String(b.SK) ? -1 : 1));
    } else {
      const sk = values[':sk'] as string;
      const item = this.items.get(itemKey(pk, sk));
      if (item !== undefined) {
        matches.push({ ...item });
      }
    }
    if (input.Limit !== undefined) {
      matches = matches.slice(0, input.Limit);
    }
    return { Items: matches };
  }

  private delete(command: DeleteCommand): Record<string, never> {
    this.deleteCalls += 1;
    if (this.failDeletes > 0) {
      this.failDeletes -= 1;
      throw new Error('FakeDdb: injected delete failure');
    }
    const key = command.input.Key as { PK: string; SK: string };
    this.items.delete(itemKey(key.PK, key.SK));
    return {};
  }

  /**
   * Minimal UpdateExpression interpreter for the shapes the sync writer
   * emits: `SET #a = :a, #v = if_not_exists(#v, :zero) + :one ... REMOVE #b`
   * (SET always precedes REMOVE) plus the `attribute_exists(PK)` condition.
   */
  private update(command: UpdateCommand): Record<string, never> {
    this.updateCalls += 1;
    const input = command.input;
    const key = input.Key as { PK: string; SK: string };
    const mapKey = itemKey(key.PK, key.SK);
    const existing = this.items.get(mapKey);

    if (input.ConditionExpression?.includes('attribute_exists') === true && existing === undefined) {
      throw conditionalCheckFailed();
    }

    const item: Item = existing !== undefined ? { ...existing } : { PK: key.PK, SK: key.SK };
    const names = (input.ExpressionAttributeNames ?? {}) as Record<string, string>;
    const values = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
    const resolveName = (token: string): string =>
      token.startsWith('#') ? (names[token] ?? token) : token;
    const resolveValue = (token: string): unknown =>
      token.startsWith(':') ? values[token] : token;

    const expr = input.UpdateExpression ?? '';
    const setIdx = expr.indexOf('SET ');
    const removeIdx = expr.indexOf('REMOVE ');
    const setPart =
      setIdx >= 0 ? expr.slice(setIdx + 4, removeIdx > setIdx ? removeIdx : undefined) : '';
    const removePart = removeIdx >= 0 ? expr.slice(removeIdx + 7) : '';

    for (const assignment of splitTopLevel(setPart)) {
      const eq = assignment.indexOf('=');
      if (eq < 0) {
        throw new Error(`FakeDdb: cannot parse SET assignment "${assignment}"`);
      }
      const target = resolveName(assignment.slice(0, eq).trim());
      const rhs = assignment.slice(eq + 1).trim();
      const incremented = rhs.match(
        /^if_not_exists\(\s*([^,]+)\s*,\s*([^)]+)\)\s*\+\s*(.+)$/,
      );
      const preserved = rhs.match(/^if_not_exists\(\s*([^,]+)\s*,\s*([^)]+)\)$/);
      if (incremented !== null) {
        const baseName = resolveName((incremented[1] as string).trim());
        const baseDefault = resolveValue((incremented[2] as string).trim());
        const increment = resolveValue((incremented[3] as string).trim());
        const base = item[baseName] ?? baseDefault;
        item[target] = Number(base) + Number(increment);
      } else if (preserved !== null) {
        const baseName = resolveName((preserved[1] as string).trim());
        const baseDefault = resolveValue((preserved[2] as string).trim());
        item[target] = item[baseName] ?? baseDefault;
      } else {
        item[target] = resolveValue(rhs);
      }
    }
    for (const token of splitTopLevel(removePart)) {
      delete item[resolveName(token)];
    }

    this.items.set(mapKey, item);
    return {};
  }

  private batchWrite(command: BatchWriteCommand): {
    UnprocessedItems?: Record<string, WriteRequest[]>;
  } {
    this.batchWriteCalls += 1;
    const requestItems = command.input.RequestItems ?? {};
    const tableNames = Object.keys(requestItems);
    const tableName = tableNames[0];
    if (tableName === undefined) {
      return {};
    }
    const requests = (requestItems[tableName] ?? []) as WriteRequest[];

    let unprocessedCount = 0;
    if (this.failAllBatches) {
      unprocessedCount = requests.length;
    } else if (this.unprocessedPlan.length > 0) {
      unprocessedCount = Math.min(this.unprocessedPlan.shift() ?? 0, requests.length);
    }

    const applyCount = requests.length - unprocessedCount;
    for (let i = 0; i < applyCount; i += 1) {
      const request = requests[i];
      if (request?.PutRequest !== undefined) {
        const item = request.PutRequest.Item;
        this.items.set(itemKey(String(item.PK), String(item.SK)), { ...item });
      } else if (request?.DeleteRequest !== undefined) {
        const key = request.DeleteRequest.Key;
        this.items.delete(itemKey(key.PK, key.SK));
      }
    }

    if (unprocessedCount === 0) {
      return {};
    }
    return { UnprocessedItems: { [tableName]: requests.slice(applyCount) } };
  }
}
