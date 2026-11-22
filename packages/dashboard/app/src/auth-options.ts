// What the project chose for sign-in and the dashboard (src/dashboard.config.ts), with the
// defaults. The sign-in pages, the guard and the dashboard read their choices here. The CMS
// has its own version of this module.
import type { DashboardConfig } from '@cossackframework/dashboard';
import { dashboard } from '@/dashboard.config';

const showsDashboard = dashboard.dashboard !== false;

export const authOptions: Required<Omit<DashboardConfig, 'security' | 'registration' | 'tenants'>> & {
    tenants: Required<NonNullable<DashboardConfig['tenants']>>;
    registration: Required<NonNullable<DashboardConfig['registration']>>;
    security: Required<NonNullable<DashboardConfig['security']>>;
} = {
    authMethods: dashboard.authMethods ?? ['credentials'],
    oauth: dashboard.oauth ?? [],
    modules: dashboard.modules ?? ['users', 'sessions', 'settings', 'roles'],
    dashboard: showsDashboard,
    redirectAfterLogin: dashboard.redirectAfterLogin ?? (showsDashboard ? '/dashboard' : '/'),
    navigation: dashboard.navigation ?? [],
    registration: {
        open: dashboard.registration?.open !== false,
        verifyEmail: dashboard.registration?.verifyEmail === true,
        approve: dashboard.registration?.approve === true,
        defaultRole: dashboard.registration?.defaultRole ?? '',
    },
    tenants: {
        enabled: dashboard.tenants?.enabled === true,
        signIn: dashboard.tenants?.signIn === 'shared' ? 'shared' : 'host',
        verifyDomains: dashboard.tenants?.verifyDomains !== false,
    },
    security: {
        requireTwoFactor: dashboard.security?.requireTwoFactor === true,
        twoFactorRoles: dashboard.security?.twoFactorRoles ?? [],
    },
};
