import type { Context } from 'hono';
import { answer } from '#app/cms/content-api';
import { menuLocationsList } from '#app/cms/manage';

/** The themes' menu locations (the active theme's first) and the menu at each: `GET /api/cms/appearance/locations`. */
export const GET = (c: Context) => answer(c, () => menuLocationsList(c));
