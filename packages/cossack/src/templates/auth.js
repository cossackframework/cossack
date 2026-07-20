import { loadStub } from './load-stub.js';

// --- auth feature stubs -----------------------------------------------------

export function authLayoutTemplate() {
  return loadStub('auth-layout.ts.stub');
}

export function loginOAuthButtons(providers = []) {
  if (!providers.length) return '';
  return providers.map((p) =>
    `        \${component(Button, { variant: 'outline', block: true, '?disabled': false }, html\`<a href="/auth/${p}/redirect" class="block w-full text-center">Sign in with ${p.charAt(0).toUpperCase() + p.slice(1)}</a>\`)}`,
  ).join('\n') + '\n        <div class="my-4 text-center text-muted-foreground text-sm">— or —</div>\n';
}

export function oauthImports(providers = []) {
  return providers.length ? ', createOAuth, type OAuthUser, type TokenSet' : '';
}

export function oauthProviderConfig(provider) {
  const envName = provider.toUpperCase();
  return `    ${provider}: {\n      clientId: process.env.${envName}_CLIENT_ID!,\n      clientSecret: process.env.${envName}_CLIENT_SECRET!,\n      redirectUrl: \`/auth/${provider}/callback\`,\n    },`;
}

export function oauthSection(providers = []) {
  if (!providers.length) return '';
  const providerConfig = providers.map(oauthProviderConfig).join('\n');
  return `
// --- OAuth ----------------------------------------------------------------
// Mount redirect and callback routes for each configured provider.
export const oauth = createOAuth({
  secret: process.env.OAUTH_SECRET!,
  providers: {
${providerConfig}
  },
});

export async function handleOAuthUser(oauthUser: OAuthUser, _tokens: TokenSet, c: Context) {
  const user = { id: oauthUser.id, email: oauthUser.email ?? '', name: oauthUser.name ?? '', avatar: null, meta: null };
  if (auth.createSession) {
    const { headers } = await auth.createSession(user as any, c);
    headers.forEach((value, key) => c.header(key, value));
  }
  return c.redirect(config('auth.redirectAfterLogin'));
}
`;
}

export function deriveResetPath(loginPath) {
  return loginPath.replace(/\/login$/, '/reset-password');
}

export function loginPageTemplate({ registerPath, oauthProviders = [] }) {
  return loadStub('auth-login.ts.stub', { registerPath, oauthButtons: loginOAuthButtons(oauthProviders) });
}

export function registerPageTemplate({ loginPath }) {
  return loadStub('auth-register.ts.stub', { loginPath });
}

export function forgotPasswordPageTemplate({ loginPath }) {
  return loadStub('auth-forgot-password.ts.stub', { loginPath });
}

export function resetPasswordPageTemplate({ loginPath }) {
  return loadStub('auth-reset-password.ts.stub', { loginPath });
}

export function authMiddlewareTemplate({ publicPaths }) {
  return loadStub('auth-middleware.ts.stub', { publicPaths: JSON.stringify(publicPaths) });
}

/**
 * Minimal root layout created by `add auth` if `src/pages/layout.ts` is absent.
 * Global middleware (auth session + guard) is registered separately in
 * `src/bootstrap/middlewares.ts`, so this layout only renders children.
 */
export function rootLayoutWithAuthTemplate() {
  return loadStub('root-layout-auth.ts.stub');
}

// --- dashboard + public page stubs (added alongside `cossack add auth`) -----

/** src/config/auth.ts — redirect configuration read by the pages and guard. */
export function configAuthTemplate({ loginPath } = {}) {
  // Defaults mirror the chosen auth route group: a custom --path (e.g.
  // /admin/auth/login) keeps its prefix so the guard's default redirect lands
  // on the right login page without env overrides.
  const loginDefault = loginPath || '/auth/login';
  return loadStub('config-auth.ts.stub', { loginPath: loginDefault });
}

/** src/pages/(public)/layout.ts — header/footer chrome for marketing pages. */
export function publicLayoutTemplate() {
  return loadStub('public-layout.ts.stub');
}

/** src/pages/(public)/index.ts — the landing page. */
export function publicIndexTemplate() {
  return loadStub('public-index.ts.stub');
}

/** src/pages/dashboard/layout.ts — sidebar shell + user menu. */
export function dashboardLayoutTemplate() {
  return loadStub('dashboard-layout.ts.stub');
}

/** src/pages/dashboard/index.ts — dashboard landing (current user + stats). */
export function dashboardIndexTemplate() {
  return loadStub('dashboard-index.ts.stub');
}

/** src/pages/dashboard/profile/index.ts — view + edit profile. */
export function dashboardProfileTemplate() {
  return loadStub('dashboard-profile.ts.stub');
}

/** src/pages/dashboard/sessions/index.ts — list + revoke sessions. */
export function dashboardSessionsTemplate() {
  return loadStub('dashboard-sessions.ts.stub');
}

/** public/logo.svg — placeholder brand mark used by both layouts. */
export function logoSvgTemplate() {
  return loadStub('logo.svg.stub');
}

/** src/lib/uuid.ts — dependency-free UUIDv7 generator. */
export function uuidHelperTemplate() {
  return loadStub('uuid.ts.stub');
}

/** src/config/permissions.ts — the permission constant (source of truth). */
export function permissionsConfigTemplate() {
  return loadStub('permissions-config.ts.stub');
}

/** src/models/Role.ts — roles table row type. */
export function roleModelTemplate() {
  return loadStub('role-model.ts.stub');
}

/** src/models/UserRole.ts — user↔role join row type. */
export function userRoleModelTemplate() {
  return loadStub('user-role-model.ts.stub');
}

/** src/services/rbac.ts — the authorizer kit (`guard`). */
export function rbacServiceTemplate() {
  return loadStub('rbac-service.ts.stub');
}

/** src/services/users.ts — user CRUD data access. */
export function usersServiceTemplate() {
  return loadStub('users-service.ts.stub');
}

/** src/services/roles.ts — role CRUD data access. */
export function rolesServiceTemplate() {
  return loadStub('roles-service.ts.stub');
}

// --- Dashboard admin pages (users + roles CRUD) ----------------------------
// All gated with guard.requireRole('admin') (see src/services/rbac.ts).

/** src/pages/dashboard/users/index.ts */
export function usersIndexTemplate() {
  return loadStub('users-index.ts.stub');
}

/** src/pages/dashboard/users/new/index.ts */
export function usersNewTemplate() {
  return loadStub('users-new.ts.stub');
}

/** src/pages/dashboard/users/[id]/index.ts */
export function usersEditTemplate() {
  return loadStub('users-edit.ts.stub');
}

/** src/pages/dashboard/roles/index.ts */
export function rolesIndexTemplate() {
  return loadStub('roles-index.ts.stub');
}

/** src/pages/dashboard/roles/new/index.ts */
export function rolesNewTemplate() {
  return loadStub('roles-new.ts.stub');
}

/** src/pages/dashboard/roles/[id]/index.ts */
export function rolesEditTemplate() {
  return loadStub('roles-edit.ts.stub');
}

/** src/migrations/0007_create_user_roles.ts */
export function userRolesMigrationTemplate() {
  return loadStub('migration-user-roles.ts.stub');
}

/** src/seeders/database.seeder.ts — the default seeder (admin role + user). */
export function defaultSeederTemplate() {
  return loadStub('seeder-default.ts.stub');
}

/**
 * Default English catalog shipped by `cossack lang publish`. Demonstrates
 * placeholder replacement and pluralization so the feature is immediately
 * useful; users edit/extend freely.
 */
// Auth feature templates (`cossack add auth`)
// ===========================================================================

/** `src/models/Session.ts` — sessions table row + Database augmentation. */
export function sessionModelTemplate() {
  return loadStub('session-model.ts.stub');
}

/**
 * Generate src/auth.ts.
 *
 * @param loginPath       login route used to derive the password-reset route
 * @param oauthProviders  configured OAuth provider names
 */
export function authModuleTemplate({ loginPath, oauthProviders = [] }) {
  return loadStub('auth-module.ts.stub', {
    resetPath: deriveResetPath(loginPath),
    oauthImports: oauthImports(oauthProviders),
    oauthSection: oauthSection(oauthProviders),
  });
}

