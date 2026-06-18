/**
 * Column mapping + row normalization for the CSV import wizard (P7-6).
 *
 * All normalization goes through @goldfinch/shared/csv -- the single
 * definition of "the same row" shared with the server -- so what the preview
 * shows is byte-for-byte what POST /import/transactions receives. Rows that
 * fail normalization become reported RowFailures (line + reason), never
 * silent drops.
 */
import { CsvError, normalizeCsvRow, type NormalizedCsvRow } from '@goldfinch/shared/csv';
import type { CategoryDto, CurrencyCode } from '@goldfinch/shared/types';

import { logger } from '../../../src/lib/logger';
import type { CsvRowIssue } from './parseCsv';

// ---------------------------------------------------------------------------
// Mapping model
// ---------------------------------------------------------------------------

export type MappingField = 'date' | 'amount' | 'payee' | 'category' | 'note';

export const REQUIRED_FIELDS: readonly MappingField[] = ['date', 'amount', 'payee'];

/** Column index per field; null = not mapped. */
export type ColumnMapping = Record<MappingField, number | null>;

export const EMPTY_MAPPING: ColumnMapping = {
  date: null,
  amount: null,
  payee: null,
  category: null,
  note: null,
};

export function isMappingComplete(mapping: ColumnMapping): boolean {
  return REQUIRED_FIELDS.every((field) => mapping[field] !== null);
}

/** Display label for a column: header text when known, else "Column N". */
export function columnLabel(index: number, headerRow: readonly string[] | null): string {
  const header = headerRow?.[index]?.trim();
  if (header !== undefined && header.length > 0) {
    return header;
  }
  return `Column ${index + 1}`;
}

const HEADER_GUESSES: ReadonlyArray<readonly [MappingField, readonly string[]]> = [
  ['date', ['date', 'transaction date', 'posted date', 'posting date', 'posted']],
  ['amount', ['amount', 'value', 'transaction amount']],
  ['payee', ['payee', 'description', 'merchant', 'name', 'details']],
  ['category', ['category']],
  ['note', ['note', 'notes', 'memo', 'comment']],
];

/** Best-effort initial mapping from header names; user can change everything. */
export function guessMapping(
  headerRow: readonly string[] | null,
  columnCount: number,
): ColumnMapping {
  const mapping: ColumnMapping = { ...EMPTY_MAPPING };
  if (headerRow === null) return mapping;
  const used = new Set<number>();
  const lower = headerRow.map((cell) => cell.trim().toLowerCase());
  for (const [field, candidates] of HEADER_GUESSES) {
    for (const candidate of candidates) {
      const index = lower.findIndex(
        (cell, i) => i < columnCount && !used.has(i) && cell === candidate,
      );
      if (index !== -1) {
        mapping[field] = index;
        used.add(index);
        break;
      }
    }
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// Category matching
// ---------------------------------------------------------------------------

/**
 * Lookup from a raw CSV category cell to a category slug: matches active
 * category names and slugs case-insensitively. Unmatched values import as
 * uncategorized (surfaced in the mapping step, not an error).
 */
export function buildCategoryIndex(
  categories: readonly CategoryDto[],
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const category of categories) {
    if (category.archived) continue;
    index.set(category.name.trim().toLowerCase(), category.categoryId);
    index.set(category.categoryId.trim().toLowerCase(), category.categoryId);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Row preparation (normalization + accounting)
// ---------------------------------------------------------------------------

/** One import-ready row; `line` is its 1-based line in the parsed file. */
export interface PreparedRow {
  line: number;
  row: NormalizedCsvRow;
}

/** One row that cannot import, with the reason shown in the error report. */
export interface RowFailure {
  line: number;
  reason: string;
}

export interface PreparedImport {
  rows: PreparedRow[];
  failures: RowFailure[];
  /** Distinct raw category values that matched a category. */
  matchedCategoryValues: string[];
  /** Distinct raw category values importing as uncategorized. */
  unmatchedCategoryValues: string[];
  /** Rows whose (date, amount, payee) identity repeats within the file. */
  duplicateRowCount: number;
}

/** Dedup identity per the shared rowHash contract (occurrence excluded). */
export function rowIdentity(row: NormalizedCsvRow): string {
  // payee is already whitespace-collapsed + trimmed by normalizeCsvRow.
  return `${row.date}|${row.amountMinor}|${row.payee.toLowerCase()}`;
}

export interface PrepareRowsArgs {
  /** All parsed rows (header included when hasHeader). */
  allRows: ReadonlyArray<readonly string[]>;
  hasHeader: boolean;
  mapping: ColumnMapping;
  currency: CurrencyCode;
  categoryIndex: ReadonlyMap<string, string>;
  /** papaparse row-scoped issues; those rows become failures, not imports. */
  parseIssues: readonly CsvRowIssue[];
}

/**
 * Normalize every data row through the shared CSV module. Every input row
 * lands in exactly one bucket -- `rows` (import-ready) or `failures`
 * (reported with line + reason) -- so the final report always accounts for
 * the whole file.
 */
export function prepareRows(args: PrepareRowsArgs): PreparedImport {
  const { allRows, hasHeader, mapping, currency, categoryIndex, parseIssues } = args;
  const { date: dateCol, amount: amountCol, payee: payeeCol } = mapping;
  if (dateCol === null || amountCol === null || payeeCol === null) {
    throw new CsvError('date, amount, and payee columns must all be mapped');
  }

  const issueByLine = new Map<number, string>();
  for (const issue of parseIssues) {
    if (!issueByLine.has(issue.line)) issueByLine.set(issue.line, issue.message);
  }

  const rows: PreparedRow[] = [];
  const failures: RowFailure[] = [];
  const matchedValues = new Set<string>();
  const unmatchedValues = new Set<string>();
  const identityCounts = new Map<string, number>();

  const start = hasHeader ? 1 : 0;
  for (let i = start; i < allRows.length; i += 1) {
    const line = i + 1;
    const cells = allRows[i];
    if (cells === undefined) continue;

    const parseIssue = issueByLine.get(line);
    if (parseIssue !== undefined) {
      failures.push({ line, reason: `CSV parse error: ${parseIssue}` });
      continue;
    }

    const rawCategory = mapping.category !== null ? (cells[mapping.category] ?? '') : '';
    let categoryId: string | undefined;
    const categoryKey = rawCategory.trim().toLowerCase();
    if (mapping.category !== null && categoryKey.length > 0) {
      const matched = categoryIndex.get(categoryKey);
      if (matched !== undefined) {
        categoryId = matched;
        matchedValues.add(rawCategory.trim());
      } else {
        unmatchedValues.add(rawCategory.trim());
      }
    }

    try {
      const normalized = normalizeCsvRow(
        {
          date: cells[dateCol] ?? '',
          amount: cells[amountCol] ?? '',
          payee: cells[payeeCol] ?? '',
          ...(mapping.note !== null ? { note: cells[mapping.note] ?? '' } : {}),
        },
        { currency, categoryId: categoryId ?? null },
      );
      rows.push({ line, row: normalized });
      const identity = rowIdentity(normalized);
      identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
    } catch (error) {
      if (error instanceof CsvError) {
        failures.push({ line, reason: error.message });
      } else {
        // Unexpected (not a data problem): report the row AND log loudly.
        logger.error('unexpected error normalizing CSV row', { line, error });
        failures.push({
          line,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  let duplicateRowCount = 0;
  for (const count of identityCounts.values()) {
    if (count > 1) duplicateRowCount += count;
  }

  return {
    rows,
    failures,
    matchedCategoryValues: [...matchedValues].sort(),
    unmatchedCategoryValues: [...unmatchedValues].sort(),
    duplicateRowCount,
  };
}
