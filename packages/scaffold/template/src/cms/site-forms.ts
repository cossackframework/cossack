/**
 * Forms placed on site pages. Each `core/form` block gets its form's view: the form's blocks
 * rendered, every input with its value and error, from the post that came back (`?form=`
 * and `?result=`) or from the form's defaults and the page's query. Server-only.
 */
import {
    escapeHtml, formVisibility, validateSubmission, type Block, type FormValue, type FormValues, type FormView, type InputKind, type Principal, type RenderedBlock,
} from '@cossackframework/cms';
import { renderMarkdown, type CmsHost, type LoadedForm } from '@cossackframework/cms/server';

/** What a page tells its forms about the request. */
export interface FormRequest {
    /** The page's query: `form` and `result` after a post, and values for hidden fields. */
    readonly query: { readonly [name: string]: string };
    readonly principal: Principal;
    /** The page's path, where a post returns. */
    readonly url: string;
}

/** What a form post keeps for its page, read once after the redirect. */
export interface FormResult {
    readonly kind: 'success' | 'error';
    /** Escaped HTML: the confirmation, or what went wrong. */
    readonly html: string;
    readonly errors?: { readonly [name: string]: string };
    /** What the sender typed, to fill the form again. */
    readonly values?: { readonly [name: string]: string | readonly string[] };
}

/** The values a returning post shows: as typed, with ticked boxes as yes. */
function typedValues(form: LoadedForm, raw: { readonly [name: string]: string | readonly string[] }): FormValues {
    const values: { [name: string]: FormValue } = {};
    for (const input of form.ref.inputs) {
        const entry = raw[input.name];
        if (entry === undefined) continue;
        if (input.kind === 'boolean') values[input.name] = entry === 'on' || entry === 'true';
        else if (input.kind === 'choices') values[input.name] = Array.isArray(entry) ? entry : [entry as string];
        else values[input.name] = Array.isArray(entry) ? entry[0] ?? '' : entry as string;
    }
    return values;
}

/**
 * The view of a form for a page. `render` turns stored blocks into rendered ones, with their
 * Markdown and media, as the page renders its other blocks.
 */
export async function formView(cms: CmsHost, form: LoadedForm, request: FormRequest, render: (block: Block) => RenderedBlock): Promise<FormView> {
    const { slug } = form.ref;
    const types = cms.blockTypes;
    const kinds: { [type: string]: InputKind } = {};
    for (const input of form.ref.inputs) kinds[input.type] = input.kind;
    const base = { id: form.ref.id, slug, title: form.ref.title, action: `/api/cms/forms/${slug}`, page: request.url, submitLabel: form.settings.submitLabel || 'Submit', startedAt: cms.now(), kinds };
    const empty = { blocks: [], notice: null, closed: null, signInUrl: null, turnstileSiteKey: null };
    const result = request.query.form === slug && request.query.result ? await cms.forms.takeResult(form.ref.id, request.query.result) as FormResult | null : null;
    if (result?.kind === 'success') return { ...base, ...empty, notice: { kind: 'success', html: result.html } };
    const closed = await cms.forms.closed(form);
    if (closed !== null) return { ...base, ...empty, closed: renderMarkdown(closed) };
    if ((form.settings.requireSignIn || form.settings.oncePerUser) && request.principal.kind !== 'user') {
        return { ...base, ...empty, signInUrl: `/auth/login?next=${encodeURIComponent(request.url)}` };
    }
    const values = result?.values ? typedValues(form, result.values) : await cms.forms.prefill(form, request.query, request.principal);
    const errors = result?.errors ?? {};
    // Conditions see the values a submission would keep.
    const { hidden } = formVisibility(form.blocks, types, validateSubmission(form.blocks, types, values).values);
    const inputs = new Map(form.ref.inputs.map(input => [input.id, input]));
    const withState = (block: RenderedBlock): RenderedBlock => {
        const input = inputs.get(block.id);
        return {
            ...block,
            ...(block.when ? { shown: !hidden.has(block.id) } : {}),
            ...(input ? { input: { name: input.name, kind: input.kind, id: `form-${slug}-${input.name}`, value: values[input.name] ?? null, error: errors[input.name] ?? '', options: input.options } } : {}),
            ...(block.children ? { children: block.children.map(withState) } : {}),
        };
    };
    const siteKey = env('TURNSTILE_SITE_KEY', '');
    return {
        ...base, ...empty,
        blocks: form.blocks.map(block => withState(render(block))),
        notice: result?.kind === 'error' ? { kind: 'error', html: result.html } : null,
        turnstileSiteKey: form.settings.turnstile && siteKey && env('TURNSTILE_SECRET_KEY', '') ? siteKey : null,
    };
}

/** A visitor-facing message as one escaped paragraph. */
export function messageHtml(text: string): string {
    return `<p>${escapeHtml(text)}</p>`;
}
