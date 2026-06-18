/**
 * CSV text -> raw cell matrix via papaparse (P7-6).
 *
 * papaparse is lazily required and typed against the narrow surface this
 * feature uses, mirroring the shell's expo-document-picker pattern in
 * src/lib/filePicker.ts: the dependency is declared in app/package.json, and
 * the lazy require keeps module-evaluation order (and typecheck) independent
 * of it.
 *
 * No silent row drops: rows papaparse flags stay accounted for as
 * `rowIssues` (line + message) so the mapping step can convert them into
 * reported failures instead of quietly skipping them.
 */
import { normalizeCsvAmount, normalizeCsvDate } from '@goldfinch/shared/csv';

import { logger } from '../../../src/lib/logger';

export class CsvParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CsvParseError';
  }
}

/** One papaparse-flagged row; `line` is 1-based over the parsed rows. */
export interface CsvRowIssue {
  line: number;
  message: string;
}

export interface ParsedCsv {
  /** Every parsed row (header included when present), cells as strings. */
  rows: string[][];
  /** Widest row width; mapping offers this many columns. */
  columnCount: number;
  /** Row-scoped papaparse errors -- these rows must not import silently. */
  rowIssues: CsvRowIssue[];
  /** File-scoped papaparse errors (e.g. undetectable delimiter). */
  fileIssues: string[];
  delimiter: string | null;
}

// ---------------------------------------------------------------------------
// Lazy papaparse (narrow typed surface)
// ---------------------------------------------------------------------------

interface PapaError {
  message: string;
  /** 0-based data row index; absent for file-level errors. */
  row?: number;
}

interface PapaResult {
  data: unknown[];
  errors: PapaError[];
  meta?: { delimiter?: string };
}

interface PapaModule {
  parse(input: string, config: { skipEmptyLines?: boolean | 'greedy' }): PapaResult;
}

function loadPapaparse(): PapaModule {
  try {
    // Lazy require keeps typecheck and cold-start module evaluation
    // independent of the dependency install (same pattern as filePicker).
    return require('papaparse') as PapaModule;
  } catch (error) {
    logger.error('papaparse failed to load', { error });
    throw new CsvParseError('papaparse is unavailable; run npm install and rebuild', {
      cause: error,
    });
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function toStringCells(row: unknown): string[] {
  if (!Array.isArray(row)) return [String(row ?? '')];
  return row.map((cell) => (cell === null || cell === undefined ? '' : String(cell)));
}

/**
 * Parse CSV text into a raw string matrix. Throws CsvParseError when the
 * file yields no rows at all; structural problems on individual rows are
 * returned as rowIssues, never dropped.
 */
export function parseCsvText(text: string): ParsedCsv {
  const papa = loadPapaparse();
  // Strip a UTF-8 BOM so the first header cell matches by name.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  let result: PapaResult;
  try {
    result = papa.parse(input, { skipEmptyLines: 'greedy' });
  } catch (error) {
    logger.error('papaparse threw while parsing CSV text', { error });
    throw new CsvParseError('Parsing the CSV file failed', { cause: error });
  }

  const rows = result.data.map(toStringCells);
  if (rows.length === 0) {
    throw new CsvParseError('The file contains no CSV rows');
  }

  const rowIssues: CsvRowIssue[] = [];
  const fileIssues: string[] = [];
  for (const error of result.errors) {
    if (typeof error.row === 'number' && Number.isInteger(error.row) && error.row >= 0) {
      rowIssues.push({ line: error.row + 1, message: error.message });
    } else {
      fileIssues.push(error.message);
    }
  }
  if (rowIssues.length > 0 || fileIssues.length > 0) {
    logger.warn('CSV parsed with issues', {
      rowIssueCount: rowIssues.length,
      fileIssues,
    });
  }

  let columnCount = 0;
  for (const row of rows) {
    if (row.length > columnCount) columnCount = row.length;
  }

  return {
    rows,
    columnCount,
    rowIssues,
    fileIssues,
    delimiter: result.meta?.delimiter ?? null,
  };
}

// ---------------------------------------------------------------------------
// Header heuristic
// ---------------------------------------------------------------------------

function looksLikeData(cell: string): boolean {
  try {
    normalizeCsvDate(cell);
    return true;
  } catch {
    // Not a date; try amount below.
  }
  try {
    // Currency only sets the minor-unit scale; USD is fine for "is this an
    // amount at all" detection.
    normalizeCsvAmount(cell, 'USD');
    return true;
  } catch {
    return false;
  }
}

/**
 * Heuristic: the first row is a header when none of its cells parse as a
 * date or an amount. The mapping step exposes a manual toggle for the files
 * this guesses wrong.
 */
export function guessHasHeader(rows: ReadonlyArray<readonly string[]>): boolean {
  const first = rows[0];
  if (first === undefined || first.length === 0) return false;
  return !first.some((cell) => cell.trim().length > 0 && looksLikeData(cell));
}
