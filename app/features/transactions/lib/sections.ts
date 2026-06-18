/**
 * Flatten useInfiniteQuery pages into a single FlashList data array with
 * date section headers interleaved, plus per-currency day totals on each
 * header (screens.md 2.4).
 *
 * The server returns items newest-first (ScanIndexForward=false), already
 * sorted, so grouping is a single linear pass -- no client re-sort. A txnId
 * dedup guard protects against the rare item that moves across a page
 * boundary between fetches (cursor pagination is not snapshot-isolated).
 *
 * Day totals are integer sums of `amountMinor` per currency (the only
 * client-side money aggregation the spec permits, screens.md 0.1).
 * Completeness rule (screens.md 2.4): a day's total renders only when the
 * day is fully loaded -- a strictly older date follows it in the pager
 * output, or the list is complete (no nextCursor). Because the list is
 * newest-first, every group except the last is followed by an older date;
 * the trailing group is complete only when `listComplete` is true.
 *
 * Pure module (no react-native imports); exercised by node --test in
 * test/sections.test.ts and StrykerJS-eligible.
 */
import type {
  CurrencyCode,
  ListTransactionsResponse,
  MinorUnits,
  TransactionDto,
} from '@goldfinch/shared/types';

/** One currency's integer day total (sum of the day's amountMinor). */
export interface DayTotal {
  currency: CurrencyCode;
  totalMinor: MinorUnits;
}

export interface SectionHeaderItem {
  kind: 'header';
  /** yyyy-mm-dd bucket the following rows belong to. */
  date: string;
  /** Stable FlashList key. */
  key: string;
  /**
   * Per-currency totals for the day, in first-seen currency order; null
   * while the day may still be partially loaded (never render a wrong
   * total for a trailing, still-paging day).
   */
  totals: readonly DayTotal[] | null;
}

export interface TransactionRowItem {
  kind: 'txn';
  txn: TransactionDto;
  key: string;
}

export type TransactionListItem = SectionHeaderItem | TransactionRowItem;

export function flattenPages(
  pages: readonly ListTransactionsResponse[] | undefined,
): TransactionDto[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const items: TransactionDto[] = [];
  for (const page of pages) {
    for (const txn of page.items) {
      if (seen.has(txn.txnId)) continue;
      seen.add(txn.txnId);
      items.push(txn);
    }
  }
  return items;
}

/** Integer per-currency sums for one day's rows, first-seen currency order. */
function dayTotals(txns: readonly TransactionDto[]): DayTotal[] {
  const byCurrency = new Map<CurrencyCode, number>();
  for (const txn of txns) {
    byCurrency.set(
      txn.currency,
      (byCurrency.get(txn.currency) ?? 0) + txn.amountMinor,
    );
  }
  return [...byCurrency.entries()].map(([currency, totalMinor]) => ({
    currency,
    totalMinor,
  }));
}

/**
 * Interleave date headers into an already newest-first transaction list.
 * `listComplete` should be true when the pager has no nextCursor; it gates
 * the trailing day's total per the completeness rule above.
 */
export function buildListItems(
  transactions: readonly TransactionDto[],
  listComplete = false,
): TransactionListItem[] {
  // Group consecutive same-date runs (input is already date-sorted).
  const groups: Array<{ date: string; txns: TransactionDto[] }> = [];
  for (const txn of transactions) {
    const current = groups[groups.length - 1];
    if (current && current.date === txn.date) {
      current.txns.push(txn);
    } else {
      groups.push({ date: txn.date, txns: [txn] });
    }
  }

  const out: TransactionListItem[] = [];
  // entries() yields definite elements, so no index-bounds guard is needed
  // (an indexed loop's `groups[i]` undefined-check would be dead code).
  for (const [i, group] of groups.entries()) {
    const dayComplete = i < groups.length - 1 || listComplete;
    out.push({
      kind: 'header',
      date: group.date,
      key: `header:${group.date}`,
      totals: dayComplete ? dayTotals(group.txns) : null,
    });
    for (const txn of group.txns) {
      out.push({ kind: 'txn', txn, key: `txn:${txn.txnId}` });
    }
  }
  return out;
}

/** Find a transaction by id across flattened items (detail view source). */
export function findTransaction(
  transactions: readonly TransactionDto[],
  txnId: string | null,
): TransactionDto | undefined {
  if (!txnId) return undefined;
  return transactions.find((txn) => txn.txnId === txnId);
}
