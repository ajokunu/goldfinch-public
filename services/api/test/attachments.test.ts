import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  AttachmentItem,
  CreateAttachmentResponse,
  ErrorEnvelope,
  GetAttachmentDownloadResponse,
  ListAttachmentsResponse,
  TxnPointerItem,
} from '@goldfinch/shared/types';
import { handler } from '../src/handler.js';
import { HOUSEHOLD, PK, SUB, makeEvent, parseBody, setTestEnv } from './helpers.js';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  setTestEnv();
  ddbMock.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const TXN_ID = 'txn-1';
const ATTACH_ID = 'a0000000-0000-4000-8000-000000000001';

function pointerItem(): TxnPointerItem {
  return {
    PK,
    SK: `TXNPTR#${TXN_ID}`,
    entityType: 'TXN_POINTER',
    schemaVersion: 1,
    simplefinTxnId: TXN_ID,
    currentSk: `TXN#2026-06-01#${TXN_ID}`,
  } as TxnPointerItem;
}

function attachmentItem(overrides: Partial<AttachmentItem> = {}): AttachmentItem {
  return {
    PK,
    SK: `ATTACH#${TXN_ID}#${ATTACH_ID}`,
    entityType: 'ATTACHMENT',
    schemaVersion: 1,
    txnId: TXN_ID,
    attachId: ATTACH_ID,
    fileName: 'receipt.pdf',
    contentType: 'application/pdf',
    sizeBytes: 12345,
    s3Key: `${HOUSEHOLD}/${TXN_ID}/${ATTACH_ID}`,
    status: 'pending',
    uploadedBy: SUB,
    createdAt: '2026-06-09T12:00:00.000Z',
    ...overrides,
  } as AttachmentItem;
}

describe('POST /transactions/{txnId}/attachments', () => {
  function createEvent(body: unknown) {
    return makeEvent({
      routeKey: 'POST /transactions/{txnId}/attachments',
      pathParameters: { txnId: TXN_ID },
      body,
    });
  }

  const GOOD_BODY = {
    fileName: 'receipt.pdf',
    contentType: 'application/pdf',
    sizeBytes: 12345,
  };

  it('writes pending metadata and returns a presigned PUT URL with signed type/length', async () => {
    ddbMock
      .on(GetCommand, { Key: { PK, SK: `TXNPTR#${TXN_ID}` } })
      .resolves({ Item: pointerItem() });
    ddbMock.on(PutCommand).resolves({});

    const res = await handler(createEvent(GOOD_BODY));
    expect(res.statusCode).toBe(201);
    const body = parseBody<CreateAttachmentResponse>(res);
    expect(body.item.status).toBe('pending');
    expect(body.item.txnId).toBe(TXN_ID);
    expect(body.item.uploadedBy).toBe(SUB);
    expect(body.expiresInSeconds).toBe(300);

    const url = new URL(body.uploadUrl);
    expect(url.hostname).toBe('goldfinch-attachments-test.s3.us-east-1.amazonaws.com');
    expect(url.pathname).toBe(`/${HOUSEHOLD}/${TXN_ID}/${body.item.attachId}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    // content-type and content-length are SIGNED into the URL.
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-type');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');

    const put = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    const item = put.Item as Record<string, unknown>;
    expect(item['s3Key']).toBe(`${HOUSEHOLD}/${TXN_ID}/${body.item.attachId}`);
    expect(put.ConditionExpression).toBe('attribute_not_exists(SK)');
  });

  it('404s when the transaction has no pointer', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(createEvent(GOOD_BODY));
    expect(res.statusCode).toBe(404);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it.each([
    [{ ...GOOD_BODY, contentType: 'image/gif' }],
    [{ ...GOOD_BODY, contentType: 'text/html' }],
    [{ ...GOOD_BODY, sizeBytes: 0 }],
    [{ ...GOOD_BODY, sizeBytes: 10 * 1024 * 1024 + 1 }],
    [{ ...GOOD_BODY, sizeBytes: 12.5 }],
    [{ contentType: 'application/pdf', sizeBytes: 1 }],
  ])('rejects disallowed content types and sizes with 400 (%#)', async (body) => {
    ddbMock.on(GetCommand).resolves({ Item: pointerItem() });
    const res = await handler(createEvent(body));
    expect(res.statusCode).toBe(400);
    expect(parseBody<ErrorEnvelope>(res).error.code).toBe('VALIDATION_ERROR');
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('accepts exactly the 10 MiB cap', async () => {
    ddbMock.on(GetCommand).resolves({ Item: pointerItem() });
    ddbMock.on(PutCommand).resolves({});
    const res = await handler(
      createEvent({ ...GOOD_BODY, sizeBytes: 10 * 1024 * 1024 }),
    );
    expect(res.statusCode).toBe(201);
  });
});

describe('GET /transactions/{txnId}/attachments', () => {
  it('lists attachments for the transaction in createdAt order', async () => {
    ddbMock.on(GetCommand).resolves({ Item: pointerItem() });
    ddbMock.on(QueryCommand).resolves({
      Items: [
        attachmentItem({
          SK: `ATTACH#${TXN_ID}#zzz`,
          attachId: 'zzz',
          createdAt: '2026-06-09T13:00:00.000Z',
        }),
        attachmentItem(),
      ],
    });
    const res = await handler(
      makeEvent({
        routeKey: 'GET /transactions/{txnId}/attachments',
        pathParameters: { txnId: TXN_ID },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = parseBody<ListAttachmentsResponse>(res);
    expect(body.items.map((a) => a.attachId)).toEqual([ATTACH_ID, 'zzz']);
    const query = ddbMock.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(query.ExpressionAttributeValues?.[':prefix']).toBe(`ATTACH#${TXN_ID}#`);
  });

  it('404s for an unknown transaction', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(
      makeEvent({
        routeKey: 'GET /transactions/{txnId}/attachments',
        pathParameters: { txnId: 'ghost' },
      }),
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /transactions/{txnId}/attachments/{attachId}', () => {
  const ROUTE = 'GET /transactions/{txnId}/attachments/{attachId}';

  it('returns a presigned GET URL for the stored object key', async () => {
    ddbMock
      .on(GetCommand, { Key: { PK, SK: `ATTACH#${TXN_ID}#${ATTACH_ID}` } })
      .resolves({ Item: attachmentItem() });
    const res = await handler(
      makeEvent({ routeKey: ROUTE, pathParameters: { txnId: TXN_ID, attachId: ATTACH_ID } }),
    );
    expect(res.statusCode).toBe(200);
    const body = parseBody<GetAttachmentDownloadResponse>(res);
    expect(body.attachId).toBe(ATTACH_ID);
    expect(body.expiresInSeconds).toBe(300);
    const url = new URL(body.downloadUrl);
    expect(url.pathname).toBe(`/${HOUSEHOLD}/${TXN_ID}/${ATTACH_ID}`);
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('404s for unknown attachment metadata', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const res = await handler(
      makeEvent({ routeKey: ROUTE, pathParameters: { txnId: TXN_ID, attachId: 'ghost' } }),
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /transactions/{txnId}/attachments/{attachId}', () => {
  const ROUTE = 'DELETE /transactions/{txnId}/attachments/{attachId}';

  function deleteEvent() {
    return makeEvent({
      routeKey: ROUTE,
      pathParameters: { txnId: TXN_ID, attachId: ATTACH_ID },
    });
  }

  it('deletes the S3 object first, then the metadata item, then 204s', async () => {
    ddbMock.on(GetCommand).resolves({ Item: attachmentItem() });
    ddbMock.on(DeleteCommand).resolves({});
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    const res = await handler(deleteEvent());
    expect(res.statusCode).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string }];
    expect(init.method).toBe('DELETE');
    expect(new URL(url).pathname).toBe(`/${HOUSEHOLD}/${TXN_ID}/${ATTACH_ID}`);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1);
  });

  it('keeps the metadata item when the S3 delete fails (and 500s loudly)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: attachmentItem() });
    ddbMock.on(DeleteCommand).resolves({});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    const res = await handler(deleteEvent());
    expect(res.statusCode).toBe(500);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it('404s for unknown attachment metadata without touching S3', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await handler(deleteEvent());
    expect(res.statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
