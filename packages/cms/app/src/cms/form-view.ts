/**
 * Forms on the site: `core/form` and the input blocks, as plain HTML that posts without
 * JavaScript. The server checks every post; in the browser `form.client.ts` applies the
 * form's conditions as values change and shows the same errors before sending. Client-safe.
 * A theme overrides any of these through its `blocks`, and can call them to wrap them.
 */
import { component, html, ifDefined, unsafeHTML, type TemplateResult } from '@cossackframework/renderer';
import { Turnstile } from '@cossackframework/ui';
import type { Block, FormView, RenderedBlock, ThemeHelpers } from '@cossackframework/cms';

export const FORM_INPUT = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring aria-[invalid=true]:border-destructive';
const LABEL = 'block text-sm font-medium text-foreground';
const HELP = 'text-xs text-muted-foreground';
const ERROR = 'text-xs text-destructive empty:hidden';

/** What the browser's checks need: the blocks without their rendered parts. */
function plainBlocks(blocks: readonly RenderedBlock[]): Block[] {
    return blocks.map(block => ({ id: block.id, type: block.type, data: block.data, ...(block.when ? { when: block.when } : {}), ...(block.children ? { children: plainBlocks(block.children) } : {}) }));
}

/** Load the browser's part once a form is on the page. Server rendering skips it. */
function enhance(element: Element | undefined): void {
    if (!element || typeof window === 'undefined') return;
    void import('./form.client').then(module => module.enhanceForm(element as HTMLFormElement)).catch(() => undefined);
}

/**
 * A `core/form` block: the form, or its confirmation after a post, or why it takes nothing.
 * The trap field catches bots; `_started` lets the server spot posts faster than people type.
 */
export function formBlock(block: RenderedBlock, helpers: ThemeHelpers): TemplateResult | null {
    const form: FormView | undefined = block.form;
    if (!form) return null;
    const anchor = `form-${form.slug}`;
    if (form.notice?.kind === 'success') return html`<div id=${anchor} role="status" class="cms-form cms-form-done rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground [&_p]:my-1">${unsafeHTML(form.notice.html)}</div>`;
    if (form.closed !== null) return html`<div id=${anchor} class="cms-form rounded-md border border-border px-4 py-3 text-sm text-muted-foreground [&_p]:my-1">${unsafeHTML(form.closed)}</div>`;
    if (form.signInUrl) return html`<p id=${anchor} class="cms-form text-sm text-muted-foreground"><a href=${form.signInUrl} class="text-primary hover:underline">${__('Log in')}</a> ${__('to send this form.')}</p>`;
    return html`<form id=${anchor} method="post" action=${form.action} novalidate class="cms-form space-y-4" aria-label=${form.title}
        data-cms-form=${form.slug} data-blocks=${JSON.stringify(plainBlocks(form.blocks))} data-kinds=${JSON.stringify(form.kinds)} ref=${enhance}>
        <input type="hidden" name="_page" value=${form.page}>
        <input type="hidden" name="_started" value=${String(form.startedAt)}>
        <div aria-hidden="true" class="cms-form-trap"><label>${__('Leave this empty')} <input type="text" name="_website" tabindex="-1" autocomplete="off"></label></div>
        <div data-cms-form-done role="status" hidden class="rounded-md border border-border bg-muted px-4 py-3 text-sm text-foreground [&_p]:my-1"></div>
        <div data-cms-form-fields class="space-y-4">
            ${form.notice?.kind === 'error' ? html`<div role="alert" data-cms-server-error class="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive [&_p]:my-0">${unsafeHTML(form.notice.html)}</div>` : null}
            <p role="alert" data-cms-form-error class="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive empty:hidden"></p>
            ${form.blocks.map(child => helpers.block(child))}
            ${form.turnstileSiteKey ? component(Turnstile, { id: `${anchor}-verify`, siteKey: form.turnstileSiteKey, action: 'form', label: __('Bot protection') }) : null}
            <button type="submit" data-cms-form-submit class="rounded-md border-none bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer disabled:opacity-60">${form.submitLabel}</button>
        </div>
    </form>`;
}

const text = (block: RenderedBlock, name: string): string => typeof block.data[name] === 'string' ? block.data[name] as string : '';
const number = (block: RenderedBlock, name: string): number | undefined => typeof block.data[name] === 'number' ? block.data[name] as number : undefined;

const BUTTON = 'rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground cursor-pointer hover:bg-muted disabled:cursor-default disabled:opacity-50';

/**
 * A repeater: its rows, each a bordered group of the row's blocks with a Remove button, an
 * Add button, and a hidden template row with its inputs disabled, which the page's script
 * copies. Without the script, Add and Remove post the form back and it returns with the
 * rows changed; the server validates nothing for those posts.
 */
function repeaterBlock(block: RenderedBlock, helpers: ThemeHelpers | undefined, parts: { label: TemplateResult; help: TemplateResult | null; errors: TemplateResult }): TemplateResult {
    const input = block.input!;
    const view = block.repeater!;
    const name = input.name;
    const renderRow = (child: RenderedBlock) => helpers ? helpers.block(child) : inputBlock(child);
    const row = (entry: { readonly id: string; readonly blocks: readonly RenderedBlock[] }, index: number, template = false) => html`<div data-cms-row=${entry.id} class="cms-repeater-row space-y-3 rounded-md border border-border p-3" ?hidden=${template} ?data-cms-row-template=${template}>
        <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-medium text-foreground">${view.rowLabel || text(block, 'label') || name} <span data-cms-row-index>${index}</span></p>
            <button type="submit" name="_remove" value=${`${name}.${entry.id}`} formnovalidate data-cms-row-remove ?disabled=${template} class=${BUTTON}>${__('Remove')}</button>
        </div>
        ${template ? html`<fieldset disabled class="contents">${entry.blocks.map(renderRow)}</fieldset>` : entry.blocks.map(renderRow)}
    </div>`;
    return html`<fieldset class="cms-field cms-repeater space-y-3" data-input=${input.key} data-cms-repeater=${name} data-min=${String(view.min)} data-max=${String(view.max)}>
        <legend class=${LABEL}>${parts.label}</legend>${parts.help}
        <div data-cms-rows class="space-y-3">${view.rows.map((entry, index) => row(entry, index + 1))}</div>
        ${row({ id: '__row__', blocks: view.template }, 0, true)}
        <div><button type="submit" name="_add" value=${name} formnovalidate data-cms-row-add ?disabled=${view.rows.length >= view.max} class=${BUTTON}>${view.addLabel}</button></div>
        ${parts.errors}
    </fieldset>`;
}

/**
 * An input block in a form: its label, control, help and error. The server's error shows in
 * `data-cms-server-error`; the browser's checks write theirs into the empty `data-cms-error`.
 * Both carry the input's key: its name, or `repeater.<row id>.<name>` in a row. A repeater's
 * rows render through `helpers.block`, so a theme's input renderers apply inside them.
 */
export function inputBlock(block: RenderedBlock, helpers?: ThemeHelpers): TemplateResult | null {
    const input = block.input;
    if (!input) return null;
    const required = block.data.required === true;
    const label = text(block, 'label') || input.name;
    const help = text(block, 'description');
    const described = [help ? `${input.id}-help` : '', `${input.id}-error`].filter(Boolean).join(' ');
    const invalid = input.error ? 'true' : undefined;
    const value = input.value;
    const current = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
    const chosen = Array.isArray(value) ? value as readonly string[] : typeof value === 'string' ? [value] : [];
    const mark = required ? html`<span aria-hidden="true" class="text-destructive"> *</span>` : null;
    const helpText = help ? html`<p id=${`${input.id}-help`} class=${HELP}>${help}</p>` : null;
    const errors = html`${input.error ? html`<p class=${ERROR} data-cms-server-error=${input.key}>${input.error}</p>` : null}<p id=${`${input.id}-error`} class=${ERROR} data-cms-error=${input.key}></p>`;
    if (block.repeater) return repeaterBlock(block, helpers, { label: html`${label}${mark}`, help: helpText, errors });
    const field = (control: TemplateResult) => html`<div class="cms-field space-y-1" data-input=${input.key}>
        <label for=${input.id} class=${LABEL}>${label}${mark}</label>${control}${helpText}${errors}</div>`;
    const group = (controls: TemplateResult, inline: boolean) => html`<fieldset class="cms-field space-y-1" data-input=${input.key} aria-describedby=${described}>
        <legend class=${LABEL}>${label}${mark}</legend>
        <div class=${inline ? 'flex flex-wrap gap-x-4 gap-y-1' : 'space-y-1'}>${controls}</div>${helpText}${errors}</fieldset>`;
    const choice = (type: 'radio' | 'checkbox', inline: boolean) => group(html`${input.options.map((option, index) => html`<label class="flex items-center gap-2 text-sm text-foreground">
        <input type=${type} id=${index ? `${input.id}-${index}` : input.id} name=${input.name} value=${option.value} ?checked=${chosen.includes(option.value)} aria-invalid=${ifDefined(invalid)} class="size-4 accent-primary">
        ${option.label}</label>`)}`, inline);
    switch (block.type) {
        case 'form/hidden': return html`<input type="hidden" name=${input.name} value=${current}>`;
        case 'form/textarea': return field(html`<textarea id=${input.id} name=${input.name} rows=${number(block, 'rows') ?? 5} placeholder=${ifDefined(text(block, 'placeholder') || undefined)}
            minlength=${ifDefined(number(block, 'minLength'))} maxlength=${ifDefined(number(block, 'maxLength'))} ?required=${required}
            aria-describedby=${described} aria-invalid=${ifDefined(invalid)} class=${FORM_INPUT} .value=${current}></textarea>`);
        case 'form/select': return field(html`<select id=${input.id} name=${input.name} ?required=${required} aria-describedby=${described} aria-invalid=${ifDefined(invalid)} class=${FORM_INPUT}>
            <option value="" ?selected=${!current}>${text(block, 'placeholder') || __('Choose…')}</option>
            ${input.options.map(option => html`<option value=${option.value} ?selected=${option.value === current}>${option.label}</option>`)}</select>`);
        case 'form/radio': return choice('radio', block.data.inline === true);
        case 'form/checkboxes': return choice('checkbox', block.data.inline === true);
        case 'form/checkbox': case 'form/consent': {
            const caption = block.type === 'form/consent' ? html`<span class="[&_p]:my-0 [&_a]:text-primary [&_a]:underline">${unsafeHTML(block.html.text ?? '')}</span>` : html`<span>${text(block, 'text') || label}</span>`;
            return html`<div class="cms-field space-y-1" data-input=${input.key}>
                ${block.type === 'form/checkbox' && text(block, 'text') ? html`<p class=${LABEL}>${label}${mark}</p>` : null}
                <label for=${input.id} class="flex items-start gap-2 text-sm text-foreground">
                    <input type="checkbox" id=${input.id} name=${input.name} value="on" ?checked=${value === true} ?required=${required} aria-describedby=${described} aria-invalid=${ifDefined(invalid)} class="mt-0.5 size-4 accent-primary">
                    ${caption}${block.type === 'form/consent' || !text(block, 'text') ? mark : null}</label>${helpText}${errors}</div>`;
        }
        default: {
            const type = input.kind === 'email' ? 'email' : input.kind === 'url' ? 'url' : input.kind === 'phone' ? 'tel' : input.kind === 'number' ? 'number' : input.kind === 'date' ? 'date' : 'text';
            const autocomplete = input.kind === 'email' ? 'email' : input.kind === 'phone' ? 'tel' : input.kind === 'url' ? 'url' : undefined;
            return field(html`<input id=${input.id} name=${input.name} type=${type} value=${current} placeholder=${ifDefined(text(block, 'placeholder') || undefined)}
                minlength=${ifDefined(number(block, 'minLength'))} maxlength=${ifDefined(number(block, 'maxLength'))} pattern=${ifDefined(text(block, 'pattern') || undefined)}
                min=${ifDefined(number(block, 'min') ?? (text(block, 'min') || undefined))} max=${ifDefined(number(block, 'max') ?? (text(block, 'max') || undefined))}
                step=${ifDefined(number(block, 'step') ?? (input.kind === 'number' ? 'any' : undefined))}
                autocomplete=${ifDefined(autocomplete)} ?required=${required} aria-describedby=${described} aria-invalid=${ifDefined(invalid)} class=${FORM_INPUT}>`);
        }
    }
}
