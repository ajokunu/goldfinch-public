/**
 * Import identity + batch planning (P7-6).
 *
 * importId is derived deterministically from the target account and the raw
 * file text (shared sha256, hex => always safe inside importTxnPointerSk).
 * That makes re-importing the same file into the same account naturally
 * idempotent: the server's TXNPTR#import:<importId>:<rowHash> pointers skip
 * every row that already landed, including across category-mapping changes
 * (rowHash deliberately excludes category/note).
 *
 * Batching honors the server hashing contract: computeRowHashes assigns
 * occurrence indexes per REQUEST, so rows with an identical (date, amount,
 * payee) identity must travel in the same batch -- splitting such a group
 * across batches would restart occurrence at 0 and silently merge real rows
 * into "duplicates". planBatches therefore keeps identity groups contiguous
 * and whole; per-identity occurrence counting also keeps hashes stable across
 * re-imports even when batch boundaries shift.
 */
import { IMPORT_MAX_ROWS_PER_BATCH } from '@goldfinch/shared/constants';
import { sha256Hex } from '@goldfinch/shared/csv';

import { rowIdentity, type PreparedRow, type RowFailure } from './mapping';

/**
 * Deterministic import id: same file + same target account => same importId
 * (true re-import idempotency); same file into a different account imports
 * fresh. 32 hex chars (128 bits), no '#'/':' so the server accepts it.
 */
export function deriveImportId(accountId: string, fileText: string): string {
  return sha256Hex(`goldfinch-import|v1|${accountId}|${fileText}`).slice(0, 32);
}

export interface ImportPlan {
  batches: PreparedRow[][];
  /**
   * Rows that cannot be expressed under the batching contract (more than
   * IMPORT_MAX_ROWS_PER_BATCH rows with one identical identity). Reported,
   * never silently merged.
   */
  oversizeFailures: RowFailure[];
  /** Rows that will actually be sent (sum of batch sizes). */
  plannedRowCount: number;
}

/**
 * Chunk prepared rows into batches of at most IMPORT_MAX_ROWS_PER_BATCH,
 * grouping identical-identity rows contiguously (first-seen file order) and
 * never splitting a group across batches.
 */
export function planBatches(rows: readonly PreparedRow[]): ImportPlan {
  const groups = new Map<string, PreparedRow[]>();
  for (const prepared of rows) {
    const identity = rowIdentity(prepared.row);
    const group = groups.get(identity);
    if (group === undefined) {
      groups.set(identity, [prepared]);
    } else {
      group.push(prepared);
    }
  }

  const batches: PreparedRow[][] = [];
  const oversizeFailures: RowFailure[] = [];
  let current: PreparedRow[] = [];

  for (let group of groups.values()) {
    if (group.length > IMPORT_MAX_ROWS_PER_BATCH) {
      // Occurrences beyond one batch cannot hash consistently; import the
      // first batch-full and report the remainder explicitly.
      for (const prepared of group.slice(IMPORT_MAX_ROWS_PER_BATCH)) {
        oversizeFailures.push({
          line: prepared.line,
          reason:
            `More than ${IMPORT_MAX_ROWS_PER_BATCH} rows share the same date, ` +
            'amount, and payee; rows beyond that limit cannot be imported in one import.',
        });
      }
      group = group.slice(0, IMPORT_MAX_ROWS_PER_BATCH);
    }
    if (current.length + group.length > IMPORT_MAX_ROWS_PER_BATCH) {
      batches.push(current);
      current = [];
    }
    current.push(...group);
    if (current.length === IMPORT_MAX_ROWS_PER_BATCH) {
      batches.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    batches.push(current);
  }

  let plannedRowCount = 0;
  for (const batch of batches) plannedRowCount += batch.length;

  return { batches, oversizeFailures, plannedRowCount };
}
