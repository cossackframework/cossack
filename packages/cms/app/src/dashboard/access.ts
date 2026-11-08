import type { Context } from 'hono';
import { ANONYMOUS, dashboardNotices as noticesPoint, dashboardNoticesOf, dashboardTaskbar, evaluateRule, hasPermission, isNetworkAdmin, PERMISSIONS, taskbarItemsOf, type DashboardNotice, type Principal, type WriteActor } from '@cossackframework/cms';
import { MAIN_SITE, type CmsHost } from '@cossackframework/cms/server';
import { icon } from '../cms/icons';
import { currentCms, networkFor, siteUrl, type CmsBindings } from '../cms/index';
import { dashboardModules } from './registry';
import type { DashboardModule, DashboardModuleLink, DashboardStatus } from './types';

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
    // The month's published and scheduled entries of every collection the user may see.
    if (content.length) content.push({ id: 'calendar', label: 'Calendar', href: '/dashboard/calendar', icon: icon('calendar'), authorization: 'authenticated' });
    if (can(PERMISSIONS.upload) || can(PERMISSIONS.manageMedia)) {
        // Media follows posts, as in WordPress.
        content.splice(Math.min(1, content.length), 0, { id: 'media', label: 'Files', href: '/dashboard/media', icon: icon('folder-with-files'), authorization: 'authenticated',
            children: [{ label: 'Library', href: '/dashboard/media' }, { label: 'New', href: '/dashboard/media/new' }, { label: 'Summary', href: '/dashboard/media/summary' }] });
    }
    // A plugin's records show once it is active; until then its screens answer that it is not.
    const inactivePlugins = new Set((await cms.status().catch(() => ({ plugins: [] }))).plugins.filter(plugin => !plugin.active).map(plugin => plugin.name));
    for (const resource of cms.readable(principal)) {
        if (resource.owner === 'cms' || inactivePlugins.has(resource.owner)) continue;
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
    // Host slot: active plugins add navigation links, with an icon of the dashboard's set when they name one.
    for (const link of await cms.slotLinks('dashboard.nav', principal).catch(() => [])) {
        content.push({ id: `plugin-${link.plugin}-${link.href}`, label: link.label, href: link.href, icon: icon(link.icon, 'plug-circle'), authorization: 'authenticated' });
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
    // Users gains Registrations while the site approves new accounts, or while one still waits.
    const approving = can(PERMISSIONS.manageUsers) && (await cms.settings.get('general.approveRegistrations').catch(() => false) || await cms.users.registrationCount().catch(() => 0) > 0);
    admin.push(...registry.filter(module => module.placement !== 'account')
        .map(module => module.id === 'users' && approving ? { ...module, children: [...(module.children ?? []), { label: 'Registrations', href: '/dashboard/registrations' }] } : module));
    const tools: DashboardModuleLink[] = [
        ...(can(PERMISSIONS.manageRedirects) ? [{ label: 'Redirects', href: '/dashboard/tools/redirects' }] : []),
        ...(can(PERMISSIONS.manageRedirects) || can(PERMISSIONS.manageCollections) ? [{ label: 'Links', href: '/dashboard/tools/links' }] : []),
        ...(can(PERMISSIONS.manageSettings) || can(PERMISSIONS.manageRedirects) ? [{ label: 'Health', href: '/dashboard/tools/health' }] : []),
        ...(can(PERMISSIONS.manageSettings) ? [{ label: 'SEO editor', href: '/dashboard/tools/seo' }] : []),
        ...(can(PERMISSIONS.manageWebhooks) ? [{ label: 'Webhooks', href: '/dashboard/tools/webhooks' }] : []),
        ...(can(PERMISSIONS.manageSchema) ? [{ label: 'Schema', href: '/dashboard/tools/schema' }] : []),
        ...(can(PERMISSIONS.manageSettings) ? [{ label: 'Export', href: '/dashboard/tools/export' }] : []),
        ...(can(PERMISSIONS.manageSettings) ? [{ label: 'Cache', href: '/dashboard/tools/cache' }] : []),
        ...(can(PERMISSIONS.manageSettings) ? [{ label: 'Jobs', href: '/dashboard/tools/jobs' }, { label: 'Activity', href: '/dashboard/tools/activity' }, { label: 'Find and replace', href: '/dashboard/tools/replace' }, { label: 'Automations', href: '/dashboard/tools/automations' }] : []),
    ];
    if (tools.length) admin.push({ id: 'tools', label: 'Tools', href: tools[0]!.href, icon: icon('tuning-2'), authorization: 'authenticated', children: tools });
    // Settings has its own navigation beside its pages, so the sidebar holds one link.
    if (can(PERMISSIONS.manageSettings)) admin.push({ id: 'site-settings', label: 'Settings', href: '/dashboard/settings', icon: icon('settings'), authorization: { permission: PERMISSIONS.manageSettings },
        activeFor: '/dashboard/settings' });
    const env = c.env as CmsBindings;
    // Network admins run the network from the network host; its settings are under Settings there.
    if (await showsNetwork(c, principal)) admin.push({ id: 'network', label: 'Network', href: '/dashboard/network', icon: icon('global'), authorization: 'authenticated', activeFor: '/dashboard/network',
        children: [['Home', ''], ['Sites', '/sites'], ['Users', '/users'], ['Plugins', '/plugins'], ['Themes', '/themes'], ['Updates', '/updates']].map(([label, path]) => ({ label: label!, href: `/dashboard/network${path}` })) });
    // Sites: My sites (every site the account belongs to) and each site's dashboard, when there is more than one.
    if (principal.kind === 'user') {
        const sites = await networkFor(env).memberSites(principal.id).catch(() => []);
        if (sites.length > 1) content.unshift({ id: 'my-sites', label: 'Sites', href: '/dashboard/my-sites', icon: icon('home-2'), authorization: 'authenticated',
            children: [{ label: 'My sites', href: '/dashboard/my-sites' }, ...sites.map(site => ({ label: site.name ?? 'Main site', href: `${(siteUrl(env, site) ?? '').replace(/\/$/, '')}/dashboard` }))] });
    }
    const account = registry.filter(module => module.placement === 'account');
    // The author profile follows the profile settings in the account menu.
    account.splice(Math.min(1, account.length), 0, { id: 'public-profile', label: 'Public profile', href: '/dashboard/profile/public', icon: icon('user-id'), authorization: 'authenticated', placement: 'account' });
    return [...content, ...admin, ...account];
}

/** Whether the dashboard links the network's: for network admins, on the main site, while the network is on. Other sites reach it through My sites. */
async function showsNetwork(c: Context, principal: Principal): Promise<boolean> {
    return isNetworkAdmin(principal) && c.get('site')?.id === MAIN_SITE && await networkFor(c.env as CmsBindings).enabled().catch(() => false);
}

/**
 * What waits for the signed-in user, for the dashboard's taskbar: comments to moderate, entries
 * pending review, new form submissions, schema migrations, plugins waiting for a grant and
 * deliveries, each with a count and where to go; then the links active plugins add to the
 * `dashboard.taskbar` slot.
 */
export async function dashboardStatus(c: Context): Promise<DashboardStatus[]> {
    const cms = c.get('cms') as CmsHost;
    const principal: Principal = c.get('principal') ?? ANONYMOUS;
    const can = (permission: string) => hasPermission(principal, permission);
    const context = { principal };
    const items: DashboardStatus[] = [];
    // Network admins reach the network dashboard from the main site's taskbar, with sites' export requests.
    if (await showsNetwork(c, principal)) {
        items.push({ id: 'network', label: 'Network', href: '/dashboard/network' });
        const waiting = [...(await networkFor(c.env as CmsBindings).exportRequests().catch(() => new Map())).values()].filter(request => request.approvedAt === null);
        if (waiting.length) items.push({ id: 'export-requests', label: 'Export requests', href: `/dashboard/network/sites/${waiting[0]!.site}`, count: waiting.length, tone: 'warning' });
    }
    if (can(PERMISSIONS.moderateComments) && cms.collections().some(collection => collection.comments)) {
        const pending = await cms.comments.counts().then(counts => counts.pending).catch(() => 0);
        if (pending) items.push({ id: 'comments', label: 'Comments to moderate', href: '/dashboard/comments?status=pending', count: pending, tone: 'warning' });
    }
    let pending = 0;
    let first = '';
    for (const collection of cms.collections()) {
        if (collection.publishable === false || !can(`cms/${collection.name}:update`)) continue;
        const count = await cms.resource(`cms/${collection.name}`).count({ where: { status: 'pending' } }, context).catch(() => 0);
        if (count && !first) first = collection.name;
        pending += count;
    }
    if (pending) items.push({ id: 'pending-review', label: 'Pending review', href: `/dashboard/content/${first}?status=pending`, count: pending, tone: 'warning' });
    // Notes that name the user, in entries they have not opened since.
    if (principal.kind === 'user') {
        const unseen = await cms.notes.unseen(principal.id).catch(() => 0);
        if (unseen) items.push({ id: 'notes', label: 'Notes for you', href: '/dashboard#notes-for-you', count: unseen });
    }
    if (can(PERMISSIONS.manageSubmissions) && cms.collections().some(collection => collection.name === 'forms')) {
        const fresh = await cms.forms.all().then(forms => cms.forms.inboxCounts(forms, principal)).then(counts => [...counts.values()].reduce((sum, count) => sum + count.fresh, 0)).catch(() => 0);
        if (fresh) items.push({ id: 'submissions', label: 'New submissions', href: '/dashboard/forms', count: fresh });
    }
    if (can(PERMISSIONS.manageSchema) || can(PERMISSIONS.managePlugins)) {
        const status = await cms.status().catch(() => ({ resources: [], plugins: [] }));
        const migrations = status.resources.filter(resource => !resource.active).length;
        if (migrations && can(PERMISSIONS.manageSchema)) items.push({ id: 'schema', label: 'Schema migrations waiting', href: '/dashboard/tools/schema', count: migrations, tone: 'error' });
        // A network-active plugin waits for the network admin, not the site's.
        const grants = status.plugins.filter(plugin => !plugin.active && plugin.missing.length && plugin.network === 'available').length;
        if (grants && can(PERMISSIONS.managePlugins)) items.push({ id: 'plugins', label: 'Plugins waiting for a grant', href: '/dashboard/plugins', count: grants, tone: 'warning' });
    }
    if (can(PERMISSIONS.manageSchema)) {
        const outbox = (await cms.outbox.pending({ limit: 100 }).catch(() => [])).length;
        if (outbox) items.push({ id: 'outbox', label: 'Events waiting for delivery', href: '/dashboard', count: outbox });
        const unconfirmed = (await cms.db.pending.list({ limit: 100 }).catch(() => [])).length;
        if (unconfirmed) items.push({ id: 'unconfirmed', label: 'Writes waiting for confirmation', href: '/dashboard', count: unconfirmed, tone: 'warning' });
    }
    for (const link of await cms.slotLinks('dashboard.taskbar', principal).catch(() => [])) items.push({ id: `plugin-${link.plugin}-${link.href}`, label: link.label, href: link.href });
    // Plugins add items with counts, or change the built-in ones, through `cms.dashboard.taskbar`; a failing handler leaves the list as it was.
    const filtered = await cms.hooks.applyFilters(dashboardTaskbar, items, { actor: actorOf(principal) }).catch(() => items);
    return taskbarItemsOf(filtered);
}

/** Notices above every dashboard screen: what active plugins return from `cms.dashboard.notices`. */
export async function dashboardNotices(c: Context): Promise<DashboardNotice[]> {
    const cms = c.get('cms') as CmsHost | undefined;
    const principal: Principal = c.get('principal') ?? ANONYMOUS;
    if (!cms || principal.kind !== 'user') return [];
    // User managers hear of accounts waiting for their approval on every screen, until none waits.
    const waiting = hasPermission(principal, PERMISSIONS.manageUsers) ? await cms.users.registrationCount().catch(() => 0) : 0;
    const core: DashboardNotice[] = waiting ? [{ id: 'cms-registrations', tone: 'info', message: waiting === 1 ? __('1 new account waits for your approval.') : `${waiting} ${__('new accounts wait for your approval.')}`, href: '/dashboard/registrations' }] : [];
    return dashboardNoticesOf(await cms.hooks.applyFilters(noticesPoint, core, { actor: actorOf(principal) }).catch(() => core));
}

function actorOf(principal: Principal): WriteActor {
    return principal.kind === 'user' ? { kind: 'user', id: principal.id } : principal.kind === 'system' ? { kind: 'system', id: principal.reason } : { kind: 'anonymous', id: 'anonymous' };
}

export { siteName } from '../brand';

/**
 * Where the command palette (Ctrl/Cmd+K) can go: every module and child link of the navigation,
 * grouped by module. The CMS adds its screens the same way through its own navigation.
 */
export async function dashboardSearch(c: Context): Promise<{ id: string; label: string; group: string; href: string }[]> {
    const modules = await navigation(c);
    const seen = new Set<string>();
    const commands: { id: string; label: string; group: string; href: string }[] = [];
    const add = (label: string, group: string, href: string) => {
        if (seen.has(href)) return;
        seen.add(href);
        commands.push({ id: href, label, group, href });
    };
    add('Dashboard', 'Dashboard', '/dashboard');
    for (const module of modules) {
        add(module.label, module.placement === 'account' ? 'Account' : module.label, module.href);
        for (const child of module.children ?? []) add(`${module.label}: ${child.label}`, module.label, child.href);
    }
    return commands;
}
