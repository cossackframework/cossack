/**
 * Forms placed on site pages. Each `core/form` block gets its form's view: the form's blocks
 * rendered, every input with its value and error, from the post that came back (`?form=`
 * and `?result=`) or from the form's defaults and the page's query. Server-only.
 */
import {
    escapeHtml, flatFormInputs, formVisibility, isRows, rowValues, TEMPLATE_ROW, validateSubmission,
    type Block, type FormField, type FormRow, type FormValue, type FormValues, type FormView, type InputKind, type ItemsView, type PostedValue, type Principal, type RenderedBlock, type RepeaterView,
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
    /** `edit`: the form again with these values, after a row was added or removed without the page's script. */
    readonly kind: 'success' | 'error' | 'edit';
    /** Escaped HTML: the confirmation, or what went wrong. */
    readonly html: string;
    readonly errors?: { readonly [name: string]: string };
    /** What the sender typed, to fill the form again. */
    readonly values?: { readonly [name: string]: PostedValue };
}

/** The values a returning post shows: as typed, with ticked boxes as yes and a repeater's rows typed the same way. */
export function typedValues(inputs: readonly FormField[], raw: { readonly [name: string]: unknown }): FormValues {
    const values: { [name: string]: FormValue } = {};
    for (const input of inputs) {
        const entry = raw[input.name];
        if (entry === undefined || entry === null) continue;
        if (input.kind === 'rows') {
            if (!Array.isArray(entry)) continue;
            values[input.name] = entry.filter((row): row is { [name: string]: unknown } => !!row && typeof row === 'object' && !Array.isArray(row))
                .map((row, index): FormRow => ({ ...typedValues(input.inputs, row), _id: typeof row._id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(row._id) ? row._id : `r${index + 1}` }));
        }
        else if (input.kind === 'boolean') values[input.name] = entry === true || entry === 'on' || entry === 'true';
        else if (input.multiple) values[input.name] = (Array.isArray(entry) ? entry : [entry]).map(item => typeof item === 'number' ? item : String(item ?? '')) as string[] | number[];
        else if (input.kind === 'choices') values[input.name] = Array.isArray(entry) ? entry.filter((item): item is string => typeof item === 'string') : [String(entry)];
        else values[input.name] = Array.isArray(entry) ? String(entry[0] ?? '') : typeof entry === 'number' ? entry : String(entry);
    }
    return values;
}

/** A row's starting values: the row's inputs' defaults. */
function rowDefaults(input: FormField): FormValues {
    const values: { [name: string]: FormValue } = {};
    for (const child of input.inputs) {
        const fallback = child.data.defaultValue;
        if (fallback !== undefined && fallback !== null && fallback !== '') values[child.name] = fallback as FormValue;
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
    for (const input of flatFormInputs(form.ref.inputs)) kinds[input.type] = input.kind;
    const base = { id: form.ref.id, slug, title: form.ref.title, action: `/api/cms/forms/${slug}`, page: request.url, submitLabel: form.settings.submitLabel || 'Submit', startedAt: cms.now(), kinds };
    const empty = { blocks: [], notice: null, closed: null, signInUrl: null, turnstileSiteKey: null };
    const result = request.query.form === slug && request.query.result ? await cms.forms.takeResult(form.ref.id, request.query.result) as FormResult | null : null;
    if (result?.kind === 'success') return { ...base, ...empty, notice: { kind: 'success', html: result.html } };
    const closed = await cms.forms.closed(form);
    if (closed !== null) return { ...base, ...empty, closed: renderMarkdown(closed) };
    if ((form.settings.requireSignIn || form.settings.oncePerUser) && request.principal.kind !== 'user') {
        return { ...base, ...empty, signInUrl: `/auth/login?next=${encodeURIComponent(request.url)}` };
    }
    const values = result?.values ? typedValues(form.ref.inputs, result.values) : await cms.forms.prefill(form, request.query, request.principal);
    const errors = result?.errors ?? {};
    // Conditions see the values a submission would keep; a repeater's rows have theirs under `<row id>:<block id>`.
    const check = validateSubmission(form.blocks, types, values);
    const hidden = new Set([...formVisibility(form.blocks, types, check.values).hidden, ...check.hidden]);
    const inputs = new Map(form.ref.inputs.map(input => [input._id, input]));
    /** A block with its input's state. In a repeater's row, ids and names are the row's. */
    const withState = (block: RenderedBlock, row: { readonly id: string; readonly repeater: FormField; readonly values: FormValues } | null): RenderedBlock => {
        const input = row ? row.repeater.inputs.find(child => child._id === block._id) : inputs.get(block._id);
        const id = row ? `${row.id}:${block._id}` : block._id;
        const key = row && input ? `${row.repeater.name}.${row.id}.${input.name}` : input?.name ?? '';
        const name = row && input ? `${row.repeater.name}[${row.id}][${input.name}]` : input?.name ?? '';
        const value = row ? row.values[input?.name ?? ''] : values[input?.name ?? ''];
        const items = (): ItemsView => {
            // A multiple input: its posted items in their positions, blanks included so the errors line up, or the fewest controls it needs (one, so the visitor sees what it asks).
            const posted = Array.isArray(value) ? (value as readonly (string | number)[]).map(String) : value !== undefined && value !== null && value !== '' ? [String(value)] : [];
            const min = typeof input!.data.minItems === 'number' ? input!.data.minItems : 0;
            const list = posted.length ? posted : Array.from({ length: Math.max(min, 1) }, () => '');
            return {
                values: list, errors: list.map((_, index) => errors[`${key}.${index + 1}`] ?? ''),
                min, max: typeof input!.data.maxItems === 'number' ? input!.data.maxItems : 50,
                addLabel: typeof input!.data.addLabel === 'string' && input!.data.addLabel ? input!.data.addLabel : 'Add another',
            };
        };
        const state: RenderedBlock = {
            ...block, _id: id,
            ...(block.when ? { shown: !hidden.has(id) } : {}),
            ...(input ? { input: { name, key, kind: input.kind, id: `form-${slug}-${key.replaceAll('.', '-')}`, value: value ?? null, error: errors[key] ?? '', options: input.options, ...(input.multiple ? { items: items() } : {}) } } : {}),
            ...(block.children ? { children: block.children.map(child => withState(child, row)) } : {}),
        };
        if (!input || input.kind !== 'rows' || row) return state;
        // A repeater: its rows from the values, or the fewest rows it needs (one, so the visitor sees what a row asks), and the template of a new row.
        const posted = isRows(values[input.name]) ? values[input.name] as readonly FormRow[] : [];
        const fewest = Math.max(typeof input.data.min === 'number' ? input.data.min : 0, 1);
        const rows = posted.length ? posted.map(entry => ({ id: entry._id, values: rowValues(entry) })) : Array.from({ length: fewest }, (_, index) => ({ id: `r${index + 1}`, values: rowDefaults(input) }));
        const children = block.children ?? [];
        const rowBlocks = (entry: { id: string; values: FormValues }) => {
            // A row the visitor has not posted yet: its conditions settle on its defaults over the form's values.
            if (!posted.length || entry.id === TEMPLATE_ROW) for (const off of formVisibility(children, types, { ...check.values, ...entry.values }).hidden) hidden.add(`${entry.id}:${off}`);
            return children.map(child => withState(child, { id: entry.id, repeater: input, values: entry.values }));
        };
        const repeater: RepeaterView = {
            rows: rows.map(entry => ({ id: entry.id, blocks: rowBlocks(entry) })),
            template: rowBlocks({ id: TEMPLATE_ROW, values: rowDefaults(input) }),
            min: typeof input.data.min === 'number' ? input.data.min : 0, max: typeof input.data.max === 'number' ? input.data.max : 50,
            addLabel: typeof input.data.addLabel === 'string' && input.data.addLabel ? input.data.addLabel : 'Add another',
            rowLabel: typeof input.data.rowLabel === 'string' ? input.data.rowLabel : '',
            error: errors[input.name] ?? '',
        };
        return { ...state, repeater };
    };
    const siteKey = env('TURNSTILE_SITE_KEY', '');
    return {
        ...base, ...empty,
        blocks: form.blocks.map(block => withState(render(block), null)),
        notice: result?.kind === 'error' ? { kind: 'error', html: result.html } : null,
        turnstileSiteKey: form.settings.turnstile && siteKey && env('TURNSTILE_SECRET_KEY', '') ? siteKey : null,
    };
}

/** A visitor-facing message as one escaped paragraph. */
export function messageHtml(text: string): string {
    return `<p>${escapeHtml(text)}</p>`;
}
