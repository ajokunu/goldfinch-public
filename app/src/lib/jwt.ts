/**
 * Minimal unverified JWT payload decoding, used only to read `exp` for silent
 * refresh scheduling. Verification happens server-side at the API Gateway JWT
 * authorizer; the client never trusts claims for authorization decisions.
 */

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Pure-JS base64 decode (no atob/Buffer dependency on any platform). */
function base64Decode(input: string): string {
  const str = input.replace(/=+$/, '');
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const char of str) {
    const value = B64_ALPHABET.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

function base64UrlToUtf8(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = base64Decode(b64);
  // Binary string -> UTF-8 string without TextDecoder.
  let percentEncoded = '';
  for (let i = 0; i < binary.length; i += 1) {
    percentEncoded += `%${binary.charCodeAt(i).toString(16).padStart(2, '0')}`;
  }
  try {
    return decodeURIComponent(percentEncoded);
  } catch {
    return binary;
  }
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  const payload = parts[1];
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(base64UrlToUtf8(payload));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Seconds until the token's `exp`; negative when expired; null when unreadable. */
export function jwtSecondsRemaining(token: string, now = Date.now()): number | null {
  const payload = decodeJwtPayload(token);
  const exp = payload?.['exp'];
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  return exp - Math.floor(now / 1000);
}
