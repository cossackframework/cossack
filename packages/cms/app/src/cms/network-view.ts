/** Render helpers for the network pages; client-safe, unlike `./network-ui`. */
import type { SiteStatus } from '@cossackframework/cms/server';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Button, Field, Icon, Input } from '@cossackframework/ui';
import { icon } from './icons';

const STATUS: Record<SiteStatus, string> = { creating: 'Being created', active: 'Active', archived: 'Archived', deleted: 'Deleted' };

export function siteStatus(status: SiteStatus): TemplateResult {
    const tone = status === 'active' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : status === 'deleted' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground';
    return html`<span class=${`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>${__(STATUS[status])}</span>`;
}

/** A site's icon beside its name, or a globe when neither the site nor the network has one. */
export function siteIcon(url: string): TemplateResult {
    return url ? html`<img src=${url} alt="" width="20" height="20" loading="lazy" data-site-icon class="mt-0.5 size-5 shrink-0 rounded-sm object-contain">`
        : html`<span aria-hidden="true" data-site-icon class="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-5">${component(Icon, { entry: icon('global'), size: 20 })}</span>`;
}

/** A labelled input for the network's plain forms, which post without JavaScript. */
export function field(name: string, label: string, options: { value?: string; type?: 'text' | 'email' | 'password'; required?: boolean; hint?: string; placeholder?: string } = {}): TemplateResult {
    return component(Field, { label, for: `network-${name}`, ...(options.hint ? { hint: options.hint } : {}), ...(options.required ? { required: true } : {}),
        control: attributes => component(Input, { ...attributes, name, type: options.type ?? 'text', '.value': options.value ?? '', ...(options.placeholder ? { placeholder: options.placeholder } : {}) }) });
}

/** A one-button form posting an action, such as archiving a site. */
export function actionButton(action: string, label: string, fields: Record<string, string> = {}, options: { danger?: boolean } = {}): TemplateResult {
    return html`<form method="post" class="inline">
        <input type="hidden" name="action" value=${action}>
        ${Object.entries(fields).map(([name, value]) => html`<input type="hidden" name=${name} value=${value}>`)}
        ${component(Button, { type: 'submit', size: 'sm', variant: options.danger ? 'destructive' : 'outline' }, label)}
    </form>`;
}

/** The submit button of a plain form. */
export function submitButton(label: string): TemplateResult {
    return component(Button, { type: 'submit' }, label);
}
