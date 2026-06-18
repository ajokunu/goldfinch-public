/**
 * GET /recurring, PATCH /recurring/{seriesId} (P7-1).
 *
 * Series are detected and upserted by the daily sync Lambda; this API only
 * lists them and records the user review action (confirm/ignore) — the
 * detector conditionally preserves a user-set status, so PATCH here is the
 * single writer of 'confirmed'/'ignored'.
 */

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { KEY_PREFIX, recurringSk, userPk } from '@goldfinch/shared/keys';
import type {
  ListRecurringResponse,
  PatchRecurringResponse,
  RecurringSeriesItem,
} from '@goldfinch/shared/types';
import { getIdentity } from '../context.js';
import { ddb, isConditionalCheckFailure, queryAll } from '../ddb.js';
import { nowIso } from '../dates.js';
import { getEnv } from '../env.js';
import { ApiError, json, parseJsonBody, requirePathParam } from '../http.js';
import { toRecurringDto } from '../mapping.js';

export async function listRecurring(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const items = await queryAll<RecurringSeriesItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': userPk(household),
      ':prefix': KEY_PREFIX.recurring,
    },
  });
  const series = items
    .filter((item) => item.entityType === 'RECURRING_SERIES')
    .sort((a, b) =>
      a.nextExpectedDate < b.nextExpectedDate
        ? -1
        : a.nextExpectedDate > b.nextExpectedDate
          ? 1
          : a.seriesId.localeCompare(b.seriesId),
    );
  const body: ListRecurringResponse = { items: series.map(toRecurringDto) };
  return json(200, body);
}

export async function patchRecurring(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const seriesId = requirePathParam(event, 'seriesId');
  const body = parseJsonBody(event);
  const status = body['status'];
  if (status !== 'confirmed' && status !== 'ignored') {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'status must be "confirmed" or "ignored"',
    );
  }

  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: env.tableName,
        Key: { PK: userPk(household), SK: recurringSk(seriesId) },
        UpdateExpression: 'SET #status = :status, #updatedAt = :now',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: { ':status': status, ':now': nowIso() },
        ReturnValues: 'ALL_NEW',
      }),
    );
    const item = res.Attributes as RecurringSeriesItem;
    const responseBody: PatchRecurringResponse = { item: toRecurringDto(item) };
    return json(200, responseBody);
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      throw new ApiError(404, 'NOT_FOUND', `recurring series "${seriesId}" not found`);
    }
    throw err;
  }
}
