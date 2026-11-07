/** Navigation for the scrolling Settings page and its JSON editor. */
import { component, html, type TemplateResult } from '@cossackframework/renderer';
import { Icon } from '@cossackframework/ui';
import { PERMISSIONS } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { icon } from './icons';
import { settingsNavigation } from './settings-draft';
import { searchSettings, settingsSectionHref, type SettingsSearchEntry } from './settings-search';

export interface SettingsLink {
    id: string;
    label: string;
    href: string;
    parent?: string;
    icon?: string;
    /** Matching settings in this group and its descendants. */
    count?: number;
}

/** Settings groups in page order. Plugins each get a child beneath Plugins; `network` adds the main site's Network section last. */
export function settingsLinks(cms: CmsHost, options: { network?: boolean } = {}): SettingsLink[] {
    const groups = cms.settings.groups.filter(group => (group.permission ?? PERMISSIONS.manageSettings) === PERMISSIONS.manageSettings);
    return [
        ...groups.filter(group => !group.plugin).map(group => ({ id: group.id, label: group.label, href: settingsSectionHref(group.id),
            ...(group.parent ? { parent: group.parent } : {}), ...(group.icon ? { icon: group.icon } : {}) })),
        { id: 'permalinks', label: 'Permalinks', href: settingsSectionHref('permalinks'), icon: 'link' },
        { id: 'plugins', label: 'Plugins', href: settingsSectionHref('plugins'), icon: 'widget' },
        ...groups.filter(group => group.plugin).map(group => ({ id: group.id, label: group.label, href: settingsSectionHref(group.id), parent: 'plugins', icon: 'plug-circle' })),
        ...(options.network ? [{ id: 'network', label: 'Network', href: settingsSectionHref('network'), icon: 'global' }] : []),
    ];
}

/** Keep matching groups and their ancestors, counting each matching field once per ancestor. */
export function filterSettingsLinks(links: readonly SettingsLink[], entries: readonly SettingsSearchEntry[], query: string): SettingsLink[] {
    const byId = new Map(links.map(link => [link.id, link]));
    const counts = new Map<string, number>();
    for (const entry of searchSettings(entries, query)) {
        let group: string | undefined = entry.groupId;
        const visited = new Set<string>();
        while (group && byId.has(group) && !visited.has(group)) {
            visited.add(group);
            counts.set(group, (counts.get(group) ?? 0) + 1);
            group = byId.get(group)!.parent;
        }
    }
    return links.filter(link => !query.trim() || counts.has(link.id)).map(link => ({ ...link, count: counts.get(link.id) ?? 0 }));
}

/** Error links target the persistent section shell, including sections whose controls are deferred. */
export function settingsErrorSummary(errors: Readonly<Record<string, string>>, onNavigate: (event: MouseEvent) => void = settingsNavigation): TemplateResult | null {
    const entries = Object.entries(errors);
    if (!entries.length) return null;
    return html`<ul role="alert" class="space-y-1 text-sm text-destructive">${entries.map(([path, error]) => {
        const separator = path.lastIndexOf('.');
        const namespace = path.slice(0, separator);
        const destination = separator < 1 ? '/dashboard/settings/json' : settingsSectionHref(namespace);
        return html`<li><a href=${destination} data-settings-error-group=${namespace} @click=${onNavigate} class="underline"><code>${path}</code></a>: ${error}</li>`;
    })}</ul>`;
}

export interface SettingsFrameOptions {
    entries?: readonly SettingsSearchEntry[];
    query?: string;
    onNavigate?: (event: MouseEvent) => void;
}

/** The navigation grows with the page and occupies at least a viewport on desktop. */
export function settingsFrame(links: readonly SettingsLink[], current: string, body: TemplateResult, options: SettingsFrameOptions = {}): TemplateResult {
    const query = options.query ?? '';
    const menu = options.entries ? filterSettingsLinks(links, options.entries, query) : links;
    const onNavigate = options.onNavigate ?? settingsNavigation;
    const ids = new Set(menu.map(link => link.id));
    const byParent = new Map<string, SettingsLink[]>();
    for (const link of menu) if (link.parent) {
        const siblings = byParent.get(link.parent) ?? [];
        siblings.push(link);
        byParent.set(link.parent, siblings);
    }
    const roots = menu.filter(link => !link.parent || !ids.has(link.parent));
    const item = (link: SettingsLink, ancestors: readonly string[] = []): TemplateResult => {
        const children = (byParent.get(link.id) ?? []).filter(entry => !ancestors.includes(entry.id) && entry.id !== link.id);
        return html`<li data-settings-menu-parent=${link.id} class="min-w-0">
            <a href=${link.href} data-settings-menu-group=${link.id} data-settings-count=${link.count} @click=${onNavigate}
                aria-current=${link.id === current ? 'location' : 'false'}
                class=${`flex items-center gap-2 rounded-md px-3 py-2 text-sm no-underline [&_svg]:size-4 ${link.id === current ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'}`}>
                <span aria-hidden="true" class="inline-flex shrink-0">${component(Icon, { entry: icon(link.icon ?? 'settings', 'settings'), size: 16 })}</span>
                <span class="min-w-0 flex-1 break-words">${__(link.label)}</span>
                ${query.trim() && link.count !== undefined ? html`<span aria-label=${`${link.count} ${link.count === 1 ? __('setting') : __('settings')}`} class="shrink-0 rounded bg-background px-1.5 py-0.5 text-xs tabular-nums">${link.count}</span>` : null}
            </a>
            ${children.length ? html`<ul class="ms-5 space-y-0.5 border-s border-border ps-1">${children.map(child => item(child, [...ancestors, link.id]))}</ul>` : null}
        </li>`;
    };
    return html`<div data-subnav class="grid min-h-screen min-w-0 content-start md:grid-cols-[13rem_minmax(0,1fr)] md:content-stretch">
        <nav aria-label=${__('Settings')} class="self-stretch border-b border-border bg-muted/40 md:min-h-screen md:border-b-0 md:border-e">
            <div class="md:sticky md:overflow-y-auto" style="top:var(--settings-toolbar-height, 56px);max-height:calc(100dvh - var(--settings-toolbar-height, 56px))">
                <ul class="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-x-visible">${roots.map(link => item(link))}</ul>
                ${menu.length ? null : html`<p role="status" class="px-4 py-3 text-sm text-muted-foreground">${__('No settings match your search.')}</p>`}
            </div>
        </nav>
        <div class="min-w-0 p-6 sm:p-8"><div class="max-w-3xl space-y-6">${body}</div></div>
    </div>`;
}
