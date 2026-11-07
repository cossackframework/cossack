import type { Context } from 'hono';
import { dashboardModules } from './registry';
import type { DashboardModule, DashboardStatus } from './types';

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

export { siteName } from '../brand';
