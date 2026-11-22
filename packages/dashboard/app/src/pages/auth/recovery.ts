import type { Context } from 'hono';
import { recoverAccount } from '#app/auth';

/**
 * Recovery mode: `POST /auth/recovery` with `Authorization: Bearer <RECOVERY_CODE>` and
 * `{ "email": "…", "secondFactors"?: true }` answers `{ email, resetUrl, expiresAt,
 * secondFactorsCleared }`. Off (403) while the environment has no RECOVERY_CODE.
 */
export const POST = async (c: Context) => {
    const code = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '')?.[1]?.trim();
    const length = Number(c.req.header('content-length') ?? '0');
    if (length > 4096) return c.json({ error: 'The request body is too large.' }, 413);
    let body: { email?: unknown; secondFactors?: unknown };
    try { body = await c.req.json(); } catch { return c.json({ error: 'Send a JSON body: { "email": "…" }.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Send a JSON body: { "email": "…" }.' }, 400);
    const result = await recoverAccount(code, body.email, body.secondFactors === true);
    return 'error' in result
        ? c.json({ error: result.error }, result.status, { 'cache-control': 'no-store' })
        : c.json(result, 200, { 'cache-control': 'no-store' });
};
