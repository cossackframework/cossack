import type { Context } from 'hono';
import { answer } from '../../../../cms/content-api';
import { notesAcross } from '../../../../cms/manage';

/** Entries with review notes across the site, with their threads: `GET /api/cms/notes?status=open&limit=50`, for whoever may edit each entry. */
export const GET = (c: Context) => answer(c, () => notesAcross(c, c.req.query('status'), c.req.query('limit')));
