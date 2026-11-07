import type { Context } from 'hono';
import { hasPermission, PERMISSIONS } from '@cossackframework/cms';
import { formFiles, uploadFiles } from '../../../cms/uploads';
import { writeAllowed } from '../../../cms/content-api';
import { findMedia } from '../../../cms/content';

/** Library files for the dashboard's choosers: `?search=` matches titles and names, `?kind=image` (video, audio, document, archive) narrows them. */
export const GET = async (c: Context) => {
    const principal = c.get('principal');
    if (![PERMISSIONS.upload, PERMISSIONS.manageMedia, PERMISSIONS.manageUsers].some(permission => hasPermission(principal, permission))) return c.json({ error: 'Not allowed to see the media library.', code: 'CMS_FORBIDDEN' }, 403);
    const kind = c.req.query('kind') ?? '';
    const items = await findMedia(c.get('cms'), (c.req.query('search') ?? '').slice(0, 100), ['image', 'video', 'audio', 'document', 'archive'].includes(kind) ? kind : '');
    return c.json({ items }, 200, { 'cache-control': 'private, no-store' });
};

/**
 * Upload media from the dashboard's drop zone and media picker, or with an application
 * password. Answers with the stored files.
 */
export const POST = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const principal = c.get('principal');
    let form: FormData;
    try { form = await c.req.formData(); } catch { return c.json({ error: 'Send the files as multipart form data.', code: 'CMS_VALIDATION' }, 400); }
    const result = await uploadFiles(c.get('cms'), formFiles(form), principal, c.req.raw.signal);
    if (!result.files.length) return c.json({ error: result.errors.join(' ') || 'Choose a file to upload.', code: 'CMS_VALIDATION' }, 422);
    return c.json(result, 201);
};
