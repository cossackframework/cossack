/**
 * The Settings screens' frame: the groups in a vertical list beside the page, and a group's
 * subpages (such as SEO → Crawlers and IndexNow) as tabs above its form.
 */
import { html, type TemplateResult } from '@cossackframework/renderer';
import { PERMISSIONS } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';

/** A settings page: a group's, or a screen of its own such as Permalinks. */
export interface SettingsLink {
    id: string;
    label: string;
    href: string;
    /** The group it is a subpage of. */
    parent?: string;
}

/** The settings pages behind `cms:settings`: the groups in order, then Permalinks. Appearance groups have their own screens. */
export function settingsLinks(cms: CmsHost): SettingsLink[] {
    return [
        ...cms.settings.groups.filter(group => (group.permission ?? PERMISSIONS.manageSettings) === PERMISSIONS.manageSettings)
            .map(group => ({ id: group.id, label: group.label, href: `/dashboard/settings/${group.id}`, ...(group.parent ? { parent: group.parent } : {}) })),
        { id: 'permalinks', label: 'Permalinks', href: '/dashboard/settings/permalinks' },
    ];
}

/** The page `current` inside the frame: the navigation, the subpage tabs of its group, then `body`. */
export function settingsFrame(links: readonly SettingsLink[], current: string, body: TemplateResult): TemplateResult {
    const here = links.find(link => link.id === current);
    const top = here?.parent && links.some(link => link.id === here.parent) ? here.parent : current;
    const subpages = links.filter(link => link.parent === top);
    const tabs = subpages.length ? [links.find(link => link.id === top)!, ...subpages] : [];
    const item = (link: SettingsLink) => html`<li><a href=${link.href} aria-current=${link.id === top ? 'page' : 'false'}
        class=${`block rounded-md px-3 py-1.5 text-sm no-underline ${link.id === top ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`}>${__(link.label)}</a></li>`;
    return html`<div class="grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label=${__('Settings')} class="md:sticky md:top-4 md:self-start">
            <ul class="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">${links.filter(link => !link.parent || !links.some(entry => entry.id === link.parent)).map(item)}</ul>
        </nav>
        <div class="min-w-0 max-w-3xl space-y-6">
            ${tabs.length ? html`<nav aria-label=${`${__(tabs[0]!.label)} ${__('pages')}`} class="flex flex-wrap gap-1 border-b border-border">
                ${tabs.map(link => html`<a href=${link.href} aria-current=${link.id === current ? 'page' : 'false'}
                    class=${`-mb-px border-b-2 px-3 py-2 text-sm no-underline ${link.id === current ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>${__(link.label)}</a>`)}
            </nav>` : null}
            ${body}
        </div>
    </div>`;
}
