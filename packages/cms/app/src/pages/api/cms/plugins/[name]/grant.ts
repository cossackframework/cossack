import type { Context } from 'hono';
import { answer } from '#app/cms/content-api';
import { pluginGrant } from '#app/cms/manage';

/** Grant a plugin what its manifest asks for: `POST /api/cms/plugins/<name>/grant`. Unrestricted access is granted in the dashboard alone. */
export const POST = (c: Context) => answer(c, () => pluginGrant(c, c.req.param('name') ?? ''), { write: true });
