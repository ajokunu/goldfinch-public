/**
 * Opaque pagination cursor codec.
 *
 * A cursor is base64url(JSON.stringify(LastEvaluatedKey)) from a DynamoDB Query.
 * The client treats it as an opaque token; the server decodes it back into
 * ExclusiveStartKey. Done is signalled ONLY by the absence of a nextCursor.
 *
 * Malformed input throws CursorError, which route handlers map to
 * 400 BAD_CURSOR — never a 500.
 */

import { Buffer } from 'node:buffer';

export class CursorError extends Error {
  readonly code = 'BAD_CURSOR';

  constructor(message: string) {
    super(message);
    this.name = 'CursorError';
  }
}

/** Shape of a DynamoDB LastEvaluatedKey / ExclusiveStartKey (document-client form). */
export type DynamoKey = Record<string, unknown>;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Encode a LastEvaluatedKey into an opaque base64url cursor. */
export function encodeCursor(lastEvaluatedKey: DynamoKey): string {
  if (
    lastEvaluatedKey === null ||
    typeof lastEvaluatedKey !== 'object' ||
    Array.isArray(lastEvaluatedKey)
  ) {
    throw new CursorError('cursor source must be a plain key object');
  }
  return Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf8').toString('base64url');
}

/**
 * Decode an opaque cursor back into an ExclusiveStartKey.
 * Throws CursorError on anything that is not a well-formed cursor.
 */
export function decodeCursor(cursor: string): DynamoKey {
  if (typeof cursor !== 'string' || cursor.length === 0) {
    throw new CursorError('cursor must be a non-empty string');
  }
  if (cursor.length > 2048) {
    throw new CursorError('cursor is too long');
  }
  if (!BASE64URL_PATTERN.test(cursor)) {
    throw new CursorError('cursor is not valid base64url');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new CursorError('cursor does not decode to JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CursorError('cursor does not decode to a key object');
  }
  return parsed as DynamoKey;
}
