/** Render helpers for the network pages; client-safe, unlike `./network-ui`. */
import type { SiteStatus } from '@cossackframework/cms/server';
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Icon } from '@cossackframework/ui';
import { icon } from './icons';
import { CONTROL } from './ui';

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

/** A labelled input for the network's plain forms. */
export function field(name: string, label: string, options: { value?: string; type?: 'text' | 'email' | 'password'; required?: boolean; hint?: string; placeholder?: string } = {}): TemplateResult {
    return html`<div class="space-y-1.5">
        <label for=${`network-${name}`} class="block text-sm font-medium text-foreground">${label}</label>
        <input id=${`network-${name}`} name=${name} type=${options.type ?? 'text'} .value=${options.value ?? ''} ?required=${options.required ?? false} placeholder=${options.placeholder ?? ''} class=${CONTROL}>
        ${options.hint ? html`<p class="text-xs text-muted-foreground">${options.hint}</p>` : null}
    </div>`;
}

/** A one-button form posting an action, such as archiving a site. */
export function actionButton(action: string, label: string, fields: Record<string, string> = {}, options: { danger?: boolean } = {}): TemplateResult {
    return html`<form method="post" class="inline">
        <input type="hidden" name="action" value=${action}>
        ${Object.entries(fields).map(([name, value]) => html`<input type="hidden" name=${name} value=${value}>`)}
        <button type="submit" class=${`rounded-md border px-2.5 py-1 text-xs font-medium cursor-pointer bg-background ${options.danger ? 'border-destructive/40 text-destructive hover:bg-destructive/10' : 'border-border text-foreground hover:bg-muted'}`}>${label}</button>
    </form>`;
}

export const SUBMIT = 'inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground border-none cursor-pointer';
