/**
 * @goldfinch/shared — contracts shared by every Lambda and (types only) the client.
 *
 * Subpath imports are also available:
 *   @goldfinch/shared/types      entity types + API DTOs + error envelope
 *   @goldfinch/shared/keys       DynamoDB key builders
 *   @goldfinch/shared/money      minor-units + decimal-string helpers
 *   @goldfinch/shared/simplefin  SimpleFIN Bridge client + normalizer
 *   @goldfinch/shared/cursor     opaque pagination cursor codec
 *   @goldfinch/shared/constants  locked contract constants + route keys
 *   @goldfinch/shared/dates      time-zone calendar-day helpers
 *   @goldfinch/shared/recurrence recurring-series detection (P7-1)
 *   @goldfinch/shared/rules      rule matcher, exact>prefix>contains (P7-5)
 *   @goldfinch/shared/budgetMath budget percent, floor semantics (P7-8)
 *   @goldfinch/shared/csv        CSV row normalization + dedup hashing (P7-6)
 *   @goldfinch/shared/logger     structured JSON logger + EMF metrics (P7-10)
 *   @goldfinch/shared/accountTypes account-type metadata + effective-value
 *                                precedence helpers (P8-4)
 *   @goldfinch/shared/categoryStyle category color-key + glyph-key contract +
 *                                color precedence helper (P10-1/P10-2/P10-4)
 *   @goldfinch/shared/periodWindow current weekly/monthly/yearly budget window
 *                                in DEFAULT_TZ (P11-2)
 *   @goldfinch/shared/push       Expo push-token format guard (P7-8)
 */

export * from './types/index.js';
export * from './keys.js';
export * from './dates.js';
export * from './money.js';
export * from './cursor.js';
export * from './simplefin.js';
export * from './constants.js';
export * from './recurrence.js';
export * from './rules.js';
export * from './budgetMath.js';
export * from './csv.js';
export * from './logger.js';
export * from './accountTypes.js';
export * from './categoryStyle.js';
export * from './profile.js';
export * from './periodWindow.js';
export * from './push.js';
