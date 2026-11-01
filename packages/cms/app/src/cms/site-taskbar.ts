/**
 * Builds the site taskbar's view for the signed-in user and the page they are on. Server-only:
 * the site layout's `server$` resource runs it during render, after the page's `init()` has
 * described the page through `c.set('cms.taskbar', …)`.
 */
import type { Context } from 'hono';
import type { User } from '@cossackframework/core';
import { ANONYMOUS, evaluateRule, hasPermission, PERMISSIONS, type Principal } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { siteLogo, siteName } from '../brand';
import { navigation } from '../dashboard/access';
import { icon } from './icons';
import type { Resolved } from './site';
import type { TaskbarLink, TaskbarPage, TaskbarView } from './taskbar';

export async function siteTaskbar(c: Context, user: User | undefined): Promise<TaskbarView | null> {
    const principal: Principal = c.get('principal') ?? ANONYMOUS;
    if (!user || principal.kind !== 'user') return null;
    const cms = c.get('cms');
    try {
        const modules = await navigation(c);
        const nested = (parent: string | undefined) => !!parent && modules.some(module => module.id === parent);
        const start: TaskbarLink[] = [
            { label: 'Dashboard', href: '/dashboard', icon: icon('widget-2') },
            ...modules.filter(module => module.placement !== 'account' && !nested(module.parent)).map(module => ({ label: module.label, href: module.href, icon: module.icon })),
        ];
        const account = modules.filter(module => module.placement === 'account').map(module => ({ label: module.label, href: module.href, icon: module.icon }));
        const create: TaskbarLink[] = [];
        for (const collection of cms.collections()) {
            if (evaluateRule(cms.resourceById(`cms/${collection.name}`).access.create, principal) === 'deny') continue;
            create.push({ label: `New ${collection.singular.toLowerCase()}`, href: `/dashboard/content/${collection.name}/new`, icon: icon(collection.icon) });
        }
        if (hasPermission(principal, PERMISSIONS.upload) || hasPermission(principal, PERMISSIONS.manageMedia)) create.push({ label: 'Upload file', href: '/dashboard/media/new', icon: icon('folder-with-files') });
        const page = c.get('cms.taskbar');
        const plugins = (await cms.slotLinks('site.taskbar', principal).catch(() => [])).map(link => ({ label: link.label, href: link.href }));
        return {
            site: { title: await siteName(), logo: await siteLogo() },
            start,
            context: pageContext(cms, principal, c.get('cms.site'), page, c.req.path),
            create,
            plugins,
            seo: page?.seo ?? null,
            user: { name: user.name || user.email, email: user.email, avatar: user.avatar ?? null, links: account },
        };
    } catch {
        // Before setup, or while content is unavailable, the bar stays away rather than failing the page.
        return null;
    }
}

/** The current page's tools: editing the entry shown, or managing what the page lists. */
function pageContext(cms: CmsHost, principal: Principal, resolved: Resolved | { kind: 'unavailable' } | undefined, page: TaskbarPage | undefined, path: string): TaskbarView['context'] {
    const can = (permission: string) => hasPermission(principal, permission);
    const links: TaskbarLink[] = [];
    const entry = page?.entry ?? null;
    if (entry) {
        // Live Edit edits the page in place; Edit opens the entry in the dashboard's editor.
        links.push({ label: 'Edit', href: entry.dashboard, icon: icon('pen') });
        return { status: entry.status || null, edit: entry.inPlace ? `${path}?edit` : null, links };
    }
    const kind = resolved?.kind ?? (path === '/' ? 'home' : 'other');
    if (resolved?.kind === 'archive') {
        const collection = resolved.collection;
        const readable = evaluateRule(cms.resourceById(`cms/${collection.name}`).access.create, principal) !== 'deny' || can(`cms/${collection.name}:update`) || can(`cms/${collection.name}:read`);
        if (readable) links.push({ label: `All ${collection.label.toLowerCase()}`, href: `/dashboard/content/${collection.name}`, icon: icon(collection.icon) });
    } else if (resolved?.kind === 'term' && can(PERMISSIONS.manageTerms)) {
        const taxonomy = cms.taxonomies.declaration(resolved.term.taxonomy);
        links.push({ label: `Edit ${taxonomy.singular.toLowerCase()}`, href: `/dashboard/terms/${resolved.term.taxonomy}/${resolved.term.id}`, icon: icon('tag') });
    } else if (resolved?.kind === 'author' && can(PERMISSIONS.manageUsers)) {
        links.push({ label: 'Edit user', href: `/dashboard/users/${resolved.user.id}`, icon: icon('user') });
    } else if (kind === 'home' && can(PERMISSIONS.manageSettings)) {
        links.push({ label: 'Reading settings', href: '/dashboard/settings/reading', icon: icon('settings') });
    }
    return { status: null, edit: null, links };
}
