import type { Context } from 'hono';
import { answer } from '../../../../../cms/content-api';
import { themesList } from '../../../../../cms/manage';

/** The themes the site may use, the active one marked: `GET /api/cms/appearance/themes`. */
export const GET = (c: Context) => answer(c, () => themesList(c));
