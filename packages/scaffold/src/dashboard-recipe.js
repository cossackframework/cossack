/**
 * Sign-in and the dashboard on the database ORM are served from @cossackframework/dashboard
 * (specs/dashboard-package.md): the project mounts the package (package.json#cossack.packages)
 * and holds none of these files. The package is their source (packages/dashboard/app/src,
 * tracked there). The scaffold reads them only for the packages' own applications: the
 * dashboard's development app, and the CMS, which ships a copy of the shell.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { authStore } from './registry.js';

/** The served sources inside @cossackframework/dashboard. */
export function dashboardSourceDir() {
  return path.join(path.dirname(createRequire(import.meta.url).resolve('@cossackframework/dashboard/package.json')), 'app');
}

/** The package a project with ORM sign-in mounts. */
export const DASHBOARD_PACKAGE = '@cossackframework/dashboard';

/** What the package serves, as paths of the application (a trailing slash names a directory). */
export const SERVED_DASHBOARD_PATHS = [
  'src/pages/auth/',
  'src/pages/dashboard/',
  'src/dashboard/',
  'src/services/users.ts',
  'src/services/roles.ts',
  'src/services/rbac.ts',
  'src/services/security.ts',
  'src/services/api-tokens.ts',
  'src/services/tenants.ts',
  'src/lib/permissions.ts',
  'src/lib/uuid.ts',
  'src/middlewares/auth.ts',
  'src/middlewares/tenant.ts',
  'src/auth.ts',
  'src/auth-options.ts',
  'src/tenants.ts',
  'src/auth-providers.ts',
  'src/auth-input.ts',
  'src/auth-bot-check.ts',
  'src/auth-bot-token.ts',
  'src/brand.ts',
  'src/passkeys.client.ts',
  'src/config/auth.ts',
];

/** Whether the recipe's sign-in is the package's: `auth` with users in the database. */
export function mountsDashboard(recipe) {
  return recipe.resolvedFeatures.includes('auth') && authStore(recipe.resolvedFeatures) === 'database';
}

/** A path the package serves. The project holds no file there: it would override the package's. */
export function isServedDashboardPath(rel) {
  return SERVED_DASHBOARD_PATHS.some(entry => entry.endsWith('/') ? rel.startsWith(entry) : rel === entry);
}

/** `src/dashboard.config.ts`: the recipe's choices, which the served code reads. */
export function dashboardConfigFile(recipe) {
  const list = values => `[${values.map(value => `'${value}'`).join(', ')}]`;
  const showsDashboard = recipe.resolvedFeatures.includes('dashboard');
  const lines = [
    `  // How people sign in: 'credentials' (email and password) and 'oauth'.`,
    `  authMethods: ${list(recipe.config.authMethods)},`,
    `  // The OAuth providers. Each reads <PROVIDER>_CLIENT_ID and <PROVIDER>_CLIENT_SECRET.`,
    `  oauth: ${list(recipe.config.authMethods.includes('oauth') ? recipe.config.oauth : [])},`,
  ];
  if (showsDashboard) lines.push(`  // The dashboard's modules. A page of a module that is not listed answers 404.`, `  modules: ${list(recipe.dashboardModules)},`);
  else lines.push(`  // This project has sign-in without a dashboard: /dashboard answers 404.`, `  dashboard: false,`);
  if (!showsDashboard && recipe.resolvedFeatures.includes('protected-route')) lines.push(`  redirectAfterLogin: '/protected-route',`);
  return `import type { DashboardConfig } from '${DASHBOARD_PACKAGE}';

/**
 * Sign-in and the dashboard. ${DASHBOARD_PACKAGE} serves their pages; this file holds the
 * project's choices. \`cossack add\` and \`cossack remove\` change it with the recipe.
 */
export const dashboard: DashboardConfig = {
${lines.join('\n')}
};
`;
}
