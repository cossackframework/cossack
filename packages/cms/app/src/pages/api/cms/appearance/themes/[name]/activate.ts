import type { Context } from 'hono';
import { answer } from '#app/cms/content-api';
import { themeActivate } from '#app/cms/manage';

/** Make a theme the site's: `POST /api/cms/appearance/themes/<name>/activate`. */
export const POST = (c: Context) => answer(c, () => themeActivate(c, c.req.param('name') ?? ''), { write: true });
