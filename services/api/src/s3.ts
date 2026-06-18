/**
 * Attachments S3 access (P7-9): SigV4 presigned PUT/GET/DELETE URLs for the
 * private attachments bucket, built directly on @smithy/signature-v4 (the
 * same signer the AWS SDK uses) so the Lambda bundle stays free of the full
 * S3 client.
 *
 * Enforcement at presign time (the bucket is BLOCK_ALL, SSE-S3):
 * - contentType is validated by the route against ATTACHMENT_ALLOWED_CONTENT_TYPES
 *   and SIGNED into the PUT URL (content-type header), so the client cannot
 *   upload under a different type without invalidating the signature.
 * - content-length is signed likewise, capping the object at the validated
 *   sizeBytes (<= ATTACHMENT_MAX_BYTES).
 * - x-amz-content-sha256 is UNSIGNED-PAYLOAD (standard for S3 presigned URLs).
 *
 * Deletes are performed server-side: a short-lived presigned DELETE URL is
 * generated and invoked with fetch; failures are logged and rethrown (the
 * metadata item is only removed after the object delete succeeds).
 */

import { createHash, createHmac, type Hash, type Hmac } from 'node:crypto';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { SignatureV4 } from '@smithy/signature-v4';
import type {
  AwsCredentialIdentity,
  ChecksumConstructor,
  HttpRequest,
  Provider,
  QueryParameterBag,
} from '@smithy/types';
import { ATTACHMENT_PRESIGN_TTL_SECONDS } from '@goldfinch/shared/constants';
import { logger } from './logger.js';

/** node:crypto-backed SHA-256 / HMAC-SHA-256 for @smithy/signature-v4. */
class NodeSha256 {
  private hash: Hash | Hmac;
  private readonly secret: string | Uint8Array | undefined;

  constructor(secret?: string | ArrayBuffer | ArrayBufferView) {
    this.secret = normalizeSecret(secret);
    this.hash = this.create();
  }

  private create(): Hash | Hmac {
    return this.secret === undefined
      ? createHash('sha256')
      : createHmac('sha256', this.secret);
  }

  update(toHash: string | ArrayBuffer | ArrayBufferView): void {
    const data = normalizeSecret(toHash);
    if (data !== undefined) {
      this.hash.update(data);
    }
  }

  reset(): void {
    this.hash = this.create();
  }

  digest(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(this.hash.digest()));
  }
}

function normalizeSecret(
  value: string | ArrayBuffer | ArrayBufferView | undefined,
): string | Uint8Array | undefined {
  if (value === undefined || typeof value === 'string') {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value);
}

export interface AttachmentsS3Config {
  bucket: string;
  region: string;
}

/**
 * Read at request time like getEnv. ATTACHMENTS_BUCKET missing is a deployment
 * error and surfaces as a 500 (logged), never a silent fallback.
 */
export function getAttachmentsS3Config(): AttachmentsS3Config {
  const bucket = process.env.ATTACHMENTS_BUCKET;
  if (bucket === undefined || bucket.length === 0) {
    throw new Error('ATTACHMENTS_BUCKET environment variable is not set');
  }
  return { bucket, region: process.env.AWS_REGION ?? 'us-east-1' };
}

export type PresignMethod = 'PUT' | 'GET' | 'DELETE';

export interface PresignAttachmentOptions {
  method: PresignMethod;
  /** Full object key, e.g. `<household>/<txnId>/<attachId>`. */
  key: string;
  /** Signed into PUT URLs so the upload content type cannot diverge. */
  contentType?: string;
  /** Signed into PUT URLs so the upload size cannot exceed the validated value. */
  contentLength?: number;
  /** Defaults to ATTACHMENT_PRESIGN_TTL_SECONDS. */
  expiresInSeconds?: number;
}

/** Test seams: fixed credentials/clock make signatures deterministic. */
export interface PresignDeps {
  credentials?: AwsCredentialIdentity | Provider<AwsCredentialIdentity>;
  signingDate?: Date;
}

// Module-scope provider chain (warm-invocation reuse); overridable per call.
let defaultCredentials: Provider<AwsCredentialIdentity> | undefined;

function credentialProvider(): Provider<AwsCredentialIdentity> {
  defaultCredentials ??= defaultProvider();
  return defaultCredentials;
}

/** RFC 3986 encoding (S3 canonical form) of one path segment. */
function encodeRfc3986(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Encode an object key as an already-escaped S3 path ('/' preserved). */
export function encodeS3KeyPath(key: string): string {
  return `/${key.split('/').map(encodeRfc3986).join('/')}`;
}

function serializeQuery(query: QueryParameterBag): string {
  const parts: string[] = [];
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value === null || value === undefined) {
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      parts.push(`${encodeRfc3986(key)}=${encodeRfc3986(entry)}`);
    }
  }
  return parts.join('&');
}

/**
 * Build a presigned virtual-hosted-style S3 URL for the attachments bucket.
 * uriEscapePath is false (S3 signing rule: the path is signed as sent), so
 * the key is escaped here exactly once.
 */
export async function presignAttachmentUrl(
  config: AttachmentsS3Config,
  options: PresignAttachmentOptions,
  deps: PresignDeps = {},
): Promise<string> {
  const hostname = `${config.bucket}.s3.${config.region}.amazonaws.com`;
  const headers: Record<string, string> = {
    host: hostname,
    'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
  };
  if (options.method === 'PUT') {
    if (options.contentType === undefined || options.contentLength === undefined) {
      throw new Error('presigned PUT requires contentType and contentLength');
    }
    headers['content-type'] = options.contentType;
    headers['content-length'] = String(options.contentLength);
  }
  const request: HttpRequest = {
    method: options.method,
    protocol: 'https:',
    hostname,
    port: undefined,
    path: encodeS3KeyPath(options.key),
    query: {},
    headers,
    // Body is never signed: x-amz-content-sha256 pins UNSIGNED-PAYLOAD.
    body: undefined,
    username: undefined,
    password: undefined,
    fragment: undefined,
  };
  const signer = new SignatureV4({
    service: 's3',
    region: config.region,
    credentials: deps.credentials ?? credentialProvider(),
    sha256: NodeSha256 as ChecksumConstructor,
    applyChecksum: false,
    uriEscapePath: false,
  });
  const signed = await signer.presign(request, {
    expiresIn: options.expiresInSeconds ?? ATTACHMENT_PRESIGN_TTL_SECONDS,
    ...(deps.signingDate !== undefined ? { signingDate: deps.signingDate } : {}),
  });
  return `https://${hostname}${signed.path}?${serializeQuery(signed.query ?? {})}`;
}

export type FetchLike = (
  url: string,
  init: { method: string },
) => Promise<{ ok: boolean; status: number }>;

/**
 * Delete one attachment object. S3 DELETE is idempotent (204 even when the
 * key is absent); any non-2xx response is logged with context and thrown so
 * the caller never removes metadata for an object that still exists.
 */
export async function deleteAttachmentObject(
  config: AttachmentsS3Config,
  key: string,
  deps: PresignDeps & { fetchImpl?: FetchLike } = {},
): Promise<void> {
  const url = await presignAttachmentUrl(
    config,
    { method: 'DELETE', key, expiresInSeconds: 60 },
    deps,
  );
  const fetchImpl: FetchLike = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  let response: { ok: boolean; status: number };
  try {
    response = await fetchImpl(url, { method: 'DELETE' });
  } catch (err) {
    logger.error('attachments object delete request failed', { key, err });
    throw err;
  }
  if (!response.ok) {
    const error = new Error(
      `attachments object delete returned HTTP ${response.status}`,
    );
    logger.error('attachments object delete rejected', {
      key,
      status: response.status,
    });
    throw error;
  }
}
