import type { Context } from 'hono';
import { dashboardModules } from './registry';
import type { DashboardModule, DashboardNotice, DashboardStatus } from './types';

/** Navigation for the signed-in user: the installed modules they may open, in order. */
export async function navigation(c: Context): Promise<DashboardModule[]> {
    const user = c.get('user') as { roles?: { name: string; permissions?: string[] }[] } | undefined;
    const admin = !!user?.roles?.some(role => role.name === 'admin');
    return dashboardModules.filter(module => {
        const authorization = module.authorization;
        if (authorization === 'authenticated') return true;
        if (authorization === 'admin') return admin;
        return !!user?.roles?.some(role => role.permissions?.includes(authorization.permission));
    });
}

/** What waits for the signed-in user, for the dashboard's taskbar. Nothing here; the CMS counts comments, reviews and deliveries. */
export async function dashboardStatus(_c: Context): Promise<DashboardStatus[]> {
    return [];
}

/** Notices above every dashboard screen. Nothing here; the CMS shows what its plugins return from `cms.dashboard.notices`. */
export async function dashboardNotices(_c: Context): Promise<DashboardNotice[]> {
    return [];
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
