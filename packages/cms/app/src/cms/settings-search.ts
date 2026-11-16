/** Searchable settings declarations. Saved values never enter the search index. */
import { PERMISSIONS } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';

export interface SettingsSearchEntry {
    id: string;
    groupId: string;
    name: string;
    label: string;
    group: string;
    description: string;
    href: string;
    /** Lowercase labels, descriptions, and keys used for matching. */
    text: string;
}

/** The section shell is present before its field controls are mounted. */
export function settingsSectionId(groupId: string): string { return `settings-${encodeURIComponent(groupId)}`; }

export function settingsSectionHref(groupId: string): string { return `/dashboard/settings#${encodeURIComponent(settingsSectionId(groupId))}`; }

/** The calling page requires cms:settings. Include every group served by Settings, including non-JSON groups; `network` for the Network section. */
export function settingsSearchEntries(cms: CmsHost, options: { network?: boolean } = {}): SettingsSearchEntry[] {
    const groups = cms.settings.groups.filter(group => (group.permission ?? PERMISSIONS.manageSettings) === PERMISSIONS.manageSettings);
    const entries: SettingsSearchEntry[] = [];
    for (const group of groups) {
        const parent = groups.find(entry => entry.id === group.parent);
        const label = [parent?.label, group.plugin ? 'Plugins' : '', group.label].filter(Boolean).join(' / ');
        for (const [name, field] of Object.entries(group.fields)) {
            const section = group.sections?.find(entry => entry.id === field.section);
            const id = `${group.id}.${name}`;
            entries.push({ id, groupId: group.id, name, label: field.label ?? name, group: label, description: field.description ?? '',
                href: settingsSectionHref(group.id),
                text: [id, label, group.plugin, group.description, section?.id, section?.label, section?.description, field.label, field.description,
                    ...(field.values ?? []), ...Object.entries(field.choices ?? {}).flat()].filter(Boolean).join(' ').toLowerCase() });
        }
    }

    // Permalinks change collection and taxonomy declarations through their own form.
    const permalink = (id: string, label: string, description: string, keywords = ''): SettingsSearchEntry => ({
        id: `permalinks.${id}`, groupId: 'permalinks', name: id, label, group: 'Permalinks', description, href: settingsSectionHref('permalinks'),
        text: ['permalinks', id, label, description, keywords].join(' ').toLowerCase(),
    });
    entries.push(
        permalink('posts', 'Post permalinks', 'Choose the address structure for posts.', 'post name under a base slug URL'),
        permalink('postsBase', 'Posts base', 'The address prefix before a post name.', 'path URL'),
        permalink('category', 'Category before the post name', 'Include the first category in post addresses.', 'slug URL'),
    );
    for (const taxonomy of cms.taxonomies.declarations.filter(entry => entry.path)) {
        entries.push(permalink(`taxonomy.${taxonomy.name}`, `${taxonomy.singular} base`,
            `Address prefix for ${taxonomy.label.toLowerCase()} archives.`, `${taxonomy.name} ${taxonomy.label} archive bases path URL`));
    }

    // The network's settings live in the network database and save through the network.
    if (options.network) {
        const network = (id: string, label: string, description: string, keywords = ''): SettingsSearchEntry => ({
            id: `network.${id}`, groupId: 'network', name: id, label, group: 'Network', description, href: settingsSectionHref('network'),
            text: ['network', id, label, description, keywords].join(' ').toLowerCase(),
        });
        entries.push(
            network('enabled', 'Run a network of sites', 'Add sites with their own databases, addresses and members.', 'multisite enable disable on off'),
            network('name', 'Network name', 'Shown on the network dashboard and the sign-in page.', 'title'),
            network('subdomainSuffix', 'Addresses of new sites', 'The domain new sites start under.', 'subdomain suffix domain URL'),
            network('defaultTheme', 'Theme of new sites', 'The theme new sites start with.', 'new sites appearance'),
            network('defaultPlugins', 'Plugins enabled on new sites', 'Plugins new sites start with.', 'new sites'),
            network('defaultLanguage', 'Language of new sites', 'The default language new sites start with.', 'new sites locale'),
            network('siteExports', 'Site exports', 'Whether site admins export their own site or request it from a network admin.', 'database download backup export request approve'),
        );
    }
    return entries;
}

/** All query words must match. A blank query includes every field. */
export function searchSettings(entries: readonly SettingsSearchEntry[], query: string): SettingsSearchEntry[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? entries.filter(entry => words.every(word => entry.text.includes(word))) : [...entries];
}
