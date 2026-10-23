import type { Context } from 'hono';
import { SUBMISSION_STATUSES, type SubmissionStatus } from '@cossackframework/cms';
import { apiError } from '../../../../../../cms/content-api';

/**
 * A form's submissions as CSV, newest first: `GET /api/cms/forms/contact/submissions/export`,
 * or `?status=spam` for one status. For a session or an application password with `cms:submissions`.
 */
export const GET = async (c: Context) => {
    const cms = c.get('cms');
    const principal = c.get('principal');
    try {
        const form = await cms.forms.get(c.req.param('slug') ?? '');
        if (!form) return c.json({ error: 'This form does not exist.', code: 'CMS_NOT_FOUND' }, 404);
        const status = c.req.query('status');
        const rows = cms.forms.csv(form, (SUBMISSION_STATUSES as readonly string[]).includes(status ?? '') ? { status: status as SubmissionStatus } : {}, principal);
        // The first chunk checks the permission before anything is sent.
        const first = await rows.next();
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(encoder.encode(`﻿${first.done ? '' : first.value}`)); },
            async pull(controller) {
                const next = await rows.next();
                if (next.done) controller.close(); else controller.enqueue(encoder.encode(next.value));
            },
            async cancel() { await rows.return(undefined); },
        });
        const date = new Date(cms.now()).toISOString().slice(0, 10);
        return new Response(body, { headers: {
            'content-type': 'text/csv; charset=utf-8', 'cache-control': 'private, no-store',
            'content-disposition': `attachment; filename="${form.ref.slug}-submissions-${date}.csv"`,
        } });
    } catch (error) { return apiError(c, error); }
};
