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
}
