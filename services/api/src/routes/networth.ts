/**
 * GET /networth/history?from&to (P7-4, un-defers D5).
 *
 * Reads the daily NETWORTH#<yyyy-mm-dd> snapshot items written by sync.
 * Defaults: to = today (DEFAULT_TZ calendar), from = the earliest snapshot.
 * History accrues from first deploy — `firstSnapshotDate` is null until the
 * first snapshot exists and the chart must state its start date. Per P7-7
 * each snapshot carries per-currency slices; the top-level totals are the
 * base-currency slice, never a synthetic mixed-currency sum.
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  KEY_PREFIX,
  netWorthDateRangeBounds,
  userPk,
} from '@goldfinch/shared/keys';
import type {
  IsoDate,
  NetWorthHistoryResponse,
  NetWorthSnapshotItem,
} from '@goldfinch/shared/types';
import { getIdentity } from '../context.js';
import { ddb, queryAll } from '../ddb.js';
import { todayInTz } from '../dates.js';
import { getEnv } from '../env.js';
import { ApiError, json } from '../http.js';
import { toNetWorthSnapshotDto } from '../mapping.js';
import { requireIsoDate } from '../validate.js';

export async function netWorthHistory(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const qs = event.queryStringParameters ?? {};
  const pk = userPk(household);

  const to: IsoDate =
    qs['to'] !== undefined ? requireIsoDate(qs['to'], 'to') : todayInTz(env.defaultTz);

  // The earliest snapshot is both the `from` default and firstSnapshotDate.
  const firstRes = await ddb.send(
    new QueryCommand({
      TableName: env.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': pk, ':prefix': KEY_PREFIX.netWorth },
      ScanIndexForward: true,
      Limit: 1,
    }),
  );
  const firstItem = (firstRes.Items ?? [])[0] as NetWorthSnapshotItem | undefined;
  const firstSnapshotDate = firstItem?.date ?? null;

  if (firstSnapshotDate === null) {
    const empty: NetWorthHistoryResponse = { items: [], firstSnapshotDate: null };
    return json(200, empty);
  }

  const from: IsoDate =
    qs['from'] !== undefined ? requireIsoDate(qs['from'], 'from') : firstSnapshotDate;
  if (from > to) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'from must not be after to');
  }

  // One snapshot per calendar day — bounded, so the queryAll drain is safe.
  const bounds = netWorthDateRangeBounds(from, to);
  const snapshots = await queryAll<NetWorthSnapshotItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
    ExpressionAttributeValues: { ':pk': pk, ':start': bounds.start, ':end': bounds.end },
  });

  const body: NetWorthHistoryResponse = {
    items: snapshots
      .filter((item) => item.entityType === 'NETWORTH_SNAPSHOT')
      .map(toNetWorthSnapshotDto),
    firstSnapshotDate,
  };
  return json(200, body);
}
