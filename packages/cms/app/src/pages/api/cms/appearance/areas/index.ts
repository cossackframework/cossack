import type { Context } from 'hono';
import { answer } from '../../../../../cms/content-api';
import { areasList } from '../../../../../cms/manage';

/** The themes' widget areas (the active theme's first) with the blocks each shows, the theme's defaults until the site saves its own: `GET /api/cms/appearance/areas`. */
export const GET = (c: Context) => answer(c, () => areasList(c));
