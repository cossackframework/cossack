import type { Context } from 'hono';
import { answer } from '#app/cms/content-api';
import { commentsQueue } from '#app/cms/manage';

/** The moderation queue: `GET /api/cms/comments/queue?status=pending&q=&page=&perPage=`. Needs the comments permission. */
export const GET = (c: Context) => answer(c, () => commentsQueue(c, c.req.query()));
