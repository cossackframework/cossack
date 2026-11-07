import type { Context } from 'hono';
import { writeAllowed, writeBody } from '../../../../cms/content-api';

/** The block types a user inserted last, newest first, kept in their meta as `_recent_blocks`. */
const KEY = '_recent_blocks';
const MOST = 6;

function recent(meta: { readonly [field: string]: unknown } | undefined): string[] {
    const value = meta?.[KEY];
    return Array.isArray(value) ? value.filter((type): type is string => typeof type === 'string').slice(0, MOST) : [];
}

/** The signed-in user's recent block types, for the block inserter's Recent section. */
export const GET = async (c: Context) => {
    const principal = c.get('principal');
    if (principal?.kind !== 'user') return c.json({ types: [] });
    const user = await c.get('cms').users.get(principal.id);
    return c.json({ types: recent(user?.meta) }, 200, { 'cache-control': 'private, no-store' });
};

/** Remember a block type the user just inserted: `{ "type": "core/heading" }`. */
export const POST = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const body = await writeBody(c);
    if (body instanceof Response) return body;
    const cms = c.get('cms');
    const type = typeof body.type === 'string' ? body.type : '';
    if (!cms.blockTypes.has(type)) return c.json({ error: 'Not a block type.', code: 'CMS_VALIDATION' }, 422);
    const principal = c.get('principal');
    if (principal.kind !== 'user') return c.json({ error: 'Sign in first.', code: 'CMS_UNAUTHENTICATED' }, 401);
    const id = principal.id;
    const user = await cms.users.get(id);
    const types = [type, ...recent(user?.meta).filter(entry => entry !== type)].slice(0, MOST);
    await cms.users.setSystemMeta(id, KEY, types);
    return c.json({ types });
};
