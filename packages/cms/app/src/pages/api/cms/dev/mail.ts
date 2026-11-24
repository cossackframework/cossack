import type { Context } from 'hono';
import { clearDevMail, devMail, devMailOpen } from '#app/cms/dev-mail';

/**
 * Development only, while APP_URL and the request's address name this machine:
 * `GET /api/cms/dev/mail` lists the mail the sites sent, oldest first (`?to=` keeps one
 * recipient's), so a script can follow an invitation's link. `DELETE` forgets it. Elsewhere
 * both answer 404.
 */
export const GET = (c: Context) => {
    if (!devMailOpen(c, (c.env as { APP_URL?: string }).APP_URL)) return c.json({ error: 'Not found.', code: 'CMS_NOT_FOUND' }, 404);
    return c.json({ mail: devMail(c.req.query('to')) }, 200, { 'cache-control': 'no-store' });
};

export const DELETE = (c: Context) => {
    if (!devMailOpen(c, (c.env as { APP_URL?: string }).APP_URL)) return c.json({ error: 'Not found.', code: 'CMS_NOT_FOUND' }, 404);
    clearDevMail();
    return c.body(null, 204);
};
