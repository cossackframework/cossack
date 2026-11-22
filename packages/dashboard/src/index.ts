import type { IconEntry } from '@cossackframework/solar-icons/types';

/** A sign-in method: email and password (with reset, registration and two-step sign-in), or OAuth providers. */
export type AuthMethod = 'credentials' | 'oauth';
/** An OAuth provider the sign-in page can offer. */
export type OAuthProviderName = 'github' | 'google' | 'gitlab' | 'facebook' | 'microsoft';
/** A dashboard module: its pages and its link in the navigation. */
export type DashboardModuleName = 'users' | 'sessions' | 'settings' | 'roles';

/**
 * What a project chose for sign-in and the dashboard, in `src/dashboard.config.ts`:
 *
 *   export const dashboard: DashboardConfig = { authMethods: ['credentials', 'oauth'], oauth: ['github'] };
 *
 * The package serves every page; a page of something that is off answers 404.
 */
export interface DashboardConfig {
    /** Default: `['credentials']`. Without `credentials` the sign-in page shows the providers only. */
    authMethods?: AuthMethod[];
    /** The providers, when `authMethods` has `oauth`. Each reads `<PROVIDER>_CLIENT_ID` and `<PROVIDER>_CLIENT_SECRET`. */
    oauth?: OAuthProviderName[];
    /** Default: every module. */
    modules?: DashboardModuleName[];
    /** False for sign-in without a dashboard: `/dashboard` answers 404. Default: true. */
    dashboard?: boolean;
    /** Where a completed sign-in goes. Default: `/dashboard`, or `/` without a dashboard. `AUTH_REDIRECT_AFTER_LOGIN` replaces it. */
    redirectAfterLogin?: string;
    /** The project's own screens in the dashboard's navigation, after the modules. Default: none. */
    navigation?: DashboardNavigationItem[];
    /** Who may create an account on /auth/register, and what a new account waits for. */
    registration?: {
        /** Visitors may register. Default: true. */
        open?: boolean;
        /**
         * A new account confirms its email with a link before it can sign in. It needs an email
         * sender (the EMAIL binding) and APP_URL; without a sender it is off. Default: false.
         */
        verifyEmail?: boolean;
        /** An administrator approves each new account (Users → Registrations). Default: false. */
        approve?: boolean;
        /** The name of the role a new account gets. Default: none. */
        defaultRole?: string;
    };
    /**
     * Tenants: organizations that each have their own database, members and roles, reached at
     * `<slug>.<APP_URL's host>` or a domain of their own. Accounts and sessions are shared, in
     * the application's own database. Default: off (one database). See docs/tenants.md.
     */
    tenants?: {
        /** Default: false. */
        enabled?: boolean;
        /**
         * `host` (default): each tenant's host has its own sign-in. `shared`: people sign in once,
         * on APP_URL's host, and a tenant's host gets its session from there.
         */
        signIn?: 'host' | 'shared';
    };
    /** Two-step sign-in. Every user can turn it on for their account; this makes it required. */
    security?: {
        /** Users must sign in with a second factor (an authenticator app or a passkey) before they can act. Default: false. */
        requireTwoFactor?: boolean;
        /** The names of the roles `requireTwoFactor` applies to. Default: every user. */
        twoFactorRoles?: string[];
    };
}

/**
 * A screen of the project in the dashboard's navigation, such as `/dashboard/reports`. The page
 * itself is the project's (`src/pages/dashboard/reports/index.ts`); this only links to it.
 */
export interface DashboardNavigationItem {
    /** Unique among the items and the modules. */
    id: string;
    label: string;
    href: string;
    /** Default: a generic screen icon. */
    icon?: IconEntry;
    /** Who sees the link: any signed-in user (default), administrators, or holders of a permission. Guard the page as well. */
    authorization?: 'authenticated' | 'admin' | { permission: string };
    /** In the sidebar (default) or in the account menu. */
    placement?: 'navigation' | 'account';
    /** Links under the item, shown as a group. */
    children?: { label: string; href: string }[];
    /** A module or item whose group lists this item's links, after its own, such as `users`. */
    parent?: string;
    /** Highlighted on every page under this path, for screens with their own navigation. */
    activeFor?: string;
}
