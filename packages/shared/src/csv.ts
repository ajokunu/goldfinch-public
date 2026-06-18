/**
 * CSV-import row normalization + dedup hashing (P7-6).
 *
 * The client parses CSV locally (papaparse), maps columns interactively, runs
 * each raw row through `normalizeCsvRow`, and POSTs NORMALIZED rows to
 * POST /import/transactions. The server recomputes `rowHash` from the same
 * normalized fields and writes TXNPTR#import:<importId>:<rowHash> pointers,
 * so retried batches can never double-import. Both sides MUST use this module
 * — it is the single definition of "the same row".
 *
 * Platform-neutral: pure string/BigInt math + a pure-TS SHA-256 (no
 * node:crypto), so the Expo client can hash for duplicate preview.
 */

import { sha256Hex } from './internal/sha256.js';
import { parseCurrencyAmount, toCurrencyDecimalString } from './money.js';
import { assertIsoDate } from './keys.js';
import type {
  CurrencyCode,
  DecimalString,
  IsoDate,
  MinorUnits,
} from './types/common.js';

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvError';
  }
}

/** One raw row after the user's column mapping, before normalization. */
export interface RawCsvRow {
  /** Raw date cell: yyyy-mm-dd, yyyy/mm/dd, or US mm/dd/yyyy (also m/d/yy). */
  date: string;
  /** Raw amount cell: "$1,234.56", "(45.99)", "-45.99", "45.99-", etc. */
  amount: string;
  payee: string;
  /** Raw category cell; mapping to a slug happens upstream in the UI. */
  category?: string;
  note?: string;
}

/** The canonical normalized row — exactly what ImportRowDto carries. */
export interface NormalizedCsvRow {
  date: IsoDate;
  /** Signed minor units; expense negative (TXN sign convention). */
  amountMinor: MinorUnits;
  /** Lossless decimal rendering of amountMinor in the row's currency. */
  amount: DecimalString;
  /** Trimmed, whitespace-collapsed payee (original casing preserved). */
  payee: string;
  categoryId?: string | null;
  note?: string;
}

export interface NormalizeCsvRowOptions {
  /** Target account currency — determines the minor-unit scale. */
  currency: CurrencyCode;
  /** Pre-mapped category slug for the row, if the user mapped one. */
  categoryId?: string | null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASH_YMD = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const SLASH_MDY = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;

function daysInMonth(year: number, month: number): number {
  // month 1-12. Day 0 of the next month == last day of this month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function buildDate(yearRaw: number, monthRaw: number, dayRaw: number, original: string): IsoDate {
  // Two-digit years pivot at 70: 70-99 => 19xx, 00-69 => 20xx.
  const year = yearRaw < 100 ? (yearRaw >= 70 ? 1900 + yearRaw : 2000 + yearRaw) : yearRaw;
  if (monthRaw < 1 || monthRaw > 12) {
    throw new CsvError(`invalid month in date "${original}"`);
  }
  if (dayRaw < 1 || dayRaw > daysInMonth(year, monthRaw)) {
    throw new CsvError(`invalid day in date "${original}"`);
  }
  const date = `${String(year).padStart(4, '0')}-${String(monthRaw).padStart(2, '0')}-${String(dayRaw).padStart(2, '0')}`;
  assertIsoDate(date);
  return date;
}

/**
 * Normalize a raw date cell to yyyy-mm-dd. Accepted forms: ISO yyyy-mm-dd,
 * yyyy/mm/dd, and US-style mm/dd/yyyy (or m/d/yy — two-digit years pivot at
 * 70). Slash dates are ALWAYS read month-first; the import UI's mapping
 * preview is the guard against dd/mm sources. Calendar validity is enforced
 * (no Feb 30).
 */
export function normalizeCsvDate(raw: string): IsoDate {
  const value = raw.trim();
  if (value.length === 0) {
    throw new CsvError('date cell is empty');
  }
  let match = ISO_DATE.exec(value);
  if (match) {
    return buildDate(Number(match[1]), Number(match[2]), Number(match[3]), value);
  }
  match = SLASH_YMD.exec(value);
  if (match) {
    return buildDate(Number(match[1]), Number(match[2]), Number(match[3]), value);
  }
  match = SLASH_MDY.exec(value);
  if (match) {
    return buildDate(Number(match[3]), Number(match[1]), Number(match[2]), value);
  }
  throw new CsvError(`unrecognized date format: "${raw}"`);
}

/**
 * Normalize a raw amount cell to signed minor units in `currency`.
 * Handles currency symbols, thousands separators, surrounding whitespace,
 * accounting parentheses "(45.99)" == -45.99, and trailing minus "45.99-".
 * Anything that still is not an exact decimal throws CsvError (never a float
 * fallback, never a silent 0).
 */
export function normalizeCsvAmount(raw: string, currency: CurrencyCode): MinorUnits {
  let value = raw.trim();
  if (value.length === 0) {
    throw new CsvError('amount cell is empty');
  }
  let negative = false;
  if (value.startsWith('(') && value.endsWith(')')) {
    negative = true;
    value = value.slice(1, -1).trim();
  }
  if (value.endsWith('-')) {
    negative = !negative;
    value = value.slice(0, -1).trim();
  }
  if (value.startsWith('-')) {
    negative = !negative;
    value = value.slice(1).trim();
  } else if (value.startsWith('+')) {
    value = value.slice(1).trim();
  }
  // Strip currency symbols/codes and thousands separators, keep digits + '.'.
  value = value.replace(/[$€£¥₹]/g, '').replace(/[A-Za-z]/g, '').replace(/[,\s]/g, '');
  if (value.length === 0) {
    throw new CsvError(`amount cell has no digits: "${raw}"`);
  }
  let minor: MinorUnits;
  try {
    minor = parseCurrencyAmount(value, currency);
  } catch (cause) {
    throw new CsvError(
      `cannot parse amount "${raw}": ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return negative ? (minor === 0 ? 0 : -minor) : minor;
}

/** Trim + collapse internal whitespace; throws on empty (a row needs a payee). */
export function normalizeCsvPayee(raw: string): string {
  const payee = raw.replace(/\s+/g, ' ').trim();
  if (payee.length === 0) {
    throw new CsvError('payee cell is empty');
  }
  return payee;
}

/** Full row normalization: the one path from raw cells to an ImportRowDto body. */
export function normalizeCsvRow(raw: RawCsvRow, options: NormalizeCsvRowOptions): NormalizedCsvRow {
  const date = normalizeCsvDate(raw.date);
  const amountMinor = normalizeCsvAmount(raw.amount, options.currency);
  const payee = normalizeCsvPayee(raw.payee);
  const note = raw.note?.replace(/\s+/g, ' ').trim();
  const row: NormalizedCsvRow = {
    date,
    amountMinor,
    amount: toCurrencyDecimalString(amountMinor, options.currency),
    payee,
    categoryId: options.categoryId ?? null,
  };
  if (note !== undefined && note.length > 0) {
    row.note = note;
  }
  return row;
}

/** Bumped if the canonical hash-input string ever changes shape. */
export const ROW_HASH_VERSION = 'v1';

/**
 * Dedup identity hash for one normalized row: lowercase hex SHA-256 over
 * (date, amountMinor, lowercased payee, occurrence). Category and note are
 * deliberately EXCLUDED — re-importing the same statement with different
 * category mappings must still dedupe.
 *
 * `occurrence` (default 0) disambiguates legitimately identical rows in one
 * file (two same-price coffees on one day); use `computeRowHashes` to assign
 * occurrence indexes consistently.
 *
 * Output is hex, so it is always safe inside importTxnPointerSk (no '#'/':').
 */
export function rowHash(
  row: Pick<NormalizedCsvRow, 'date' | 'amountMinor' | 'payee'>,
  occurrence = 0,
): string {
  assertIsoDate(row.date);
  if (!Number.isSafeInteger(row.amountMinor)) {
    throw new CsvError(`amountMinor must be a safe integer, got ${String(row.amountMinor)}`);
  }
  if (!Number.isSafeInteger(occurrence) || occurrence < 0) {
    throw new CsvError(`occurrence must be a non-negative integer, got ${String(occurrence)}`);
  }
  const payee = row.payee.replace(/\s+/g, ' ').trim().toLowerCase();
  if (payee.length === 0) {
    throw new CsvError('cannot hash a row with an empty payee');
  }
  const canonical = `${ROW_HASH_VERSION}|${row.date}|${row.amountMinor}|${payee}|${occurrence}`;
  return sha256Hex(canonical);
}

/**
 * Hash a whole batch IN ORDER, assigning occurrence indexes 0,1,2,... to rows
 * with identical (date, amountMinor, payee) identity. Both client and server
 * must call this over the same row ordering to agree on hashes — the request
 * row order is the contract.
 */
export function computeRowHashes(
  rows: ReadonlyArray<Pick<NormalizedCsvRow, 'date' | 'amountMinor' | 'payee'>>,
): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const payee = row.payee.replace(/\s+/g, ' ').trim().toLowerCase();
    const identity = `${row.date}|${row.amountMinor}|${payee}`;
    const occurrence = seen.get(identity) ?? 0;
    seen.set(identity, occurrence + 1);
    return rowHash(row, occurrence);
  });
}

export { sha256Hex };
