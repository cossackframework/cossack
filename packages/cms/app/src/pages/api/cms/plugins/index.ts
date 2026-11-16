import type { Context } from 'hono';
import { answer } from '#app/cms/content-api';
import { pluginsList } from '#app/cms/manage';

/** The installed plugins, what each asks for and whether it is active: `GET /api/cms/plugins`. */
export const GET = (c: Context) => answer(c, () => pluginsList(c));
