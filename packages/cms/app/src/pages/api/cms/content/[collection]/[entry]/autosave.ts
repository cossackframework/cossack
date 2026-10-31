import type { Context } from 'hono';
import { isCmsError } from '@cossackframework/cms';
import { routeResource } from '../../../../../../cms/content';
import { writeAllowed, writeBody } from '../../../../../../cms/content-api';

/**
 * The editor's autosave: `POST /api/cms/content/<collection>/<id>/autosave` stores the signed-in
 * user's unsaved form values for an entry (`new` before its first save) and answers `{ at }`.
 * A plain request, apart from the page's server methods, so the editor's state is not re-applied
 * and the page does not re-render while someone is typing. `<collection>` may also be a plugin
 * resource's route, `<owner>.<name>`.
 */
export const POST = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const values = await writeBody(c);
    if (values instanceof Response) return values;
    const cms = c.get('cms');
    try {
        const { resource } = routeResource(cms, c.req.param('collection') ?? '');
        const at = await cms.autosave(resource.id, c.req.param('entry') ?? '', c.get('principal'), values);
        return c.json({ at });
    } catch (error) {
        if (isCmsError(error)) return c.json({ error: error.message, code: error.code }, error.status as 400);
        throw error;
    }
};
