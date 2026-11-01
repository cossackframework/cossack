/** The parts every dashboard screen shares: its heading, link buttons, messages, and its Help and Screen options panels. */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Alert } from '@cossackframework/ui';

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

const BUTTON = {
    primary: 'bg-primary text-primary-foreground hover:opacity-90',
    outline: 'border border-border text-foreground hover:bg-muted',
} as const;

/** A link that looks like a button, such as "New post" beside a list's title. */
export function linkButton(label: string, href: string, variant: keyof typeof BUTTON = 'primary', options: { size?: 'sm' | 'md' } = {}): TemplateResult {
    const size = options.size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm';
    return html`<a href=${href} class=${`inline-flex items-center justify-center rounded-md font-medium no-underline transition-colors ${size} ${BUTTON[variant]}`}>${label}</a>`;
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

/** A screen's panel the taskbar opens: a native popover above the taskbar's buttons, dismissed by a click outside or Escape. */
function screenPanel(id: string, title: string, body: TemplateResult): TemplateResult {
    return html`<div id=${id} popover="auto" aria-labelledby=${`${id}-title`} class="fixed inset-auto bottom-12 right-3 m-0 w-[min(26rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg">
        <h2 id=${`${id}-title`} class="mb-2 text-sm font-semibold text-foreground">${title}</h2>
        <div class="space-y-2 text-muted-foreground [&_a]:text-primary [&_a]:hover:underline [&_b]:font-medium [&_b]:text-foreground">${body}</div>
    </div>`;
}

/** The screen's Help, opened from the taskbar's Help button: what the screen shows and what each part does. */
export function screenHelp(body: TemplateResult): TemplateResult {
    return screenPanel('screen-help', __('Help'), body);
}

/** The screen's options, opened from the taskbar's Screen options button: controls that change how the screen shows its content. */
export function screenOptions(body: TemplateResult): TemplateResult {
    return screenPanel('screen-options', __('Screen options'), body);
}

/** What a screen's options keep: the columns hidden, by ID, and the items a page lists. */
export interface ScreenPreferences {
    hidden: string[];
    perPage: number;
}

/** Items per page a screen's options accept. */
export const PER_PAGE = { min: 1, max: 100 } as const;

/** The cookie a screen keeps its options in, per browser, as the sidebar keeps its state; `screen` names the screen, such as `entries-posts`. */
export function screenCookie(screen: string): string {
    return `cs-screen-${screen.replace(/[^a-z0-9-]/gi, '_')}`;
}

/** A screen's options from its cookie's value; the defaults for whatever it lacks or does not parse. */
export function screenPreferences(value: string | undefined, defaults: ScreenPreferences): ScreenPreferences {
    let parsed: unknown;
    for (const text of [value, safeDecode(value)]) {
        try { parsed = JSON.parse(text ?? ''); break; } catch { /* try the next reading */ }
    }
    const saved = parsed && typeof parsed === 'object' ? parsed as Partial<Record<keyof ScreenPreferences, unknown>> : {};
    const hidden = Array.isArray(saved.hidden) ? saved.hidden.filter((id): id is string => typeof id === 'string' && id.length <= 100).slice(0, 50) : defaults.hidden;
    return { hidden, perPage: clampPerPage(saved.perPage, defaults.perPage) };
}

/** Items per page within {@link PER_PAGE}; `fallback` for anything that is not a number. */
export function clampPerPage(value: unknown, fallback: number): number {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) && number > 0 ? Math.min(Math.max(number, PER_PAGE.min), PER_PAGE.max) : fallback;
}

/** Keep a screen's options in its cookie for a year. Client only. */
export function saveScreenPreferences(screen: string, preferences: ScreenPreferences): void {
    if (typeof document === 'undefined') return;
    try {
        document.cookie = `${screenCookie(screen)}=${encodeURIComponent(JSON.stringify(preferences))}; Path=/dashboard; Max-Age=31536000; SameSite=Lax`;
    } catch { /* cookies unavailable */ }
}

function safeDecode(value: string | undefined): string | undefined {
    try { return value === undefined ? undefined : decodeURIComponent(value); } catch { return undefined; }
}
