/**
 * @goldfinch/testing — shared test utilities for the GoldFinch workspaces.
 *
 * - factories: DynamoDB item factories built ONLY from the @goldfinch/shared
 *   key builders (key-compatible with the sync writer and API by construction)
 * - jwt: access-token claim fixtures (household=goldfinch-home) and API
 *   Gateway HTTP API v2 event factories
 * - simplefin: SimpleFIN wire-payload fixtures, including the canned two-day
 *   household scenario with a pending->posted date-bucket shift
 * - fake-table: stateful in-memory single-table fake (PK/SK + GSI1 + GSI2)
 * - expressions: the DynamoDB expression mini-evaluator behind the fake
 */

export * from './expressions.js';
export * from './factories.js';
export * from './fake-table.js';
export * from './jwt.js';
export * from './simplefin.js';
