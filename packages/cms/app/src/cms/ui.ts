/** Small view helpers shared by the CMS dashboard screens. */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { component, html, ifDefined, type TemplateResult } from '@cossackframework/renderer';
import { Badge, Icon, Tooltip } from '@cossackframework/ui';
import { icon } from './icons';

/**
 * The heading of a screen. `titleActions` sit beside the title, as WordPress puts "Add New"
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

// Tab helpers live with the shared dashboard shell, which the users screen uses without the CMS.
export { countBadge, rememberTab, tabFromQuery } from '../dashboard/tabs';

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

export type MetaBoxProps = {
    title: string;
    body: TemplateResult | TemplateResult[] | null;
    /** The heading's ID; also the key the open state is remembered under. */
    id?: string;
    /** Something beside the title, such as a count or a link. */
    extra?: TemplateResult | null;
    /** Start collapsed. */
    collapsed?: boolean;
};

/**
 * A boxed section like a WordPress meta box: its heading toggles the body with an animated
 * collapse, and the state is remembered per box in this browser.
 */
@Component()
export class MetaBox extends Cossack {
    declare props: MetaBoxProps;
    /** The visitor's choice; null until they toggle or a remembered state loads. */
    @ClientState() private open: boolean | null = null;

    private get key(): string {
        return `cms.box.${this.props.id ?? this.props.title}`;
    }

    private get isOpen(): boolean {
        return this.open ?? this.props.collapsed !== true;
    }

    onMount() {
        try {
            const stored = localStorage.getItem(this.key);
            if (stored === 'open' || stored === 'closed') this.open = stored === 'open';
        } catch { /* storage unavailable */ }
    }

    @Client()
    toggle() {
        this.open = !this.isOpen;
        try { localStorage.setItem(this.key, this.open ? 'open' : 'closed'); } catch { /* storage unavailable */ }
    }

    render(): TemplateResult {
        const open = this.isOpen;
        const heading = this.props.id ?? '';
        const panel = heading ? `${heading}-panel` : '';
        return html`<section class="cs-meta-box rounded-lg border border-border bg-card" aria-labelledby=${ifDefined(heading || undefined)}>
            <h2 id=${ifDefined(heading || undefined)} class=${`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-foreground ${open ? 'border-b border-border' : ''}`}>
                <button type="button" class="flex min-w-0 flex-1 items-center gap-2 border-none bg-transparent p-0 text-left text-sm font-semibold text-foreground cursor-pointer"
                    aria-expanded=${open ? 'true' : 'false'} aria-controls=${ifDefined(panel || undefined)} aria-label=${`${open ? __('Collapse') : __('Expand')} ${this.props.title}`} @click=${() => this.toggle()}>
                    <span class=${`inline-flex shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none [&_svg]:size-4 ${open ? 'rotate-90' : ''}`} aria-hidden="true">${component(Icon, { entry: icon('alt-arrow-right'), size: 16 })}</span>
                    <span class="min-w-0 flex-1 truncate">${this.props.title}</span>
                </button>
                ${this.props.extra ?? null}
            </h2>
            <div id=${ifDefined(panel || undefined)} class=${`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`} ?inert=${!open} aria-hidden=${open ? 'false' : 'true'}>
                <div class="min-h-0 overflow-hidden"><div class="space-y-3 p-4">${this.props.body}</div></div>
            </div>
        </section>`;
    }
}

/** A boxed section in the editor's sidebar, like WordPress meta boxes: collapsible, with its state remembered. */
export function box(title: string, body: TemplateResult | TemplateResult[] | null, options: { id?: string; extra?: TemplateResult | null; collapsed?: boolean } = {}): TemplateResult {
    return component(MetaBox, { title, body, ...options });
}

/**
 * Who made a plugin or theme: the author's name, and their website as a link showing its
 * address, so both are read without hovering. Nothing when the manifest names no author.
 */
export function authorLine(author: string, url: string | null | undefined): TemplateResult | null {
    if (!author && !url) return null;
    let host = '';
    try { host = url ? new URL(url).host.replace(/^www\./, '') : ''; } catch { host = url ?? ''; }
    return html`<p class="text-xs text-muted-foreground">${author ? html`${__('By')} <span class="text-foreground">${author}</span>` : null}${url ? html`${author ? ' · ' : ''}<a href=${url} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">${host}</a>` : null}</p>`;
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


