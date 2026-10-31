import type { Context } from 'hono';
import { dashboardModules } from './registry';
import type { DashboardModule } from './types';

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

export { siteName } from '../brand';
