// The choices the shared sign-in pages and dashboard read. A project on the database ORM
// states them in src/dashboard.config.ts. The CMS always has email and password (with passkeys
// and sign-in links, which its auth.ts adds) and every account screen; the OAuth providers are
// the site's `oauth` option in src/cms.config.ts.
import type { DashboardNavigationItem } from './dashboard/types';
import { currentCms } from './cms/index';

function providers(): string[] {
    try { return [...currentCms().oauth]; }
    catch { return []; }
}

export const authOptions = {
    get authMethods(): ('credentials' | 'oauth')[] { return providers().length ? ['credentials', 'oauth'] : ['credentials']; },
    get oauth(): string[] { return providers(); },
    modules: ['users', 'sessions', 'settings', 'roles'],
    dashboard: true,
    redirectAfterLogin: '/dashboard',
    /** The CMS's screens come from its own navigation and its plugins, not from this list. */
    navigation: [] as DashboardNavigationItem[],
};
