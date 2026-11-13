import type { Context } from 'hono';
import { formFiles, uploadFiles } from '../../../cms/uploads';
import { answer, cappedRequest, writeAllowed } from '../../../cms/content-api';
import { mediaList } from '../../../cms/manage';

/** Library files for the dashboard's choosers, the CLI and MCP: `?q=` matches titles and names, `?kind=image` (video, audio, document, archive) narrows them. */
export const GET = (c: Context) => answer(c, () => mediaList(c, c.req.query()));

/**
 * Upload media from the dashboard's drop zone and media picker, or with an application
 * password. Answers with the stored files.
 */
export const POST = async (c: Context) => {
    const refused = writeAllowed(c);
    if (refused) return refused;
    const principal = c.get('principal');
    // Read up to ten files at the size Settings → Media allows, declared or not, before parsing.
    const maxMb = Number(await c.get('cms').settings.get('media.maxUploadMb').catch(() => 64)) || 64;
    const posted = await cappedRequest(c, (maxMb * 10 + 1) * 1024 * 1024);
    if (!posted) return c.json({ error: 'The upload is too large.', code: 'CMS_LIMIT' }, 413);
    let form: FormData;
    try { form = await posted.formData(); } catch { return c.json({ error: 'Send the files as multipart form data.', code: 'CMS_VALIDATION' }, 400); }
    const result = await uploadFiles(c.get('cms'), formFiles(form), principal, c.req.raw.signal);
    if (!result.files.length) return c.json({ error: result.errors.join(' ') || 'Choose a file to upload.', code: 'CMS_VALIDATION' }, 422);
    return c.json(result, 201);
};
