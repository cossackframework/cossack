import type { Context } from 'hono';
import { SUBMISSION_STATUSES, type SubmissionStatus } from '@cossackframework/cms';
import { apiError } from '../../../../../../cms/content-api';

/**
 * A form's submissions, newest first, for an application password or a session with
 * `cms:submissions`: `GET /api/cms/forms/contact/submissions?status=new&limit=50`, then
 * `&after=<next>` for the next page; `q` searches the text answers instead.
 */
export const GET = async (c: Context) => {
    const cms = c.get('cms');
    try {
        const form = await cms.forms.get(c.req.param('slug') ?? '');
        if (!form) return c.json({ error: 'This form does not exist.', code: 'CMS_NOT_FOUND' }, 404);
        const status = c.req.query('status');
        const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 100);
        const page = await cms.forms.list(form, {
            ...(status && (SUBMISSION_STATUSES as readonly string[]).includes(status) ? { status: status as SubmissionStatus } : {}),
            ...(c.req.query('q') ? { search: c.req.query('q') } : {}), ...(c.req.query('after') ? { after: c.req.query('after') } : {}), limit,
        }, c.get('principal'));
        c.header('cache-control', 'private, no-store');
        return c.json({ items: page.items, ...(page.next ? { next: page.next } : {}) });
    } catch (error) { return apiError(c, error); }
};
