/**
 * GET /accounts/{accountId}/holdings (P7-3).
 *
 * Holdings are written by the sync Lambda from the SimpleFIN beta `holdings`
 * array. `holdingsSupported` on the response is the explicit no-silent-blank
 * signal: false means the institution does not provide holdings via
 * SimpleFIN, and the UI must render that state. When the account item has
 * not recorded the flag yet (pre-Phase-7 sync), the presence of holdings
 * rows is used as the fallback signal.
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { acctSk, holdingPrefix, userPk } from '@goldfinch/shared/keys';
import type { AccountItem, HoldingItem, ListHoldingsResponse } from '@goldfinch/shared/types';
import { getIdentity } from '../context.js';
import { ddb, queryAll } from '../ddb.js';
import { getEnv } from '../env.js';
import { ApiError, json, requirePathParam } from '../http.js';
import { toHoldingDto } from '../mapping.js';

export async function listAccountHoldings(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const accountId = requirePathParam(event, 'accountId');
  const pk = userPk(household);

  const accountRes = await ddb.send(
    new GetCommand({ TableName: env.tableName, Key: { PK: pk, SK: acctSk(accountId) } }),
  );
  const account = accountRes.Item as AccountItem | undefined;
  if (account === undefined) {
    throw new ApiError(404, 'NOT_FOUND', `account "${accountId}" not found`);
  }

  const holdings = await queryAll<HoldingItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk, ':prefix': holdingPrefix(accountId) },
  });
  const items = holdings
    .filter((item) => item.entityType === 'HOLDING')
    .sort((a, b) => (a.holdingId < b.holdingId ? -1 : a.holdingId > b.holdingId ? 1 : 0));

  const body: ListHoldingsResponse = {
    items: items.map(toHoldingDto),
    holdingsSupported: account.holdingsSupported ?? items.length > 0,
  };
  return json(200, body);
}
