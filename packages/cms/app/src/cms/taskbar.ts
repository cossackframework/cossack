/**
 * The taskbar signed-in users see along the bottom of every site page, as WordPress's toolbar
 * sits along the top: the site's logo opens the dashboard's navigation, the middle holds what
 * the current page offers (editing the entry, its SEO, managing its collection), then plugins'
 * links, a New menu and the user's menu. An entry its editor may change offers Live Edit (in place,
 * at `?edit`) and Edit (the dashboard's editor). Desktop and tablet only; the site editor's own bar
 * takes over in edit mode. The site layout renders it from a `server$` resource that
 * `site-taskbar.ts` builds; pages describe themselves through `c.set('cms.taskbar', …)`.
 * Client-safe: visitors never get it, signed-in users' pages ship it.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Avatar, DropdownMenu, Icon, Popover } from '@cossackframework/ui';
import type { IconEntry } from '@cossackframework/solar-icons/types';
import type { SeoView } from './seo-head';
import { icon } from './icons';
import { statusBadge } from './ui';

/** What a page tells the taskbar about itself, in its `init()`, before the layout renders. */
export interface TaskbarPage {
    /** The entry shown, when the user may edit it; `inPlace` when the page opens its editor on `?edit`. */
    entry?: { collection: string; id: string; status: string; dashboard: string; inPlace: boolean } | null;
    /** What engines see on the page, for the SEO inspector. */
    seo?: SeoView | null;
}

declare module 'hono' {
    interface ContextVariableMap {
        /** The page's context for the site taskbar, set by a site page's `init()`. */
        'cms.taskbar': TaskbarPage | undefined;
    }
}

export interface TaskbarLink { label: string; href: string; icon?: IconEntry }

/** The taskbar's view, built on the server for the signed-in user and the page they are on. */
export interface TaskbarView {
    site: { title: string; logo: string };
    /** The start menu: Dashboard, then the user's navigation modules. */
    start: TaskbarLink[];
    /** The current page's tools: the entry's status, the in-place editor's address, and links. */
    context: { status: string | null; edit: string | null; links: TaskbarLink[] };
    /** The New menu: an entry of every collection the user may create, and uploads. */
    create: TaskbarLink[];
    /** Links active plugins add through `ui.slots['site.taskbar']`. */
    plugins: TaskbarLink[];
    seo: SeoView | null;
    user: { name: string; email: string; avatar: string | null; links: TaskbarLink[] };
}

const ITEM = 'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground no-underline hover:bg-muted hover:text-foreground [&_svg]:size-4';
/**
 * Hidden while the page's editor is open: the bar keeps its first item (the start menu) and its
 * last (the user), and the editor's own controls take the middle (`SiteEditor.bar`, placed
 * between `[data-taskbar-start]` and `[data-taskbar-end]`). Leaving edit mode shows them again.
 */
const EDITING = '[body:has([data-site-editing])_&]:hidden';
const SEPARATOR = html`<span aria-hidden="true" class="mx-1 h-5 w-px bg-border"></span>`;

const menuLink = (link: TaskbarLink) => html`<a role="menuitem" tabindex="-1" href=${link.href} class="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-foreground no-underline hover:bg-muted">
    ${link.icon ? html`<span class="inline-flex text-muted-foreground [&_svg]:size-4">${component(Icon, { entry: link.icon, size: 16 })}</span>` : null}<span class="min-w-0 truncate">${__(link.label)}</span></a>`;

const barLink = (link: TaskbarLink) => html`<a href=${link.href} class=${ITEM}>${link.icon ? component(Icon, { entry: link.icon, size: 16 }) : null}${__(link.label)}</a>`;

export function taskbar(view: TaskbarView, handlers: { logout(): void; error?: string }): TemplateResult {
    const { context } = view;
    return html`<div aria-hidden="true" class="hidden h-10 md:block"></div>
    <nav data-cms-taskbar aria-label=${__('Site taskbar')} class="fixed inset-x-0 bottom-0 z-40 hidden h-10 items-center gap-0.5 border-t border-border bg-background/95 px-2 text-foreground backdrop-blur md:flex">
        <span data-taskbar-start class="inline-flex shrink-0">${component(DropdownMenu, {
            id: 'cms-taskbar-start', side: 'top', align: 'start', title: __('Dashboard'),
            trigger: html`<span class=${`${ITEM} font-medium text-foreground`}>
                <img src=${view.site.logo} alt="" width="20" height="20" loading="eager" class="h-5 w-auto max-w-20 shrink-0 object-contain">
                <span class="max-w-40 truncate">${view.site.title}</span></span>`,
        }, html`${view.start.map(menuLink)}`)}</span>
        <div class=${`contents ${EDITING}`}>
            ${SEPARATOR}
            ${context.status ? html`<span class="px-1 [&_span]:text-xs">${statusBadge(context.status)}</span>` : null}
            ${context.edit ? html`<a href=${context.edit} class="inline-flex h-7 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground no-underline hover:opacity-90">${__('Live Edit')}</a>` : null}
            ${context.links.map(barLink)}
            ${view.seo?.title ? seoInspector(view.seo) : null}
        </div>
        <span class="flex-1"></span>
        <div class=${`contents ${EDITING}`}>
            ${handlers.error ? html`<p role="alert" class="px-2 text-xs text-destructive">${handlers.error}</p>` : null}
            ${view.plugins.length ? html`${view.plugins.map(barLink)}${SEPARATOR}` : null}
            ${view.create.length ? component(DropdownMenu, {
                id: 'cms-taskbar-new', side: 'top', align: 'end',
                trigger: html`<span class=${ITEM}>${component(Icon, { entry: icon('pen-new-square'), size: 16 })}${__('New')}</span>`,
            }, html`${view.create.map(menuLink)}`) : null}
        </div>
        <span data-taskbar-end class="inline-flex shrink-0">${component(DropdownMenu, {
            id: 'cms-taskbar-user', side: 'top', align: 'end',
            trigger: html`<span class=${ITEM}>${component(Avatar, { src: view.user.avatar ?? undefined, alt: '', size: 24 })}<span class="max-w-40 truncate text-foreground">${view.user.name}</span></span>`,
        }, html`
            <div class="px-3 py-2">
                <div class="text-sm font-medium">${view.user.name}</div>
                <div class="text-xs text-muted-foreground">${view.user.email}</div>
            </div>
            <div class="my-1 h-px bg-border"></div>
            ${view.user.links.map(menuLink)}
            <div class="my-1 h-px bg-border"></div>
            <button type="button" role="menuitem" tabindex="-1" @click=${() => handlers.logout()}
                class="flex w-full cursor-pointer items-center gap-2 rounded-sm border-none bg-transparent px-3 py-2 text-left text-sm text-destructive hover:bg-muted">${__('Log out')}</button>
        `)}</span>
    </nav>`;
}

/** What engines see on this page: the resolved title, description, robots, canonical and the structured data types. */
function seoInspector(seo: SeoView): TemplateResult {
    let types: string[] = [];
    try { types = ((JSON.parse(seo.jsonLd) as { '@graph'?: { '@type'?: string }[] })['@graph'] ?? []).map(node => node['@type'] ?? '').filter(Boolean); } catch { /* no graph */ }
    const row = (label: string, value: string) => value ? html`<div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-2"><dt class="text-muted-foreground">${label}</dt><dd class="min-w-0 break-words text-foreground">${value}</dd></div>` : null;
    return component(Popover, {
        id: 'cms-taskbar-seo', side: 'top', align: 'start', class: ITEM,
        trigger: html`${component(Icon, { entry: icon('magnifier'), size: 16 })}${__('SEO')}`,
        contentProps: { 'aria-label': __('What search engines see'), class: 'w-[min(28rem,90vw)] text-xs' },
    }, html`<dl class="space-y-1.5">
        ${row(__('Title'), seo.title)}
        ${row(__('Description'), seo.description || `(${__('none')})`)}
        ${row(__('Robots'), seo.robots || `(${__('index, follow')})`)}
        ${row(__('Canonical'), seo.canonical)}
        ${row(__('Image'), seo.image || `(${__('none')})`)}
        ${row(__('Schema'), types.join(', ') || `(${__('none')})`)}
        ${seo.markdownUrl ? html`<div class="pt-1"><a href=${seo.markdownUrl} target="_blank" rel="noopener" class="text-primary hover:underline">${__('View as Markdown')}</a></div>` : null}
    </dl>`);
}
