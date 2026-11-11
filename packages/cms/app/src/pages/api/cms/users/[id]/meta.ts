import type { Context } from 'hono';
import { hasPermission, PERMISSIONS } from '@cossackframework/cms';
import { apiError, writeAllowed, writeBody } from '../../../../../cms/content-api';
import { groupsView, metaInput, metaValues } from '../../../../../cms/content';
import { canManageUser } from '../../../../../services/rbac';
import { getUser } from '../../../../../services/users';
import type { PublicUser } from '../../../../../auth';

/**
 * Save a user's values of the field groups attached to users, as the user screen's meta boxes
 * send them: `{ "meta": { …control values } }`. Answers the stored values as control values,
 * or the fields' problems. For people who manage users and may change this account.
 */
export const POST = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    if (!hasPermission(c.get('principal'), PERMISSIONS.manageUsers)) return c.json({ error: 'Not allowed to change users.', code: 'CMS_FORBIDDEN' }, 403);
    const id = c.req.param('id') ?? '';
    const target = await getUser(id);
    if (!target || !canManageUser(c.get('user') as PublicUser | undefined, target)) return c.json({ error: 'This user does not exist.', code: 'CMS_NOT_FOUND' }, 404);
    const body = await writeBody(c);
    if (body instanceof Response) return body;
    const cms = c.get('cms');
    const { fields } = await groupsView(cms, { kind: 'users' });
    const converted = metaInput(fields, body.meta && typeof body.meta === 'object' ? body.meta as Record<string, unknown> : {});
    if (Object.keys(converted.errors).length) return c.json({ error: 'Some fields are invalid.', code: 'CMS_VALIDATION', fields: converted.errors }, 422);
    try {
        await cms.users.update(id, { meta: converted.meta }, { principal: c.get('principal') });
        return c.json({ values: metaValues(fields, (await cms.users.get(id))?.meta ?? {}) });
    } catch (error) { return apiError(c, error); }
};
