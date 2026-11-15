import type { Context } from 'hono';
import { answer } from '../../../../../cms/content-api';
import { pluginRevoke } from '../../../../../cms/manage';

/** Disable a plugin: `POST /api/cms/plugins/<name>/revoke`. */
export const POST = (c: Context) => answer(c, () => pluginRevoke(c, c.req.param('name') ?? ''), { write: true });
