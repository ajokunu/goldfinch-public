/**
 * Sequential batch runner for POST /import/transactions (P7-6).
 *
 * Posts the planned batches one at a time through the shell's
 * useImportTransactions mutation (whose invalidation set is the contract for
 * which views an import touches), accumulating progress + per-row outcomes.
 *
 * Failure accounting -- no silently dropped rows:
 * - A 400 with details:{row} pins the server message to that row's original
 *   file line; its batch-mates are reported as rejected alongside it.
 * - Any other batch error marks the whole batch failed with the message.
 * - Batches after a failure are reported as "not attempted".
 * Re-running the same plan is safe: importId + row hashes make already
 * imported rows come back as duplicates, never as second copies.
 */
import { useCallback, useRef, useState } from 'react';
import type { ImportRowDto, ImportTransactionsRequest } from '@goldfinch/shared/types';

import { useImportTransactions } from '../../../src/api/mutations';
import { logger } from '../../../src/lib/logger';
import { errorMessage, validationRowIndex } from '../lib/errors';
import type { PreparedRow, RowFailure } from '../lib/mapping';

export type ImportRunPhase = 'idle' | 'running' | 'success' | 'failed';

export interface ImportRunState {
  phase: ImportRunPhase;
  batchesTotal: number;
  batchesDone: number;
  rowsTotal: number;
  /** Rows the server has accounted for (created + duplicates). */
  rowsProcessed: number;
  created: number;
  duplicates: number;
  /** Per-row outcomes for rows that did not import (line + reason). */
  failures: RowFailure[];
  /** Summary message when phase === 'failed'. */
  errorMessage: string | null;
}

const IDLE_STATE: ImportRunState = {
  phase: 'idle',
  batchesTotal: 0,
  batchesDone: 0,
  rowsTotal: 0,
  rowsProcessed: 0,
  created: 0,
  duplicates: 0,
  failures: [],
  errorMessage: null,
};

export interface ImportRunInput {
  importId: string;
  accountId: string;
  batches: ReadonlyArray<readonly PreparedRow[]>;
}

function toRowDto(prepared: PreparedRow): ImportRowDto {
  const { row } = prepared;
  return {
    date: row.date,
    amount: row.amount,
    payee: row.payee,
    categoryId: row.categoryId ?? null,
    ...(row.note !== undefined ? { note: row.note } : {}),
  };
}

/** Failure rows for one batch given the error that rejected it. */
function batchFailures(
  batch: readonly PreparedRow[],
  error: unknown,
): RowFailure[] {
  const rowIndex = validationRowIndex(error);
  const message = errorMessage(error);
  const offender = rowIndex !== null ? batch[rowIndex] : undefined;
  if (offender !== undefined) {
    return batch.map((prepared) =>
      prepared === offender
        ? { line: prepared.line, reason: message }
        : {
            line: prepared.line,
            reason: `Not imported: this batch was rejected because line ${offender.line} failed validation.`,
          },
    );
  }
  return batch.map((prepared) => ({
    line: prepared.line,
    reason: `Batch failed: ${message}`,
  }));
}

export function useImportRunner(): {
  state: ImportRunState;
  run: (input: ImportRunInput) => Promise<void>;
  reset: () => void;
} {
  const importMutation = useImportTransactions();
  const [state, setState] = useState<ImportRunState>(IDLE_STATE);
  const runningRef = useRef(false);

  const run = useCallback(
    async (input: ImportRunInput): Promise<void> => {
      if (runningRef.current) {
        logger.warn('import runner invoked while already running', {
          importId: input.importId,
        });
        return;
      }
      runningRef.current = true;

      const { importId, accountId, batches } = input;
      let rowsTotal = 0;
      for (const batch of batches) rowsTotal += batch.length;

      setState({
        ...IDLE_STATE,
        phase: 'running',
        batchesTotal: batches.length,
        rowsTotal,
      });

      try {
        for (let i = 0; i < batches.length; i += 1) {
          const batch = batches[i];
          if (batch === undefined || batch.length === 0) continue;

          const request: ImportTransactionsRequest = {
            importId,
            accountId,
            // Row order inside the request is part of the hashing contract.
            rows: batch.map(toRowDto),
          };

          try {
            const response = await importMutation.mutateAsync(request);
            setState((prev) => ({
              ...prev,
              batchesDone: i + 1,
              rowsProcessed: prev.rowsProcessed + response.received,
              created: prev.created + response.created,
              duplicates: prev.duplicates + response.duplicates,
            }));
          } catch (error) {
            logger.error('import batch failed', {
              importId,
              accountId,
              batchIndex: i,
              batchSize: batch.length,
              error,
            });
            const failures = batchFailures(batch, error);
            for (const rest of batches.slice(i + 1)) {
              for (const prepared of rest) {
                failures.push({
                  line: prepared.line,
                  reason:
                    'Not attempted: an earlier batch failed. Importing this file again is safe -- rows already imported are skipped.',
                });
              }
            }
            setState((prev) => ({
              ...prev,
              phase: 'failed',
              failures,
              errorMessage: errorMessage(error),
            }));
            return;
          }
        }
        setState((prev) => ({ ...prev, phase: 'success' }));
        logger.info('import completed', { importId, accountId, rowsTotal });
      } finally {
        runningRef.current = false;
      }
    },
    [importMutation],
  );

  const reset = useCallback(() => {
    if (runningRef.current) {
      logger.warn('import runner reset ignored while running');
      return;
    }
    setState(IDLE_STATE);
  }, []);

  return { state, run, reset };
}
