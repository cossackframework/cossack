import type { Context } from 'hono';
import { apiError, writeAllowed } from '../../../../cms/content-api';
import { importEntries, importItems } from '../../../../cms/content';

/**
 * Import entries, as `/api/cms/export/<collection>` wrote them or as a JSON list in the API's
 * shape: `POST /api/cms/import/posts`. Entries whose `id` or slug exists are updated; the rest
 * are created with their IDs. Answers `{ created, updated, failed }`, one `failed` row per
 * entry that was refused, with its index and the fields at fault.
 */
export const POST = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    let parsed: unknown;
    try { parsed = await c.req.json(); } catch { return c.json({ error: 'Send JSON.', code: 'CMS_VALIDATION' }, 400); }
    const items = importItems(parsed);
    if (typeof items === 'string') return c.json({ error: items, code: 'CMS_VALIDATION' }, 400);
    try {
        const report = await importEntries(c.get('cms'), c.req.param('collection') ?? '', items, c.get('principal'));
        c.header('cache-control', 'no-store');
        return c.json(report);
    } catch (error) { return apiError(c, error); }
};
