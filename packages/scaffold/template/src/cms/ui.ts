/** Small view helpers shared by the CMS dashboard screens. */
import { component, html, ifDefined, type TemplateResult } from '@cossackframework/renderer';
import { Badge, Icon, Tooltip } from '@cossackframework/ui';
import { icon } from './icons';

/**
 * The heading of a screen. `titleActions` sit beside the title, as WordPress puts "Add new"
 * next to "Posts"; `actions` go to the right.
 */
export function pageHeader(title: string, options: { description?: string; actions?: TemplateResult | null; titleActions?: TemplateResult | null } = {}): TemplateResult {
    return html`<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
            <div class="flex flex-wrap items-center gap-3">
                <h1 class="text-2xl font-bold text-foreground">${title}</h1>
                ${options.titleActions ?? null}
            </div>
            ${options.description ? html`<p class="mt-1 text-sm text-muted-foreground">${options.description}</p>` : null}
        </div>
        ${options.actions ? html`<div class="flex flex-wrap items-center gap-2">${options.actions}</div>` : null}
    </div>`;
}

/** A small square button with an icon alone; its label is a tooltip and its accessible name. */
export function iconButton(id: string, name: string, label: string, run: (event: Event) => void, options: { disabled?: boolean; danger?: boolean; pressed?: boolean; class?: string; size?: 'sm' | 'md' } = {}): TemplateResult {
    const size = options.size === 'md' ? 'h-8 w-8' : 'h-7 w-7';
    const tone = options.danger ? 'hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive' : 'hover:bg-muted hover:text-foreground';
    return component(Tooltip, { id: `${id}-tip`, label }, html`<button type="button" aria-describedby=${`${id}-tip`} aria-label=${label} ?disabled=${options.disabled === true}
        aria-pressed=${ifDefined(options.pressed === undefined ? undefined : options.pressed ? 'true' : 'false')}
        class=${`inline-flex ${size} items-center justify-center rounded border border-border bg-background text-muted-foreground cursor-pointer disabled:cursor-default disabled:opacity-40 [&_svg]:size-4 ${tone} ${options.class ?? ''}`}
        @click=${run}>${component(Icon, { entry: icon(name), size: 16 })}</button>`);
}

const BUTTON = {
    primary: 'bg-primary text-primary-foreground hover:opacity-90',
    outline: 'border border-border text-foreground hover:bg-muted',
} as const;

export function linkButton(label: string, href: string, variant: keyof typeof BUTTON = 'primary', options: { size?: 'sm' | 'md' } = {}): TemplateResult {
    const size = options.size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm';
    return html`<a href=${href} class=${`inline-flex items-center justify-center rounded-md font-medium no-underline transition-colors ${size} ${BUTTON[variant]}`}>${label}</a>`;
}

/** A count beside a label, such as a tab's items. */
export function countBadge(count: number): TemplateResult {
    return html`<span class="ml-1.5 inline-flex align-middle">${component(Badge, { variant: 'secondary' }, String(count))}</span>`;
}

/** Labels of entry statuses. */
export const STATUS_LABELS: Record<string, string> = { draft: 'Draft', pending: 'Pending review', scheduled: 'Scheduled', published: 'Published', trash: 'Trash' };

export function statusBadge(status: unknown): TemplateResult | null {
    if (status === 'published') return component(Badge, { variant: 'success' }, __('Published'));
    if (status === 'scheduled') return component(Badge, { variant: 'default' }, __('Scheduled'));
    if (status === 'pending') return component(Badge, { variant: 'warning' }, __('Pending review'));
    if (status === 'draft') return component(Badge, { variant: 'secondary' }, __('Draft'));
    if (status === 'trash') return component(Badge, { variant: 'destructive' }, __('Trash'));
    return null;
}

/** A notice line; errors use role=alert. */
export function notice(text: string, tone: 'info' | 'success' | 'error' = 'info'): TemplateResult {
    const tones = { info: 'border-border text-foreground', success: 'border-emerald-500/40 text-foreground bg-emerald-500/5', error: 'border-destructive/50 text-destructive bg-destructive/5' };
    return html`<p role=${tone === 'error' ? 'alert' : 'status'} class=${`rounded-md border px-3 py-2 text-sm ${tones[tone]}`}>${text}</p>`;
}

/** `2026/10/16 at 3:45 pm` in UTC, as dashboard lists show times. */
export function shortDate(value: unknown): string {
    if (typeof value !== 'number') return '';
    const date = new Date(value);
    const pad = (part: number) => String(part).padStart(2, '0');
    const hours = date.getUTCHours();
    return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())} ${__('at')} ${hours % 12 || 12}:${pad(date.getUTCMinutes())} ${hours < 12 ? 'am' : 'pm'}`;
}

export const CONTROL = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

/** A boxed section in the editor's sidebar, like WordPress meta boxes. */
export function box(title: string, body: TemplateResult | TemplateResult[] | null, options: { id?: string } = {}): TemplateResult {
    return html`<section class="rounded-lg border border-border bg-card" aria-labelledby=${options.id ?? ''}>
        <h2 id=${options.id ?? ''} class="border-b border-border px-4 py-2.5 text-sm font-semibold text-foreground">${title}</h2>
        <div class="space-y-3 p-4">${body}</div>
    </section>`;
}

/** A stable hue from a name, for generated artwork. */
function hue(name: string): number {
    let hash = 0;
    for (const character of name) hash = (hash * 31 + character.codePointAt(0)!) % 360;
    return hash;
}

function initials(label: string): string {
    return label.split(/[\s-]+/).filter(Boolean).slice(0, 2).map(word => [...word][0]!.toUpperCase()).join('') || '?';
}

/**
 * A plugin's or theme's logo or cover from its `assets/`, or artwork generated from its name
 * when it ships none, so every card stays recognizable.
 */
export function artwork(kind: 'logo' | 'cover', url: string | null, name: string, label: string, className = ''): TemplateResult {
    if (url) return html`<img src=${url} alt="" loading="lazy" class=${`${kind === 'logo' ? 'size-12 rounded-lg' : 'w-full'} object-cover ${className}`}>`;
    const tone = hue(name);
    if (kind === 'logo') return html`<span aria-hidden="true" class=${`flex size-12 shrink-0 items-center justify-center rounded-lg text-base font-semibold text-white ${className}`}
        style=${`background: hsl(${tone} 55% 45%)`}>${initials(label)}</span>`;
    return html`<div aria-hidden="true" class=${`flex w-full items-center justify-center ${className}`}
        style=${`background: linear-gradient(135deg, hsl(${tone} 70% 58%), hsl(${(tone + 45) % 360} 65% 38%))`}>
        <span class="rounded-lg bg-white/15 px-4 py-2 text-lg font-semibold text-white backdrop-blur-sm">${label}</span>
    </div>`;
}
