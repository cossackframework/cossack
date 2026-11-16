import type { Context } from 'hono';
import { answer } from '#app/cms/content-api';
import { pluginRevoke } from '#app/cms/manage';

/** Disable a plugin: `POST /api/cms/plugins/<name>/revoke`. */
export const POST = (c: Context) => answer(c, () => pluginRevoke(c, c.req.param('name') ?? ''), { write: true });
