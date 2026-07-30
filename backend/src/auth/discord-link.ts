import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getCluster } from '../cluster/index.js';
import type { DbAdapter } from '../db/adapter.js';
import { tx } from '../db/index.js';

const CODE_TTL_SEC = 5 * 60;
const LOCK_TTL_SEC = 15;
const FAIL_WINDOW_SEC = 15 * 60;
const FAIL_MAX = 10;
const CODE_PREFIX = 'DW';
const HASH_PREFIX = 'discordlink:v1:';
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const NORMALIZED_CODE_PATTERN = /^DW[0-9ABCDEFGHJKMNPQRSTVWXYZ]{20}$/;

const SQL_SELECT_USER_LINK = `SELECT id, discord_id FROM users WHERE id = ?`;
const SQL_SELECT_DISCORD_LINK = `SELECT id FROM users WHERE discord_id = ?`;
const SQL_CONDITIONAL_LINK_DISCORD = `UPDATE users SET discord_id = ?, updated_at = ? WHERE id = ? AND discord_id IS NULL`;

const StoredCodeSchema = z.object({
  v: z.literal(1),
  userId: z.string().min(1),
  issuedAt: z.number().int(),
  expiresAt: z.number().int(),
}).strict();

type StoredCode = z.infer<typeof StoredCodeSchema>;
type UserLinkRow = { readonly id: string; readonly discord_id: string | null };

export type DiscordLinkResult =
  | { readonly kind: 'linked'; readonly userId: string; readonly alreadyLinked?: true }
  | { readonly kind: 'error'; readonly status: 404 | 409 | 410 | 429; readonly code: DiscordLinkErrorCode };

export type DiscordLinkErrorCode =
  | 'discord-already-linked'
  | 'game-user-already-linked'
  | 'link-code-busy'
  | 'link-code-expired'
  | 'link-code-rate-limited'
  | 'user-not-found';

export type IssuedDiscordLinkCode = {
  readonly code: string;
  readonly expiresAt: number;
};

export function normalizeDiscordLinkCode(code: string): string {
  return code.replace(/[\s-]+/g, '').toUpperCase();
}

export function hashDiscordLinkCode(normalizedCode: string): string {
  return createHash('sha256').update(`${HASH_PREFIX}${normalizedCode}`).digest('hex');
}

export async function issueDiscordLinkCode(userId: string): Promise<IssuedDiscordLinkCode> {
  const code = generateDiscordLinkCode();
  const normalized = normalizeDiscordLinkCode(code);
  const codeHash = hashDiscordLinkCode(normalized);
  const now = Date.now();
  const expiresAt = now + CODE_TTL_SEC * 1000;
  const stored: StoredCode = { v: 1, userId, issuedAt: now, expiresAt };
  const cluster = await getCluster();
  await cluster.set(codeKey(codeHash), JSON.stringify(stored), CODE_TTL_SEC);
  return { code, expiresAt };
}

export async function consumeDiscordLinkCode(input: { readonly discordId: string; readonly code: string }): Promise<DiscordLinkResult> {
  const normalized = normalizeDiscordLinkCode(input.code);
  const codeHash = hashDiscordLinkCode(normalized);
  const cluster = await getCluster();
  const throttle = await checkFailureThrottle(input.discordId);
  if (!throttle.allowed) return { kind: 'error', status: 429, code: 'link-code-rate-limited' };
  if (!NORMALIZED_CODE_PATTERN.test(normalized)) {
    await recordFailure(input.discordId);
    return { kind: 'error', status: 410, code: 'link-code-expired' };
  }

  const lockKey = `discordlink:lock:${codeHash}`;
  const lockToken = await cluster.lock(lockKey, LOCK_TTL_SEC);
  if (lockToken === null) return { kind: 'error', status: 409, code: 'link-code-busy' };

  try {
    const key = codeKey(codeHash);
    const stored = await readStoredCode(key);
    if (stored === null) {
      await recordFailure(input.discordId);
      return { kind: 'error', status: 410, code: 'link-code-expired' };
    }

    const result = await linkStoredUser(input.discordId, stored.userId);
    if (result.kind === 'linked' || result.code !== 'user-not-found') await cluster.del(key);
    if (result.kind === 'error') await recordFailure(input.discordId);
    return result;
  } finally {
    await cluster.unlock(lockKey, lockToken);
  }
}

function generateDiscordLinkCode(): string {
  const bytes = randomBytes(13);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let payload = '';
  for (let index = 0; index < 20; index++) {
    const shift = BigInt((19 - index) * 5);
    const alphabetIndex = Number((value >> shift) & 31n);
    payload += CROCKFORD_ALPHABET[alphabetIndex] ?? '0';
  }
  return `${CODE_PREFIX}-${payload.slice(0, 4)}-${payload.slice(4, 8)}-${payload.slice(8, 12)}-${payload.slice(12, 16)}-${payload.slice(16, 20)}`;
}

function codeKey(codeHash: string): string {
  return `discordlink:code:${codeHash}`;
}

function failKey(discordId: string): string {
  return `discordlink:fail:discord:${discordId}`;
}

async function checkFailureThrottle(discordId: string): Promise<{ readonly allowed: boolean }> {
  const cluster = await getCluster();
  const raw = await cluster.get(failKey(discordId));
  const count = raw === null ? 0 : Number(raw);
  return { allowed: Number.isFinite(count) && count < FAIL_MAX };
}

async function recordFailure(discordId: string): Promise<void> {
  const cluster = await getCluster();
  const key = failKey(discordId);
  const raw = await cluster.get(key);
  const current = raw === null ? 0 : Number(raw);
  const next = Number.isFinite(current) ? current + 1 : 1;
  await cluster.set(key, String(next), FAIL_WINDOW_SEC);
}

async function readStoredCode(key: string): Promise<StoredCode | null> {
  const cluster = await getCluster();
  const raw = await cluster.get(key);
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    await cluster.del(key);
    return null;
  }
  const parsed = StoredCodeSchema.safeParse(value);
  if (!parsed.success || parsed.data.expiresAt < Date.now()) {
    await cluster.del(key);
    return null;
  }
  return parsed.data;
}

async function linkStoredUser(discordId: string, userId: string): Promise<DiscordLinkResult> {
  try {
    return await tx(async (t) => linkStoredUserInTx(t, discordId, userId));
  } catch (error) {
    if (isPgUniqueViolation(error)) return { kind: 'error', status: 409, code: 'discord-already-linked' };
    throw error;
  }
}

async function linkStoredUserInTx(t: DbAdapter, discordId: string, userId: string): Promise<DiscordLinkResult> {
  const user = await t.one<UserLinkRow>(SQL_SELECT_USER_LINK, [userId]);
  if (user === null) return { kind: 'error', status: 404, code: 'user-not-found' };

  if (user.discord_id === discordId) return { kind: 'linked', userId, alreadyLinked: true };
  if (user.discord_id !== null) return { kind: 'error', status: 409, code: 'game-user-already-linked' };

  const discordLink = await t.one<{ readonly id: string }>(SQL_SELECT_DISCORD_LINK, [discordId]);
  if (discordLink !== null) return { kind: 'error', status: 409, code: 'discord-already-linked' };

  const updated = await t.run(SQL_CONDITIONAL_LINK_DISCORD, [discordId, Date.now(), userId]);
  if (updated.changes === 1) return { kind: 'linked', userId };
  return { kind: 'error', status: 409, code: 'game-user-already-linked' };
}

function isPgUniqueViolation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === '23505' || error.code === 'SQLITE_CONSTRAINT_UNIQUE');
}
