/**
 * In-memory NotificationStore for unit and integration tests. Faithfully
 * reproduces the store behaviors the service logic depends on: conditional-put
 * semantics for SENTNOTIF# dedup markers, whole-item disable (not delete) for
 * dead tokens, and key-based deletes for ticket cleanup.
 */

import { pushTokenSk } from '@goldfinch/shared/keys';
import type {
  BudgetItem,
  CategoryItem,
  IsoMonth,
  PushTokenItem,
  TransactionItem,
  UserProfileItem,
} from '@goldfinch/shared/types';
import type { PushTicketSk } from '../keys.js';
import type { NotificationStore } from '../store.js';
import type { PushTicketItem, SentNotifItem } from '../types.js';

export interface MemoryStore extends NotificationStore {
  /** Mutable seed data; tests write directly. */
  readonly tokens: Map<string, PushTokenItem>;
  readonly tickets: Map<string, PushTicketItem>;
  readonly sentNotifs: Map<string, SentNotifItem>;
  budgets: BudgetItem[];
  categories: CategoryItem[];
  profiles: UserProfileItem[];
  /** Transactions keyed by month (yyyy-mm) for loadMonthTransactions. */
  readonly transactionsByMonth: Map<IsoMonth, TransactionItem[]>;
  /** Ordered log of mutating calls, for asserting disable/persist behavior. */
  readonly calls: string[];
}

export function createMemoryStore(): MemoryStore {
  const tokens = new Map<string, PushTokenItem>();
  const tickets = new Map<string, PushTicketItem>();
  const sentNotifs = new Map<string, SentNotifItem>();
  const transactionsByMonth = new Map<IsoMonth, TransactionItem[]>();
  const calls: string[] = [];

  const store: MemoryStore = {
    tokens,
    tickets,
    sentNotifs,
    budgets: [],
    categories: [],
    profiles: [],
    transactionsByMonth,
    calls,

    async loadPushTokens() {
      return [...tokens.values()];
    },
    async disablePushToken(token, disabledAt) {
      calls.push(`disablePushToken:${token.deviceId}`);
      tokens.set(pushTokenSk(token.deviceId), { ...token, disabledAt });
    },
    async putPushTickets(items) {
      for (const item of items) {
        calls.push(`putPushTicket:${item.SK}`);
        tickets.set(item.SK, item);
      }
    },
    async listPushTickets() {
      return [...tickets.values()];
    },
    async deletePushTicket(sk: PushTicketSk) {
      calls.push(`deletePushTicket:${sk}`);
      tickets.delete(sk);
    },
    async listSentNotifs(period) {
      return [...sentNotifs.values()].filter((item) => item.period === period);
    },
    async tryPutSentNotif(item) {
      if (sentNotifs.has(item.SK)) {
        calls.push(`tryPutSentNotif:exists:${item.SK}`);
        return false;
      }
      calls.push(`tryPutSentNotif:new:${item.SK}`);
      sentNotifs.set(item.SK, item);
      return true;
    },
    async loadBudgets() {
      return [...store.budgets];
    },
    async loadCategories() {
      return [...store.categories];
    },
    async loadProfiles() {
      return [...store.profiles];
    },
    async loadMonthTransactions(month) {
      return [...(transactionsByMonth.get(month) ?? [])];
    },
  };
  return store;
}
