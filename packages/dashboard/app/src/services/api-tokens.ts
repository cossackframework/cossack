// Application passwords on the ORM: named tokens a user creates for apps and scripts. A token
// is `app_<id>.<secret>`; only the secret's SHA-256 is stored. A request with one acts as the
// user with their current roles; `read` tokens may only read.
import { ClientVisibleError } from '@cossackframework/core';
import { ApiToken as ApiTokenRow } from '@/models/ApiToken';
import { clock, randomToken, sha256Hex } from './security';

export type ApiTokenScope = 'read' | 'write';

export interface ApiToken {
  id: string;
  userId: string;
  name: string;
  scope: ApiTokenScope;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
}

const FORMAT = /^app_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;
/** Tokens a user can hold. */
export const API_TOKEN_LIMIT = 20;

function tokenOf(row: ApiTokenRow): ApiToken {
  return { id: row.id, userId: row.userId, name: row.name, scope: row.scope, createdAt: row.createdAt.getTime(),
    lastUsedAt: row.lastUsedAt?.getTime() ?? null, expiresAt: row.expiresAt?.getTime() ?? null };
}

/** Compare two hashes without stopping at the first difference. */
function sameHash(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function list(userId: string): Promise<ApiToken[]> {
  return (await ApiTokenRow.find({ where: { userId }, order: { createdAt: 'desc' }, take: 100 })).map(tokenOf);
}

/** A new token for the user. The returned `token` is shown once and cannot be read again. */
export async function create(userId: string, input: { name: string; scope?: ApiTokenScope; expiresAt?: number | null }): Promise<{ token: string; record: ApiToken }> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 80) throw new ClientVisibleError('Name the application password in 1-80 characters.');
  const scope = input.scope ?? 'write';
  if (scope !== 'read' && scope !== 'write') throw new ClientVisibleError('Access is read or write.');
  const now = clock.now();
  if (input.expiresAt !== undefined && input.expiresAt !== null && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now)) {
    throw new ClientVisibleError('The expiry must be in the future.');
  }
  if ((await ApiTokenRow.count({ userId })) >= API_TOKEN_LIMIT) throw new ClientVisibleError(`A user can have at most ${API_TOKEN_LIMIT} application passwords.`);
  const id = randomToken(12);
  const secret = randomToken(32);
  const expiresAt = input.expiresAt ?? null;
  await ApiTokenRow.insert({ id, userId, name, secretHash: await sha256Hex(secret), scope, createdAt: new Date(now), lastUsedAt: null,
    expiresAt: expiresAt === null ? null : new Date(expiresAt) });
  return { token: `app_${id}.${secret}`, record: { id, userId, name, scope, createdAt: now, lastUsedAt: null, expiresAt } };
}

/** False when the user has no such token. */
export async function revoke(userId: string, id: string): Promise<boolean> {
  return (await ApiTokenRow.delete({ id, userId })).meta.rowsAffected === 1;
}

export async function revokeAll(userId: string): Promise<void> {
  await ApiTokenRow.delete({ userId });
}

/** The token's owner and access, or null for an unknown, wrong or expired token. Use is recorded at most every five minutes. */
export async function verify(token: string): Promise<{ id: string; userId: string; scope: ApiTokenScope } | null> {
  const match = typeof token === 'string' ? FORMAT.exec(token) : null;
  if (!match) return null;
  const [, id, secret] = match;
  const row = await ApiTokenRow.findOne({ where: { id: id! } });
  if (!row || !sameHash(row.secretHash, await sha256Hex(secret!))) return null;
  const now = clock.now();
  if (row.expiresAt && row.expiresAt.getTime() <= now) return null;
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > 5 * 60_000) {
    await ApiTokenRow.update({ id: row.id }, { lastUsedAt: new Date(now) }).catch(() => undefined);
  }
  return { id: row.id, userId: row.userId, scope: row.scope };
}
