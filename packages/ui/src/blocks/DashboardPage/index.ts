/**
 * The parts every dashboard screen shares, for the application's screens and for plugin
 * screens alike: its heading, link buttons and messages. A screen built from these looks like
 * the rest of the dashboard without copying its markup.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Alert } from '../../components/Alert.js';

export interface PageHeaderOptions {
    /** One line under the title. */
    description?: string;
    /** Controls on the right, such as a filter or "Export". */
    actions?: TemplateResult | null;
    /** Controls beside the title, as WordPress puts "Add New" next to "Posts". */
    titleActions?: TemplateResult | null;
}

/** The heading of a screen: its title, an optional description, and its actions. */
export function pageHeader(title: string, options: PageHeaderOptions = {}): TemplateResult {
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

const LINK_BUTTON = {
    primary: 'bg-primary text-primary-foreground hover:opacity-90',
    outline: 'border border-border text-foreground hover:bg-muted',
} as const;

export type LinkButtonVariant = keyof typeof LINK_BUTTON;

/** A link that looks like a button, such as "New post" beside a list's title. */
export function linkButton(label: string, href: string, variant: LinkButtonVariant = 'primary', options: { size?: 'sm' | 'md' } = {}): TemplateResult {
    const size = options.size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm';
    return html`<a href=${href} class=${`inline-flex items-center justify-center rounded-md font-medium no-underline transition-colors ${size} ${LINK_BUTTON[variant]}`}>${label}</a>`;
}

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

const NOTICE = {
    info: { variant: 'default', text: 'text-foreground' },
    success: { variant: 'success', text: 'text-success-text' },
    warning: { variant: 'warning', text: 'text-warning-text' },
    error: { variant: 'destructive', text: 'text-destructive' },
} as const;

/**
 * A screen's message as an Alert, where the screen shows it: the outcome of what was just done,
 * or why it failed. Errors are announced at once, the rest politely. Screens show messages
 * this way, never as toasts, so each stays where it belongs until the next action.
 */
export function notice(text: string, tone: NoticeTone = 'info'): TemplateResult {
    const { variant, text: color } = NOTICE[tone];
    return component(Alert, { variant, announcement: tone === 'error' ? 'assertive' : 'polite', 'data-notice': tone }, html`<span class=${color}>${text}</span>`);
}
