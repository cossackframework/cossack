// The choices the shared sign-in pages, the dashboard and the sign-in code (auth.ts) read. A
// project on the dashboard package alone states them in src/dashboard.config.ts; the CMS
// reads them from the site: the OAuth providers from `oauth` in src/cms.config.ts, and
// registration and two-step sign-in from Settings → General, as they are for this request.
import { getRequestContext } from '@cossackframework/core';
import { settingRoles, type SiteSettings } from '@cossackframework/cms';
import type { DashboardNavigationItem } from './dashboard/types';

/** The OAuth providers of this request's site. Read from the request, not through ./cms/index, which imports the sign-in code that reads these options. */
function providers(): string[] {
    const cms = getRequestContext()?.get('cms' as never) as { oauth?: readonly string[] } | undefined;
    return cms?.oauth ? [...cms.oauth] : [];
}

/** The site's settings of this request; src/cms/middleware.ts reads them once and keeps them here. */
function settings(): Partial<SiteSettings> {
    return (getRequestContext()?.get('cms.settings' as never) as Partial<SiteSettings> | undefined) ?? {};
}

export const authOptions = {
    get authMethods(): ('credentials' | 'oauth')[] { return providers().length ? ['credentials', 'oauth'] : ['credentials']; },
    get oauth(): string[] { return providers(); },
    modules: ['users', 'sessions', 'settings', 'roles'],
    dashboard: true,
    redirectAfterLogin: '/dashboard',
    /** The CMS's screens come from its own navigation and its plugins, not from this list. */
    navigation: [] as DashboardNavigationItem[],
    /** Settings → General: who registers, and what a new account waits for. */
    get registration() {
        const site = settings();
        return { open: site['general.usersCanRegister'] === true, verifyEmail: site['general.verifyEmail'] !== false, approve: site['general.approveRegistrations'] === true, defaultRole: site['general.defaultRole'] ?? '' };
    },
    /** Settings → General: two-step sign-in for the people who use the dashboard. */
    get security() {
        const site = settings();
        return { requireTwoFactor: site['general.requireTwoFactor'] === true, twoFactorRoles: settingRoles(site['general.twoFactorRoles']) };
    },
    /** A network of sites is the dashboard package's tenants: step 7 of specs/cms-on-dashboard.md turns them on here. */
    tenants: { enabled: false, signIn: 'shared' as 'host' | 'shared', verifyDomains: true },
    /** Application passwords start with `cms_`. */
    tokenPrefix: 'cms',
    /** The CMS's setup code. */
    setupCodeVariable: 'CMS_SETUP_CODE',
};
