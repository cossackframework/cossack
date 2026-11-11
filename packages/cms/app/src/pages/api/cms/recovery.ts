import type { Context } from 'hono';
import { recoverAccount, RecoveryError } from '../../../cms/recovery';
import { cappedRequest } from '../../../cms/content-api';

/** `{ email, secondFactors }` is a few hundred bytes. */
const RECOVERY_MAX_BYTES = 4 * 1024;

/**
 * Recovery mode, for `cossack cms password reset`: `POST /api/cms/recovery` with
 * `Authorization: Bearer <CMS_RECOVERY_CODE>` and `{ email, secondFactors? }` answers
 * `{ email, resetUrl, expiresAt, secondFactorsCleared }`. Off (403) while the environment has no
 * CMS_RECOVERY_CODE. `X-Cossack-Site` names a site of the network.
 */
export const POST = async (c: Context) => {
    const authorization = c.req.header('authorization') ?? '';
    const code = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
    let body: { email?: unknown; secondFactors?: unknown } = {};
    const request = await cappedRequest(c, RECOVERY_MAX_BYTES);
    if (!request) return c.json({ error: 'The request body is too large.', code: 'CMS_LIMIT' }, 413);
    try { body = await request.json(); } catch { return c.json({ error: 'Send a JSON body: { "email": "…" }.', code: 'CMS_VALIDATION' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Send a JSON body: { "email": "…" }.', code: 'CMS_VALIDATION' }, 400);
    try {
        const result = await recoverAccount(c, { code, email: body.email, secondFactors: body.secondFactors });
        return c.json(result, 200, { 'cache-control': 'no-store' });
    } catch (error) {
        if (error instanceof RecoveryError) return c.json({ error: error.message, code: error.code }, error.status, { 'cache-control': 'no-store' });
        throw error;
    }
};
