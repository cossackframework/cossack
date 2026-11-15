// What the project chose for sign-in and the dashboard (src/dashboard.config.ts), with the
// defaults. The sign-in pages, the guard and the dashboard read their choices here. The CMS
// has its own version of this module.
import type { DashboardConfig } from '@cossackframework/dashboard';
import { dashboard } from '@/dashboard.config';

const showsDashboard = dashboard.dashboard !== false;

export const authOptions: Required<DashboardConfig> = {
    authMethods: dashboard.authMethods ?? ['credentials'],
    oauth: dashboard.oauth ?? [],
    modules: dashboard.modules ?? ['users', 'sessions', 'settings', 'roles'],
    dashboard: showsDashboard,
    redirectAfterLogin: dashboard.redirectAfterLogin ?? (showsDashboard ? '/dashboard' : '/'),
};
