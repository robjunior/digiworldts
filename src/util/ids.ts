/**
 * Small ID helpers. Two flavors:
 *  - `newId(prefix)`   → URL-safe random ID, e.g. `usr_9k2m4p...` (26 chars body).
 *  - `newSessionToken()` → cryptographically secure 32-byte token, hex-encoded.
 *
 * We use crockford-ish base32 (no I/L/O/U) so IDs are human-readable and
 * cannot form confusing words. Not zero-copy magical — just readable.
 */
import { randomBytes, randomUUID } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // base32, no i/l/o/u
const ALPHABET_LEN = ALPHABET.length;

/** 130-bit random ID with a 2-4 char prefix (e.g. 'usr', 'ses', 'mtc'). */
export function newId(prefix: string): string {
  const bytes = randomBytes(16);
  let out = '';
  for (const b of bytes) {
    out += ALPHABET[b % ALPHABET_LEN];
    out += ALPHABET[(b >> 3) % ALPHABET_LEN];
  }
  return `${prefix}_${out.slice(0, 26)}`;
}

/** Session tokens: 32 random bytes hex-encoded. Never derived from user data. */
export function newSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** UUID v4 helper for the rare places we want a stdlib format (external APIs, etc). */
export function newUuid(): string {
  return randomUUID();
}
