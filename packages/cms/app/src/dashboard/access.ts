import type { Context } from 'hono';
import { ANONYMOUS, evaluateRule, hasPermission, PERMISSIONS, type Principal } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { icon } from '../cms/icons';
import { currentCms } from '../cms/index';
import { dashboardModules } from './registry';
import type { DashboardModule, DashboardModuleLink } from './types';

/**
 * Navigation for the signed-in user, in WordPress order: content first (posts, media, pages,
 * other collections, plugin resources and links), then administration. Each item shows only
 * with the permission its screens require.
 */
export async function navigation(c: Context): Promise<DashboardModule[]> {
    const cms = c.get('cms') as CmsHost;
    const principal: Principal = c.get('principal') ?? ANONYMOUS;
    const can = (permission: string) => hasPermission(principal, permission);
    const content: DashboardModule[] = [];
    const ordered = [...cms.collections()].sort((a, b) => (a.name === 'posts' ? -1 : b.name === 'posts' ? 1 : 0));
    for (const collection of ordered) {
        // Forms have their own section, after Comments.
        if (collection.name === 'forms') continue;
        const resource = cms.resourceById(`cms/${collection.name}`);
        const create = evaluateRule(resource.access.create, principal) !== 'deny';
        if (!create && !can(`cms/${collection.name}:update`) && !can(`cms/${collection.name}:read`)) continue;
        const base = `/dashboard/content/${collection.name}`;
        const children: DashboardModuleLink[] = [{ label: `All ${collection.label.toLowerCase()}`, href: base }];
        if (create) children.push({ label: 'New', href: `${base}/new` });
        if (can(PERMISSIONS.manageTerms)) {
            for (const name of collection.taxonomies ?? []) {
                const taxonomy = cms.taxonomies.declarations.find(entry => entry.name === name);
                if (taxonomy) children.push({ label: taxonomy.label, href: `/dashboard/terms/${name}` });
            }
        }
        content.push({ id: `collection-${collection.name}`, label: collection.label, href: base, icon: icon(collection.icon), authorization: 'authenticated', children });
    }
    if (can(PERMISSIONS.upload) || can(PERMISSIONS.manageMedia)) {
        // Media follows posts, as in WordPress.
        content.splice(Math.min(1, content.length), 0, { id: 'media', label: 'Files', href: '/dashboard/media', icon: icon('folder-with-files'), authorization: 'authenticated',
            children: [{ label: 'Library', href: '/dashboard/media' }, { label: 'New', href: '/dashboard/media/new' }] });
    }
    for (const resource of cms.readable(principal)) {
        if (resource.owner === 'cms') continue;
        const create = evaluateRule(resource.access.create, principal) !== 'deny';
        const base = `/dashboard/content/${resource.owner}.${resource.name}`;
        content.push({ id: `resource-${resource.owner}-${resource.name}`, label: resource.label ?? resource.id, href: base, icon: icon('widget-4'), authorization: 'authenticated',
            children: [{ label: 'All entries', href: base }, ...(create ? [{ label: 'New', href: `${base}/new` }] : [])] });
    }
    // Comments follow the content they belong to; the label shows how many wait for moderation.
    if (can(PERMISSIONS.moderateComments) && cms.collections().some(collection => collection.comments)) {
        const pending = await cms.comments.counts().then(counts => counts.pending).catch(() => 0);
        content.push({ id: 'comments', label: pending ? `Comments (${pending})` : 'Comments', href: '/dashboard/comments', icon: icon('chat-round-dots'), authorization: { permission: PERMISSIONS.moderateComments } });
    }
    // Forms follow comments; the label counts new submissions.
    if (cms.collections().some(collection => collection.name === 'forms')) {
        const create = evaluateRule(cms.resourceById('cms/forms').access.create, principal) !== 'deny';
        if (create || can('cms/forms:read') || can('cms/forms:update') || can(PERMISSIONS.manageSubmissions)) {
            const fresh = can(PERMISSIONS.manageSubmissions)
                ? await cms.forms.all().then(forms => cms.forms.inboxCounts(forms, principal)).then(counts => [...counts.values()].reduce((sum, count) => sum + count.fresh, 0)).catch(() => 0) : 0;
            content.push({ id: 'forms', label: fresh ? `Forms (${fresh})` : 'Forms', href: '/dashboard/forms', icon: icon('checklist-minimalistic'), authorization: 'authenticated',
                children: [{ label: 'All forms', href: '/dashboard/forms' }, ...(create ? [{ label: 'New', href: '/dashboard/content/forms/new' }] : [])] });
        }
    }
    // Host slot: active plugins add navigation links.
    for (const link of await cms.slotLinks('dashboard.nav', principal).catch(() => [])) {
        content.push({ id: `plugin-${link.plugin}-${link.href}`, label: link.label, href: link.href, icon: icon('plug-circle'), authorization: 'authenticated' });
    }

    const admin: DashboardModule[] = [];
    if (can(PERMISSIONS.manageAppearance)) {
        admin.push({ id: 'appearance', label: 'Appearance', href: '/dashboard/appearance', icon: icon('palette-2'), authorization: { permission: PERMISSIONS.manageAppearance },
            children: [{ label: 'Themes', href: '/dashboard/appearance' }, { label: 'Customize', href: '/dashboard/appearance/customize' }, { label: 'Menus', href: '/dashboard/appearance/menus' }, { label: 'Widgets', href: '/dashboard/appearance/widgets' }] });
    }
    if (can(PERMISSIONS.manageCollections)) {
        admin.push({ id: 'collections', label: 'Collections', href: '/dashboard/collections', icon: icon('structure'), authorization: { permission: PERMISSIONS.manageCollections },
            children: [{ label: 'All collections', href: '/dashboard/collections' }, { label: 'Field groups', href: '/dashboard/field-groups' }, { label: 'Taxonomies', href: '/dashboard/taxonomies' }, { label: 'Blocks', href: '/dashboard/blocks' }] });
    }
    if (can(PERMISSIONS.managePlugins)) admin.push({ id: 'plugins', label: 'Plugins', href: '/dashboard/plugins', icon: icon('plug-circle'), authorization: { permission: PERMISSIONS.managePlugins } });
    // Roles belong to role managers; the other administration modules to user managers.
    const registry = dashboardModules.filter(module => module.authorization === 'authenticated'
        || (module.authorization === 'admin' ? can(module.id === 'roles' ? PERMISSIONS.manageRoles : PERMISSIONS.manageUsers) : can(module.authorization.permission)));
    admin.push(...registry.filter(module => module.placement !== 'account'));
    const tools: DashboardModuleLink[] = [
        ...(can(PERMISSIONS.manageRedirects) ? [{ label: 'Redirects', href: '/dashboard/tools/redirects' }] : []),
        ...(can(PERMISSIONS.manageRedirects) || can(PERMISSIONS.manageCollections) ? [{ label: 'Links', href: '/dashboard/tools/links' }] : []),
        ...(can(PERMISSIONS.manageSettings) || can(PERMISSIONS.manageRedirects) ? [{ label: 'Health', href: '/dashboard/tools/health' }] : []),
        ...(can(PERMISSIONS.manageSettings) ? [{ label: 'SEO editor', href: '/dashboard/tools/seo' }] : []),
        ...(can(PERMISSIONS.manageWebhooks) ? [{ label: 'Webhooks', href: '/dashboard/tools/webhooks' }] : []),
        ...(can(PERMISSIONS.manageSchema) ? [{ label: 'Schema', href: '/dashboard/tools/schema' }] : []),
    ];
    if (tools.length) admin.push({ id: 'tools', label: 'Tools', href: tools[0]!.href, icon: icon('tuning-2'), authorization: 'authenticated', children: tools });
    if (can(PERMISSIONS.manageSettings)) admin.push({ id: 'site-settings', label: 'Settings', href: '/dashboard/settings/general', icon: icon('settings'), authorization: { permission: PERMISSIONS.manageSettings },
        children: [...cms.settings.groups.filter(group => (group.permission ?? PERMISSIONS.manageSettings) === PERMISSIONS.manageSettings && !group.parent).map(group => ({ label: group.label, href: `/dashboard/settings/${group.id}` })),
            { label: 'Permalinks', href: '/dashboard/settings/permalinks' }] });
    const account = registry.filter(module => module.placement === 'account');
    // The author profile follows the profile settings in the account menu.
    account.splice(Math.min(1, account.length), 0, { id: 'public-profile', label: 'Public profile', href: '/dashboard/profile/public', icon: icon('user-id'), authorization: 'authenticated', placement: 'account' });
    return [...content, ...admin, ...account];
}

export { siteName } from '../brand';
