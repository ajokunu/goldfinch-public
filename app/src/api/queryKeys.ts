/**
 * Query-key factory mirroring the DynamoDB access patterns (master plan
 * sections 5 and 12). Every feature MUST build its keys through this factory
 * so cache invalidation stays coherent across feature parts.
 *
 * Conventions:
 * - All keys are rooted at ['goldfinch'] for whole-cache operations.
 * - Transaction list keys normalize the filter object (sorted keys, undefined
 *   dropped, cursor excluded -- pagination belongs to useInfiniteQuery pages,
 *   not to the key).
 */
import type {
  IsoDate,
  IsoMonth,
  ListTransactionsQuery,
} from '@goldfinch/shared/types';

const root = ['goldfinch'] as const;

/**
 * Transaction list filters = the wire query minus the cursor, plus the P8-3
 * category filter. `categoryId` rides the same query string (the server
 * filters through GSI2); it is declared here additively until the shared
 * ListTransactionsQuery picks it up, at which point the intersection
 * collapses into the wire type with no call-site churn.
 */
export type TransactionListFilters = Omit<ListTransactionsQuery, 'cursor'> & {
  categoryId?: string;
};

/** Stable, serializable representation of transaction filters. */
function normalizeTransactionFilters(
  filters: TransactionListFilters,
): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {};
  const entries = Object.entries(filters) as Array<
    [string, string | number | boolean | undefined]
  >;
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    normalized[key] = value;
  }
  return normalized;
}

export const queryKeys = {
  root,

  accounts: {
    all: () => [...root, 'accounts'] as const,
    detail: (accountId: string) => [...root, 'accounts', accountId] as const,
  },

  transactions: {
    all: () => [...root, 'transactions'] as const,
    list: (filters: TransactionListFilters = {}) =>
      [...root, 'transactions', 'list', normalizeTransactionFilters(filters)] as const,
  },

  budgets: {
    /** Default current-period budgets (each windowed by its own cadence). */
    all: () => [...root, 'budgets'] as const,
    /**
     * Budgets windowed to an arbitrary inclusive [from,to] range (budget-range
     * feature). Cached independently of `all()` so a range view never clobbers
     * the default current-period query.
     */
    range: (from: IsoDate, to: IsoDate) =>
      [...root, 'budgets', 'range', from, to] as const,
  },

  categories: {
    all: () => [...root, 'categories'] as const,
  },

  cashflow: {
    /** Prefix for whole-domain invalidation of every cashflow range. */
    all: () => [...root, 'cashflow'] as const,
    /** Month-bucketed cash flow for an inclusive yyyy-mm range. */
    range: (from: IsoMonth, to: IsoMonth) =>
      [...root, 'cashflow', from, to] as const,
  },

  /** GET /summary -- the single net-worth/summary endpoint (decision D5). */
  summary: () => [...root, 'summary'] as const,

  /** GET /sync/status -- last bank-sync run + per-account outcomes. */
  syncStatus: () => [...root, 'sync', 'status'] as const,

  /** GET /profile -- the caller's own profile (server keys it by JWT sub). */
  profile: () => [...root, 'profile'] as const,

  // -------------------------------------------------------------------------
  // Phase 7 domains
  // -------------------------------------------------------------------------

  recurring: {
    /** GET /recurring (P7-1) -- single unpaginated list. */
    all: () => [...root, 'recurring'] as const,
  },

  goals: {
    /** GET /goals (P7-2) -- list carries server-computed progress. */
    all: () => [...root, 'goals'] as const,
  },

  holdings: {
    all: () => [...root, 'holdings'] as const,
    /** GET /accounts/{accountId}/holdings (P7-3). */
    byAccount: (accountId: string) => [...root, 'holdings', accountId] as const,
    /**
     * GET /accounts/{accountId}/holdings/{symbol}/price-history (Investments
     * chart). Each range window is cached independently by its `from` bound;
     * '' = server default ('to' defaults to today, 'from' to earliest snapshot).
     */
    priceHistory: (accountId: string, symbol: string, from?: IsoDate, to?: IsoDate) =>
      [...root, 'holdings', 'priceHistory', accountId, symbol, from ?? '', to ?? ''] as const,
  },

  netWorthHistory: {
    all: () => [...root, 'netWorthHistory'] as const,
    /** GET /networth/history (P7-4); '' = server default bound. */
    range: (from?: IsoDate, to?: IsoDate) =>
      [...root, 'netWorthHistory', from ?? '', to ?? ''] as const,
  },

  reports: {
    /** Prefix for invalidating every report after spend-shifting writes. */
    all: () => [...root, 'reports'] as const,
    /** GET /reports/trends?months=N (P7-4). undefined = server default. */
    trends: (months?: number) =>
      [...root, 'reports', 'trends', months ?? 0] as const,
    /** GET /reports/flow?month= (P7-4). */
    flow: (month: IsoMonth) => [...root, 'reports', 'flow', month] as const,
  },

  rules: {
    /** GET /rules (P7-5) -- full set, server-sorted by precedence. */
    all: () => [...root, 'rules'] as const,
  },

  attachments: {
    all: () => [...root, 'attachments'] as const,
    /** GET /transactions/{txnId}/attachments (P7-9). */
    byTxn: (txnId: string) => [...root, 'attachments', txnId] as const,
  },
} as const;
