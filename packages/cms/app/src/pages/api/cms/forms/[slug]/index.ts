import type { Context } from 'hono';
import { createTurnstileVerifier } from '@cossackframework/auth/turnstile';
import { formDataValues, isCmsError, isSameOriginPost, type CmsError, type FormField, type PostedValue, type SubmittedValues } from '@cossackframework/cms';
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
            inputs: describeInputs(form.ref.inputs),
            blocks: form.blocks,
        });
    } catch (error) { return apiError(c, error); }
};

/** Inputs as the API describes them, a repeater with its rows' inputs. */
function describeInputs(inputs: readonly FormField[]): unknown[] {
    return inputs.map(input => ({ name: input.name, label: input.label, kind: input.kind, type: input.type, required: input.required, options: input.options, ...(input.kind === 'rows' ? { inputs: describeInputs(input.inputs) } : {}) }));
}

/** What the sender typed, kept for the form to show again: text and choices as posted, a repeater's rows the same way, within limits. */
function postedValues(inputs: readonly FormField[], values: SubmittedValues): Record<string, PostedValue> {
    const typed: Record<string, PostedValue> = {};
    for (const input of inputs) {
        const entry = values[input.name];
        if (input.kind === 'rows' && Array.isArray(entry)) {
            typed[input.name] = entry.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row)).slice(0, 50)
                .map(row => ({ ...(postedValues(input.inputs, row) as { [name: string]: string | string[] }), ...(typeof row._id === 'string' ? { _id: row._id.slice(0, 40) } : {}) }));
        }
        else if (typeof entry === 'string') typed[input.name] = entry.slice(0, 10_000);
        else if (Array.isArray(entry)) typed[input.name] = entry.filter((item): item is string => typeof item === 'string').slice(0, 100);
    }
    return typed;
}

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
    let meta: { page?: string; started?: string; trap?: string; token?: string; add?: string; remove?: string };
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
            meta = { page: text('_page'), started: text('_started'), trap: text('_website'), token: text('cf-turnstile-response'), add: text('_add'), remove: text('_remove') };
        }
    } catch { return c.json({ error: 'Send the form as form data or JSON.', code: 'CMS_VALIDATION' }, 400); }
    const page = samePath(meta.page ?? (() => { try { return new URL(c.req.header('referer') ?? '').pathname; } catch { return undefined; } })());
    const back = (key: string) => c.redirect(`${page}?form=${encodeURIComponent(form.ref.slug)}&result=${key}#form-${form.ref.slug}`, 303);
    // Without the page's script, a repeater's Add and Remove buttons post the form back: it returns as typed with the rows changed, nothing checked.
    if (!json && (meta.add || meta.remove)) {
        const typed = postedValues(form.ref.inputs, values);
        const [name, rowId] = (meta.add ?? meta.remove ?? '').split('.');
        const repeater = form.ref.inputs.find(input => input.kind === 'rows' && input.name === name);
        if (repeater) {
            const rows = Array.isArray(typed[name]) ? typed[name] as { [name: string]: string | string[] }[] : [];
            const max = typeof repeater.data.max === 'number' ? repeater.data.max : 50;
            typed[name] = meta.add ? (rows.length < max ? [...rows, { _id: `r${Date.now().toString(36)}` }] : rows) : rows.filter(row => row._id !== rowId);
        }
        const result: FormResult = { kind: 'edit', html: '', values: typed };
        return back(await cms.forms.saveResult(form.ref.id, result));
    }
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
        const result: FormResult = { kind: 'error', html, ...(failure.fields ? { errors: failure.fields } : {}), values: postedValues(form.ref.inputs, values) };
        return back(await cms.forms.saveResult(form.ref.id, result));
    }
};
