import type { Context } from 'hono';
import { formFiles, uploadFiles } from '../../../cms/uploads';
import { writeAllowed } from '../../../cms/content-api';

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
