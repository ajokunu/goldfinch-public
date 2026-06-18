/**
 * POST/GET /transactions/{txnId}/attachments,
 * GET/DELETE /transactions/{txnId}/attachments/{attachId} (P7-9).
 *
 * Bytes never flow through the Lambda: POST validates (content-type
 * allowlist, ATTACHMENT_MAX_BYTES cap), writes the ATTACH# metadata item, and
 * returns a presigned PUT URL whose content-type and content-length are
 * SIGNED (the client cannot upload anything else without invalidating the
 * signature). GET returns a presigned download URL. DELETE removes the S3
 * object FIRST and the metadata item only after that succeeds, so metadata
 * can never claim an object is gone while it still exists.
 *
 * The transaction is located through its TXNPTR#<txnId> pointer (sync and
 * import rows both have one), so the route needs no date path component.
 */

import { randomUUID } from 'node:crypto';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  ATTACHMENT_ALLOWED_CONTENT_TYPES,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_PRESIGN_TTL_SECONDS,
  SCHEMA_VERSION,
  type AttachmentContentType,
} from '@goldfinch/shared/constants';
import { attachPrefix, attachSk, txnPointerSk, userPk } from '@goldfinch/shared/keys';
import type {
  AttachmentItem,
  CreateAttachmentResponse,
  GetAttachmentDownloadResponse,
  ListAttachmentsResponse,
  TxnPointerItem,
} from '@goldfinch/shared/types';
import { getIdentity } from '../context.js';
import { ddb, isConditionalCheckFailure, queryAll } from '../ddb.js';
import { nowIso } from '../dates.js';
import { type ApiEnv, getEnv } from '../env.js';
import { ApiError, json, noContent, parseJsonBody, requirePathParam } from '../http.js';
import { toAttachmentDto } from '../mapping.js';
import {
  deleteAttachmentObject,
  getAttachmentsS3Config,
  presignAttachmentUrl,
} from '../s3.js';
import { reqString } from '../validate.js';

/** 404 unless a TXNPTR#<txnId> pointer proves the transaction exists. */
async function requireTxnPointer(
  env: ApiEnv,
  household: string,
  txnId: string,
): Promise<TxnPointerItem> {
  const res = await ddb.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { PK: userPk(household), SK: txnPointerSk(txnId) },
    }),
  );
  const pointer = res.Item as TxnPointerItem | undefined;
  if (pointer === undefined) {
    throw new ApiError(404, 'NOT_FOUND', `transaction "${txnId}" not found`);
  }
  return pointer;
}

function requireContentType(value: unknown): AttachmentContentType {
  if (
    typeof value !== 'string' ||
    !ATTACHMENT_ALLOWED_CONTENT_TYPES.includes(value as AttachmentContentType)
  ) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `contentType must be one of: ${ATTACHMENT_ALLOWED_CONTENT_TYPES.join(', ')}`,
    );
  }
  return value as AttachmentContentType;
}

function requireSizeBytes(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'sizeBytes must be a positive integer');
  }
  const size = value as number;
  if (size > ATTACHMENT_MAX_BYTES) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      `sizeBytes must not exceed ${ATTACHMENT_MAX_BYTES} (10 MiB)`,
    );
  }
  return size;
}

export async function createAttachment(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household, sub } = getIdentity(event);
  const env = getEnv();
  const s3Config = getAttachmentsS3Config();
  const txnId = requirePathParam(event, 'txnId');
  const body = parseJsonBody(event);

  const fileName = reqString(body, 'fileName');
  const contentType = requireContentType(body['contentType']);
  const sizeBytes = requireSizeBytes(body['sizeBytes']);
  await requireTxnPointer(env, household, txnId);

  const attachId = randomUUID();
  // Object keys live under the household prefix; the Lambda's S3 grant is
  // scoped to exactly that prefix.
  const s3Key = `${household}/${txnId}/${attachId}`;
  const item: AttachmentItem = {
    PK: userPk(household),
    SK: attachSk(txnId, attachId),
    entityType: 'ATTACHMENT',
    schemaVersion: SCHEMA_VERSION,
    txnId,
    attachId,
    fileName,
    contentType,
    sizeBytes,
    s3Key,
    status: 'pending',
    uploadedBy: sub,
    createdAt: nowIso(),
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: env.tableName,
        Item: { ...item },
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailure(err)) {
      throw new ApiError(409, 'ALREADY_EXISTS', `attachment "${attachId}" already exists`);
    }
    throw err;
  }

  const uploadUrl = await presignAttachmentUrl(s3Config, {
    method: 'PUT',
    key: s3Key,
    contentType,
    contentLength: sizeBytes,
  });

  const responseBody: CreateAttachmentResponse = {
    item: toAttachmentDto(item),
    uploadUrl,
    expiresInSeconds: ATTACHMENT_PRESIGN_TTL_SECONDS,
  };
  return json(201, responseBody);
}

export async function listAttachments(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const txnId = requirePathParam(event, 'txnId');
  await requireTxnPointer(env, household, txnId);

  const items = await queryAll<AttachmentItem>({
    TableName: env.tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': userPk(household),
      ':prefix': attachPrefix(txnId),
    },
  });
  const attachments = items
    .filter((item) => item.entityType === 'ATTACHMENT')
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.attachId.localeCompare(b.attachId),
    );

  const body: ListAttachmentsResponse = { items: attachments.map(toAttachmentDto) };
  return json(200, body);
}

async function getAttachmentItem(
  env: ApiEnv,
  household: string,
  txnId: string,
  attachId: string,
): Promise<AttachmentItem> {
  const res = await ddb.send(
    new GetCommand({
      TableName: env.tableName,
      Key: { PK: userPk(household), SK: attachSk(txnId, attachId) },
    }),
  );
  const item = res.Item as AttachmentItem | undefined;
  if (item === undefined || item.entityType !== 'ATTACHMENT') {
    throw new ApiError(404, 'NOT_FOUND', `attachment "${attachId}" not found`);
  }
  return item;
}

export async function getAttachmentDownload(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const s3Config = getAttachmentsS3Config();
  const txnId = requirePathParam(event, 'txnId');
  const attachId = requirePathParam(event, 'attachId');

  const item = await getAttachmentItem(env, household, txnId, attachId);
  const downloadUrl = await presignAttachmentUrl(s3Config, {
    method: 'GET',
    key: item.s3Key,
  });

  const body: GetAttachmentDownloadResponse = {
    attachId,
    downloadUrl,
    expiresInSeconds: ATTACHMENT_PRESIGN_TTL_SECONDS,
  };
  return json(200, body);
}

export async function deleteAttachment(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { household } = getIdentity(event);
  const env = getEnv();
  const s3Config = getAttachmentsS3Config();
  const txnId = requirePathParam(event, 'txnId');
  const attachId = requirePathParam(event, 'attachId');

  const item = await getAttachmentItem(env, household, txnId, attachId);
  // Object first; deleteAttachmentObject throws (and logs) on any non-2xx, so
  // the metadata row survives whenever the object might still exist.
  await deleteAttachmentObject(s3Config, item.s3Key);
  await ddb.send(
    new DeleteCommand({
      TableName: env.tableName,
      Key: { PK: userPk(household), SK: attachSk(txnId, attachId) },
    }),
  );
  return noContent();
}
