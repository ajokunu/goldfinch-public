/**
 * Notification payload builders with payload hygiene enforced at the source.
 *
 * The Expo relay sees every payload, so titles/bodies carry ONLY non-sensitive
 * summary strings: counts, category names, percentages. Never account numbers,
 * balances, payees, or any currency amount. `assertPayloadHygiene` is the
 * programmatic guard (also exercised directly by unit tests) and every builder
 * runs its output through it.
 */

import type { ExpoPushMessage } from './expo.js';

/** A message minus its target token; the send fan-out fills in `to` per device. */
export type OutboundMessage = Omit<ExpoPushMessage, 'to'>;

export class PayloadHygieneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadHygieneError';
  }
}

/**
 * Deny-list patterns for relayed text:
 *  - currency symbols ($ € £ ¥)
 *  - decimal money amounts like 1,234.56 / 45.99
 *  - obvious account-detail words (balance, account number, payee)
 *  - long digit runs (account / card numbers)
 * Counts ("12 new transactions") and percentages ("85% of limit used") pass.
 */
const HYGIENE_PATTERNS: readonly RegExp[] = [
  /[$€£¥]/u,
  /\b\d{1,3}(?:,\d{3})*\.\d{2}\b/,
  /\bbalance\b/i,
  /\baccount\s*(?:number|#)\b/i,
  /\bpayee\b/i,
  /\d{6,}/,
];

function checkText(field: string, text: string): void {
  for (const pattern of HYGIENE_PATTERNS) {
    if (pattern.test(text)) {
      throw new PayloadHygieneError(
        `notification ${field} fails payload hygiene (${pattern}): "${text}"`,
      );
    }
  }
}

/** Throws PayloadHygieneError when a title/body would leak financial detail to the relay. */
export function assertPayloadHygiene(message: OutboundMessage): OutboundMessage {
  if (message.title !== undefined) checkText('title', message.title);
  if (message.body !== undefined) checkText('body', message.body);
  return message;
}

/** "Sync complete -- 12 new transactions". Caller must skip when newTxnCount <= 0. */
export function buildSyncCompleteMessage(newTxnCount: number): OutboundMessage {
  if (!Number.isSafeInteger(newTxnCount) || newTxnCount <= 0) {
    throw new RangeError(`newTxnCount must be a positive integer, got ${newTxnCount}`);
  }
  const noun = newTxnCount === 1 ? 'transaction' : 'transactions';
  return assertPayloadHygiene({
    title: 'Sync complete',
    body: `${newTxnCount} new ${noun}`,
    sound: undefined,
    priority: 'default',
    channelId: 'sync',
    data: { kind: 'sync' },
  });
}

/**
 * "Dining budget / 85% of limit used". Carries the categoryId in `data` so the
 * client can deep-link; never carries amounts.
 */
export function buildBudgetThresholdMessage(
  categoryName: string,
  categoryId: string,
  pctUsed: number,
): OutboundMessage {
  if (!Number.isSafeInteger(pctUsed) || pctUsed < 0) {
    throw new RangeError(`pctUsed must be a non-negative integer, got ${pctUsed}`);
  }
  return assertPayloadHygiene({
    title: `${categoryName} budget`,
    body: `${pctUsed}% of limit used`,
    priority: 'high',
    channelId: 'budget',
    data: { kind: 'budget', categoryId },
  });
}
