/**
 * The Settings screens' frame: the groups in a vertical list beside the page, and a group's
 * subpages (such as SEO → Crawlers and IndexNow) as tabs above its form.
 */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Icon } from '@cossackframework/ui';
import { PERMISSIONS } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { icon } from './icons';

/** A settings page: a group's, or a screen of its own such as Permalinks. */
export interface SettingsLink {
    id: string;
    label: string;
    href: string;
    /** The group it is a subpage of. */
    parent?: string;
    /** Its icon in the navigation; a gear when it names none. */
    icon?: string;
}

/** The settings pages behind `cms:settings`: the groups in order, then Permalinks. Appearance groups have their own screens. */
export function settingsLinks(cms: CmsHost): SettingsLink[] {
    return [
        ...cms.settings.groups.filter(group => (group.permission ?? PERMISSIONS.manageSettings) === PERMISSIONS.manageSettings)
            .map(group => ({ id: group.id, label: group.label, href: `/dashboard/settings/${group.id}`, ...(group.parent ? { parent: group.parent } : {}), ...(group.icon ? { icon: group.icon } : {}) })),
        { id: 'permalinks', label: 'Permalinks', href: '/dashboard/settings/permalinks', icon: 'link' },
    ];
}

/** The page `current` inside the frame: the navigation, the subpage tabs of its group, then `body`. */
export function settingsFrame(links: readonly SettingsLink[], current: string, body: TemplateResult): TemplateResult {
    const here = links.find(link => link.id === current);
    const top = here?.parent && links.some(link => link.id === here.parent) ? here.parent : current;
    const subpages = links.filter(link => link.parent === top);
    const tabs = subpages.length ? [links.find(link => link.id === top)!, ...subpages] : [];
    const item = (link: SettingsLink) => html`<li><a href=${link.href} aria-current=${link.id === top ? 'page' : 'false'}
        class=${`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm no-underline [&_svg]:size-4 ${link.id === top ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}`}>
        <span aria-hidden="true" class="inline-flex shrink-0">${component(Icon, { entry: icon(link.icon ?? 'settings', 'settings'), size: 16 })}</span>${__(link.label)}</a></li>`;
    // A secondary sidebar against the dashboard's own and as tall as the page (the layout drops its
    // padding around `data-subnav`), in a lighter panel so the two levels read apart. Its header
    // lines up with the dashboard sidebar's.
    return html`<div data-subnav class="grid min-w-0 content-start md:grid-cols-[13rem_minmax(0,1fr)] md:content-normal">
        <nav aria-label=${__('Settings')} class="border-b border-border bg-muted/40 md:border-b-0 md:border-e">
            <div class="md:sticky md:top-0">
                <p class="hidden h-14 items-center border-b border-border px-4 text-sm font-semibold text-foreground md:flex">${__('Settings')}</p>
                <ul class="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible">${links.filter(link => !link.parent || !links.some(entry => entry.id === link.parent)).map(item)}</ul>
            </div>
        </nav>
        <div class="min-w-0 p-6 sm:p-8"><div class="max-w-3xl space-y-6">
            ${tabs.length ? html`<nav aria-label=${`${__(tabs[0]!.label)} ${__('pages')}`} class="flex flex-wrap gap-1 border-b border-border">
                ${tabs.map(link => html`<a href=${link.href} aria-current=${link.id === current ? 'page' : 'false'}
                    class=${`-mb-px border-b-2 px-3 py-2 text-sm no-underline ${link.id === current ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>${__(link.label)}</a>`)}
            </nav>` : null}
            ${body}
        </div></div>
    </div>`;
}
