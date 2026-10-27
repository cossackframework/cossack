import type { Context } from 'hono';
import { createTurnstileVerifier } from '@cossackframework/auth/turnstile';
import { formDataValues, isCmsError, isSameOriginPost, type CmsError, type SubmittedValues } from '@cossackframework/cms';
import { renderMarkdown, type LoadedForm } from '@cossackframework/cms/server';
import { apiError } from '../../../../../cms/content-api';
import { messageHtml, type FormResult } from '../../../../../cms/site-forms';

/**
 * A form for headless sites: `GET /api/cms/forms/contact` answers its inputs (name, label,
 * kind, required, choices), its blocks and whether it takes submissions now.
 */
export const GET = async (c: Context) => {
    const cms = c.get('cms');
    try {
        const form = await cms.forms.get(c.req.param('slug') ?? '');
        if (!form?.published) return c.json({ error: 'This form does not exist.', code: 'CMS_NOT_FOUND' }, 404);
        const closed = await cms.forms.closed(form);
        c.header('cache-control', 'public, max-age=60');
        return c.json({
            id: form.ref.id, slug: form.ref.slug, title: form.ref.title, open: closed === null, closedMessage: closed,
            submitLabel: form.settings.submitLabel, requireSignIn: form.settings.requireSignIn || form.settings.oncePerUser,
            inputs: form.ref.inputs.map(input => ({ name: input.name, label: input.label, kind: input.kind, type: input.type, required: input.required, options: input.options })),
            blocks: form.blocks,
        });
    } catch (error) { return apiError(c, error); }
};

/** A path on this site to go back to: the form's page, or the home page. */
function samePath(value: string | undefined): string {
    return value && /^\/(?![/\\])[^\s]*$/.test(value) && value.length <= 2048 ? value.replace(/[?#].*$/, '') : '/';
}

/**
 * Send a form, as its page posts it or as JSON. Pages post form data with `_page` (where to
 * return), `_started` (when the page rendered) and the `_website` trap; the browser's script
 * asks for JSON with `Accept: application/json`. Form posts return to the page with
 * `?form=<slug>&result=<key>`, whose one-time result shows the confirmation or the errors
 * with what was typed; a form that goes to a page after sending redirects there.
 */
export const POST = async (c: Context) => {
    if (!isSameOriginPost(c.req.raw)) return c.json({ error: 'Cross-site form posts are not allowed.', code: 'CMS_FORBIDDEN' }, 403);
    const cms = c.get('cms');
    const json = (c.req.header('accept') ?? '').includes('application/json') || (c.req.header('content-type') ?? '').includes('application/json');
    let form: LoadedForm | null;
    try { form = await cms.forms.get(c.req.param('slug') ?? ''); } catch (error) { return apiError(c, error); }
    if (!form?.published) return c.json({ error: 'This form does not exist.', code: 'CMS_NOT_FOUND' }, 404);
    let values: SubmittedValues;
    let meta: { page?: string; started?: string; trap?: string; token?: string };
    try {
        if ((c.req.header('content-type') ?? '').includes('application/json')) {
            const body = await c.req.json() as Record<string, unknown>;
            values = body;
            const text = (key: string) => typeof body[key] === 'string' ? body[key] as string : undefined;
            meta = { page: text('_page'), started: text('_started'), trap: text('_website'), token: text('cf-turnstile-response') ?? text('turnstile') };
        } else {
            const data = await c.req.formData();
            values = formDataValues(data, form.ref.inputs);
            const text = (key: string) => { const value = data.get(key); return typeof value === 'string' ? value : undefined; };
            meta = { page: text('_page'), started: text('_started'), trap: text('_website'), token: text('cf-turnstile-response') };
        }
    } catch { return c.json({ error: 'Send the form as form data or JSON.', code: 'CMS_VALIDATION' }, 400); }
    const page = samePath(meta.page ?? (() => { try { return new URL(c.req.header('referer') ?? '').pathname; } catch { return undefined; } })());
    const back = (key: string) => c.redirect(`${page}?form=${encodeURIComponent(form.ref.slug)}&result=${key}#form-${form.ref.slug}`, 303);
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    const secret = env('TURNSTILE_SECRET_KEY', '');
    const botCheck = secret && env('TURNSTILE_SITE_KEY', '') ? async () => {
        const verifier = createTurnstileVerifier({ secret, expectedHostname: env('TURNSTILE_HOSTNAME', '') || new URL(c.req.url).hostname, expectedAction: 'form' });
        return (await verifier.verify({ token: meta.token, ...(ip && /^[a-fA-F0-9:.]{1,64}$/.test(ip) ? { remoteIP: ip } : {}) })).success;
    } : undefined;
    const started = Number(meta.started);
    try {
        const { confirmation, submission } = await cms.forms.submit(form.ref.id, values, {
            principal: c.get('principal'), page, origin: env('APP_URL', '') || new URL(c.req.url).origin,
            ...(ip ? { ip } : {}), ...(c.req.header('user-agent') ? { userAgent: c.req.header('user-agent') } : {}), ...(c.req.header('referer') ? { referrer: c.req.header('referer') } : {}),
            ...(meta.trap ? { trap: meta.trap } : {}), ...(Number.isFinite(started) && started > 0 ? { startedAt: started } : {}), ...(botCheck ? { botCheck } : {}),
        });
        // A path or a full address the form's settings chose; a protocol-relative one goes home.
        const target = confirmation.kind === 'redirect' ? (/^\/\//.test(confirmation.url) ? '/' : confirmation.url) : '';
        if (json) return c.json({ submission: { id: submission.id }, confirmation: confirmation.kind === 'redirect' ? { kind: 'redirect', url: target } : { kind: 'message', html: renderMarkdown(confirmation.message) } }, 201);
        if (confirmation.kind === 'redirect') return c.redirect(target, 303);
        const result: FormResult = { kind: 'success', html: renderMarkdown(confirmation.message) };
        return back(await cms.forms.saveResult(form.ref.id, result));
    } catch (error) {
        if (json || !isCmsError(error)) return apiError(c, error);
        const failure = error as CmsError;
        // A closed form's message is the form's own Markdown; other messages are plain text.
        const html = failure.code === 'CMS_FORBIDDEN' && failure.message === form.settings.closedMessage ? renderMarkdown(failure.message) : messageHtml(failure.message);
        const typed: Record<string, string | string[]> = {};
        for (const input of form.ref.inputs) {
            const entry = values[input.name];
            if (typeof entry === 'string') typed[input.name] = entry.slice(0, 10_000);
            else if (Array.isArray(entry)) typed[input.name] = entry.filter((item): item is string => typeof item === 'string').slice(0, 100);
        }
        const result: FormResult = { kind: 'error', html, ...(failure.fields ? { errors: failure.fields } : {}), values: typed };
        return back(await cms.forms.saveResult(form.ref.id, result));
    }
};
