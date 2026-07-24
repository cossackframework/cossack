import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import prompts from 'prompts';
import {
  ADAPTERS,
  FEATURES,
  OAUTH_PROVIDERS,
  UI_THEMES,
  DASHBOARD_MODULES,
  FEATURE_REGISTRY,
  PRESET_REGISTRY,
  DATABASE_PROVIDERS,
  parseList,
  resolveFeatures,
  removeFeature,
  resolveDashboardModules,
  resolveRecipe,
} from './registry.js';

export {
  ADAPTERS,
  FEATURES,
  OAUTH_PROVIDERS,
  UI_THEMES,
  DASHBOARD_MODULES,
  FEATURE_REGISTRY,
  PRESET_REGISTRY,
  DATABASE_PROVIDERS,
  parseList,
  resolveFeatures,
  removeFeature,
  resolveDashboardModules,
  resolveRecipe,
};

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const templateDir = path.join(packageDir, 'template');
const templateVersion = JSON.parse(
  await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'),
).version;
const text = (value) => Buffer.from(value, 'utf8');
const hash = (content) => createHash('sha256').update(content).digest('hex');

const BASE_PATHS = new Set([
  '.prettierrc.json',
  '.vscode/cossack.code-snippets',
  'scripts/dev.js',
  'src/client/entry-client.ts',
  'src/config/app.ts',
  'src/config/cache.ts',
  'src/config/cors.ts',
  'src/index.ts',
  'src/root.ts',
  'src/vite-env.d.ts',
  'vite.config.dev.ts',
  'vite.config.ts',
  'worker-configuration.d.ts',
  'wrangler.jsonc',
]);
const UI_PATHS = new Set([
  'src/App.ts',
  'src/style.css',
  'src/stores.client.ts',
  'public/logo.svg',
]);
const DATABASE_PATHS = new Set([
  'src/config/database.ts',
  'src/db/config.ts',
  'src/middlewares/db.ts',
  'src/migrations/0006_create_cache_table.ts',
]);
const AUTH_PATHS = new Set([
  'src/auth.ts',
  'src/config/auth.ts',
  'src/lib/uuid.ts',
  'src/middlewares/auth.ts',
  'src/migrations/0001_create_users.ts',
  'src/migrations/0002_create_sessions.ts',
  'src/migrations/0005_create_oauth_accounts.ts',
  'src/models/User.ts',
  'src/models/Session.ts',
  'src/pages/auth/forgot-password/index.ts',
  'src/pages/auth/layout.ts',
  'src/pages/auth/login/index.ts',
  'src/pages/auth/register/index.ts',
  'src/pages/auth/reset-password/index.ts',
]);
const DASHBOARD_CORE_PATHS = new Set([
  'src/pages/dashboard/index.ts',
  'src/pages/dashboard/layout.ts',
  'src/seeders/database.seeder.ts',
]);
const RBAC_PATHS = new Set([
  'src/config/permissions.ts',
  'src/lib/permissions.ts',
  'src/migrations/0003_create_roles.ts',
  'src/migrations/0007_create_user_roles.ts',
  'src/models/Role.ts',
  'src/models/UserRole.ts',
  'src/services/rbac.ts',
  'src/services/roles.ts',
  'src/services/users.ts',
]);
const MODULE_PATHS = {
  users: [
    'src/pages/dashboard/users/index.ts',
    'src/pages/dashboard/users/new/index.ts',
    'src/pages/dashboard/users/[id]/index.ts',
  ],
  sessions: ['src/pages/dashboard/sessions/index.ts'],
  settings: ['src/pages/dashboard/profile/index.ts'],
  roles: [
    'src/pages/dashboard/roles/index.ts',
    'src/pages/dashboard/roles/new/index.ts',
    'src/pages/dashboard/roles/[id]/index.ts',
  ],
};
const EXAMPLE_PATHS = new Set([
  'src/components/Chat.ts',
  'src/pages/(public)/blog/hello-world.md',
  'src/pages/(public)/blog/index.ts',
  'src/pages/(public)/blog/layout.ts',
  'src/pages/(public)/contact.ts',
  'src/pages/(public)/index.ts',
  'src/pages/(public)/layout.ts',
]);

function capabilityFor(rel, recipe) {
  if (BASE_PATHS.has(rel) || rel.startsWith('public/') || rel === 'tsconfig.json') return 'base';
  if (UI_PATHS.has(rel)) return recipe.resolvedFeatures.includes('ui') ? 'ui' : null;
  if (DATABASE_PATHS.has(rel)) return recipe.resolvedFeatures.includes('database') ? 'database' : null;
  if (AUTH_PATHS.has(rel)) return recipe.resolvedFeatures.includes('auth') ? 'auth' : null;
  if (DASHBOARD_CORE_PATHS.has(rel)) return recipe.resolvedFeatures.includes('dashboard') ? 'dashboard' : null;
  if (RBAC_PATHS.has(rel)) {
    const modules = recipe.dashboardModules;
    return modules.includes('users') || modules.includes('roles') ? 'dashboard:rbac' : null;
  }
  for (const [module, paths] of Object.entries(MODULE_PATHS)) {
    if (paths.includes(rel)) return recipe.dashboardModules.includes(module) ? `dashboard:${module}` : null;
  }
  if (EXAMPLE_PATHS.has(rel)) return recipe.resolvedFeatures.includes('examples') ? 'examples' : null;
  return null;
}

async function walk(dir, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(absolute, rel));
    else if (entry.isFile()) result.push(rel);
  }
  return result;
}

function minimalApp() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export class App extends Cossack {
  render() {
    return html\`\${this.children}\`;
  }
}
`;
}

function minimalPage() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ transport: 'http' })
export default class HomePage extends Cossack {
  render() {
    return html\`<main><h1>Welcome to Cossack</h1><p>Edit src/pages/index.ts to get started.</p></main>\`;
  }
}
`;
}

function minimalRoot() {
  return `export const template = \`
<!doctype html>
<html lang="{{ cossackLang }}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    {{ cossackScripts }}
  </head>
  <body>{{ cossackBody }}</body>
</html>
\`;
`;
}

function middlewareRegistry(recipe) {
  const imports = ["import type { MiddlewareHandler } from 'hono';"];
  const entries = [];
  if (recipe.resolvedFeatures.includes('database')) {
    imports.push("import { dbMiddleware } from '../middlewares/db';");
    entries.push('  dbMiddleware,');
  }
  if (recipe.resolvedFeatures.includes('auth')) {
    imports.push("import { auth } from '../auth';", "import { authGuard } from '../middlewares/auth';");
    entries.push('  auth.middleware,', '  authGuard,');
  }
  return `${imports.join('\n')}\n\nconst middlewares: MiddlewareHandler[] = [\n${entries.join('\n')}\n];\n\nexport default middlewares;\n`;
}

function wranglerConfig(recipe, projectName) {
  const database = recipe.resolvedFeatures.includes('database') && recipe.config.database === 'd1'
    ? `,\n  "d1_databases": [{\n    "binding": "DB",\n    "database_name": "${projectName}-db",\n    "database_id": "<database_id>"\n  }]`
    : '';
  const email = recipe.resolvedFeatures.includes('auth')
    ? `,\n  "send_email": [{ "name": "EMAIL" }]`
    : '';
  return `{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "${projectName}",
  "compatibility_flags": ["nodejs_compat"],
  "compatibility_date": "2026-06-06",
  "main": "./src/index.ts",
  "assets": { "binding": "ASSETS" },
  "vars": {
    "APP_URL": "https://example.com",
    "APP_LOCALE": "en",
    "APP_SECRET": "PLEASE_CHANGE_THIS_SECRET"
  }${database}${email}
}
`;
}

function packageJson(recipe, projectName) {
  const dependencies = {
    '@cossackframework/core': `^${templateVersion}`,
    '@cossackframework/framework': `^${templateVersion}`,
    '@cossackframework/renderer': `^${templateVersion}`,
    cossack: `^${templateVersion}`,
    hono: '^4.12.31',
    'reflect-metadata': '^0.2.2',
  };
  if (recipe.resolvedFeatures.includes('ui')) {
    dependencies['@cossackframework/ui'] = `^${templateVersion}`;
    dependencies['@cossackframework/solar-icons'] = '^0.7.1';
  }
  if (recipe.resolvedFeatures.includes('database')) {
    dependencies['@cossackframework/database'] = `^${templateVersion}`;
    if (recipe.config.database === 'turso') dependencies['@tursodatabase/serverless'] = '^0.1.0';
  }
  if (recipe.resolvedFeatures.includes('auth')) dependencies['@cossackframework/auth'] = `^${templateVersion}`;
  if (recipe.adapter === 'node') {
    dependencies['@cossackframework/node-adapter'] = `^${templateVersion}`;
    dependencies['@hono/node-server'] = '^1.13.0';
    dependencies.ws = '^8.18.0';
    if (recipe.config.database === 'sqlite') dependencies['better-sqlite3'] = '^11.0.0';
  }
  const devDependencies = {
    '@types/node': '^22.0.0',
    '@tailwindcss/vite': '^4.1.0',
    prettier: '^3.4.0',
    tailwindcss: '^4.1.0',
    tsx: '^4.23.0',
    vite: '^8.1.4',
    vitest: '^4.1.10',
  };
  if (recipe.adapter === 'cloudflare') {
    devDependencies['@cloudflare/vite-plugin'] = '^1.44.0';
    devDependencies.wrangler = '^4.110.0';
  } else {
    devDependencies['@types/ws'] = '^8.18.0';
    if (recipe.config.database === 'sqlite') devDependencies['@types/better-sqlite3'] = '^7.6.13';
  }
  if (recipe.resolvedFeatures.includes('database') && recipe.config.database === 'd1') {
    devDependencies['better-sqlite3'] = '^11.0.0';
    devDependencies['@types/better-sqlite3'] = '^7.6.13';
  }
  return JSON.stringify({
    name: projectName,
    type: 'module',
    description: 'The Borderless TypeScript Framework',
    scripts: recipe.adapter === 'node'
      ? { dev: 'node scripts/dev.js', build: 'vite build', start: 'node dist/server/index.js' }
      : {
          dev: 'vite dev',
          build: 'vite build',
          'build:ssg': 'vite build && cossack ssg',
          deploy: 'vite build && cossack ssg && wrangler deploy',
        },
    dependencies,
    devDependencies,
  }, null, 2) + '\n';
}

function tursoConfig() {
  return `import { createDatabase, type DbClient } from '@cossackframework/database';
import { createClient as createTursoClient } from '@tursodatabase/serverless/compat';

export function createClient(env: { TURSO_URL?: string; TURSO_TOKEN?: string } = {}): DbClient {
  const url = env.TURSO_URL ?? process.env.TURSO_URL;
  if (!url) throw new Error('TURSO_URL is required');
  return createDatabase({
    dialect: 'libsql',
    client: createTursoClient({
      url,
      authToken: env.TURSO_TOKEN ?? process.env.TURSO_TOKEN,
    }),
  });
}

export async function getCliClient(): Promise<DbClient> {
  return createClient();
}
`;
}

function sqliteConfig() {
  return `import { Kysely, SqliteDialect, type DbClient } from '@cossackframework/database';
import Database from 'better-sqlite3';

export function createClient(env: { DB_PATH?: string } = {}): DbClient {
  const filename = env.DB_PATH ?? process.env.DB_PATH ?? './database.sqlite';
  return new Kysely({ dialect: new SqliteDialect({ database: new Database(filename) }) }) as DbClient;
}

export async function getCliClient(): Promise<DbClient> {
  return createClient();
}
`;
}

function nodeEntry() {
  return `import 'reflect-metadata';
import { serve } from '@hono/node-server';
import { pathToFileURL } from 'node:url';
import { createApp } from '@cossackframework/framework/router';
import { App } from './App';
import { template } from './root';

export const app = createApp({ AppComponent: App, htmlTemplate: template });
export const env: Record<string, unknown> = { DB_PATH: process.env.DB_PATH ?? './database.sqlite' };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  serve({ fetch: (request) => app.fetch(request, env), port: Number(process.env.PORT) || 3000 });
}
`;
}

function descriptor(module) {
  const definitions = {
    users: ['Users', '/dashboard/users', 'admin'],
    sessions: ['Sessions', '/dashboard/sessions', 'authenticated'],
    settings: ['Settings', '/dashboard/profile', 'authenticated'],
    roles: ['Roles', '/dashboard/roles', 'admin'],
  };
  const [label, href, permission] = definitions[module];
  return `import type { DashboardModule } from '../types';

const descriptor: DashboardModule = {
  id: '${module}',
  label: '${label}',
  href: '${href}',
  authorization: '${permission}',
};

export default descriptor;
`;
}

function dashboardRegistry(modules) {
  const imports = modules.map((module) => `import ${module} from './modules/${module}';`);
  return `import type { DashboardModule } from './types';
${imports.join('\n')}

export const dashboardModules: DashboardModule[] = [${modules.join(', ')}];
`;
}

function dashboardTypes() {
  return `export interface DashboardModule {
  id: string;
  label: string;
  href: string;
  authorization: 'authenticated' | 'admin';
}
`;
}

function dashboardLayout() {
  return `import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { dashboardModules } from '../../dashboard/registry';

@Page({ transport: 'http' })
export default class DashboardLayout extends Cossack {
  render() {
    const isAdmin = !!this.user?.roles?.some((role) => role.name === 'admin');
    const modules = dashboardModules.filter((module) =>
      module.authorization !== 'admin' || isAdmin,
    );
    return html\`
      <div class="min-h-screen grid grid-cols-[16rem_1fr]">
        <aside class="border-r p-4">
          <a href="/dashboard">Dashboard</a>
          <nav>\${modules.map((module) => html\`<a class="block py-2" href="\${module.href}">\${module.label}</a>\`)}</nav>
        </aside>
        <main class="p-8">\${this.children}</main>
      </div>
    \`;
  }
}
`;
}

function blankSeeder() {
  return `import type { DbClient } from '@cossackframework/database';

export default {
  async run(_db: DbClient) {
    // Add application seed data here.
  },
};
`;
}

function oauthConfig(providers) {
  return `export const oauthProviders = ${JSON.stringify(providers)} as const;
export type OAuthProvider = typeof oauthProviders[number];
`;
}

function applyOauthToAuth(content, providers) {
  if (!providers.length) return content;
  const providerConfig = providers.map((provider) => {
    const prefix = provider.toUpperCase();
    return `    ${provider}: {
      clientId: process.env.${prefix}_CLIENT_ID!,
      clientSecret: process.env.${prefix}_CLIENT_SECRET!,
      redirectUrl: \`/auth/${provider}/callback\`,
    },`;
  }).join('\n');
  return content
    .replace(
      "import { createAuth } from '@cossackframework/auth';",
      "import { createAuth, createOAuth, type OAuthUser, type TokenSet } from '@cossackframework/auth';",
    )
    .concat(`

export const oauth = createOAuth({
  secret: process.env.OAUTH_SECRET!,
  providers: {
${providerConfig}
  },
});

export async function handleOAuthUser(oauthUser: OAuthUser, _tokens: TokenSet, c: Context) {
  const user = {
    id: oauthUser.id,
    email: oauthUser.email ?? '',
    name: oauthUser.name ?? '',
    avatar: null,
    meta: null,
  };
  if (auth.createSession) {
    const { headers } = await auth.createSession(user as any, c);
    headers.forEach((value, key) => c.header(key, value));
  }
  return c.redirect(config('auth.redirectAfterLogin'));
}
`);
}

function withoutRbacQueries(content) {
  return content.replace(
    /\/\/ Reads a user's assigned roles[\s\S]*?\n}\n\nfunction parsePermissions[\s\S]*?\n}\n\n\/\/ --- Session create/,
    `// RBAC is installed only with the users or roles dashboard modules.
async function loadUserRoles(_userId: string): Promise<RoleAssignment[]> {
  return [];
}

// --- Session create`,
  );
}

function applyOauthToLogin(content, providers) {
  if (!providers.length) return content;
  const buttons = providers.map((provider) =>
    `            ${'${'}component(Button, { variant: 'outline', block: true }, html\`<a href="/auth/${provider}/redirect" class="block w-full text-center">Sign in with ${provider[0].toUpperCase() + provider.slice(1)}</a>\`)}`
  ).join('\n');
  return content.replace(
    '            <form @submit="${(e: Event) => this.handleSubmit(e)}" class="space-y-4">',
    `${buttons}\n            <div class="my-4 text-center text-sm text-muted-foreground">— or —</div>\n            <form @submit="\${(e: Event) => this.handleSubmit(e)}" class="space-y-4">`,
  );
}

function applyTheme(content, theme) {
  if (theme === 'default') return content;
  const marker = '@import "@cossackframework/ui/theme/theme.css";';
  return content.replace(marker, `${marker}\n@import "@cossackframework/ui/theme/themes/${theme}.css";`);
}

export async function renderRecipe(recipe, options = {}) {
  const files = new Map();
  for (const rel of await walk(templateDir)) {
    if (rel === 'package.json') continue;
    const capability = capabilityFor(rel, recipe);
    if (!capability) continue;
    let content = await fs.readFile(path.join(templateDir, rel));
    if (rel === 'src/style.css') content = text(applyTheme(content.toString('utf8'), recipe.config.theme));
    if (rel === 'src/config/auth.ts' && !recipe.resolvedFeatures.includes('dashboard')) {
      content = text(content.toString('utf8').replace(
        "env('AUTH_REDIRECT_AFTER_LOGIN', '/dashboard')",
        "env('AUTH_REDIRECT_AFTER_LOGIN', '/')",
      ));
    }
    if (rel === 'src/auth.ts') {
      let authContent = content.toString('utf8');
      if (!recipe.dashboardModules.some((module) => module === 'users' || module === 'roles')) {
        authContent = withoutRbacQueries(authContent);
      }
      content = text(applyOauthToAuth(authContent, recipe.config.oauth));
    }
    if (rel === 'src/pages/auth/login/index.ts') {
      content = text(applyOauthToLogin(content.toString('utf8'), recipe.config.oauth));
    }
    if (recipe.adapter === 'node' && ['wrangler.jsonc', 'worker-configuration.d.ts'].includes(rel)) continue;
    if (recipe.adapter === 'node' && rel === 'src/index.ts') content = text(nodeEntry());
    if (recipe.adapter === 'node' && rel === 'vite.config.ts') {
      content = text(content.toString('utf8').replace(/\/\/ @cossack:cloudflare-start[\s\S]*?\/\/ @cossack:cloudflare-end\n?/g, ''));
    }
    files.set(rel, { content, capability });
  }

  files.set('package.json', {
    content: text(packageJson(recipe, options.projectName ?? 'my-cossack-app')),
    capability: 'base',
  });
  files.set('tsconfig.json', {
    content: text(JSON.stringify({
      ...JSON.parse(await fs.readFile(path.join(packageDir, 'tsconfig.template.json'), 'utf8')),
      compilerOptions: {
        ...JSON.parse(await fs.readFile(path.join(packageDir, 'tsconfig.template.json'), 'utf8')).compilerOptions,
        types: recipe.adapter === 'node'
          ? ['reflect-metadata', 'vite/client', 'node']
          : ['reflect-metadata', './worker-configuration.d.ts', 'node'],
      },
    }, null, 2) + '\n'),
    capability: 'base',
  });
  files.set('src/bootstrap/middlewares.ts', {
    content: text(middlewareRegistry(recipe)),
    capability: 'base',
  });

  if (!recipe.resolvedFeatures.includes('ui')) {
    files.set('src/App.ts', { content: text(minimalApp()), capability: 'base' });
    files.set('src/root.ts', { content: text(minimalRoot()), capability: 'base' });
    files.set('src/style.css', { content: text('/* Application styles */\n'), capability: 'base' });
  }
  if (!recipe.resolvedFeatures.includes('examples')) {
    files.set('src/pages/index.ts', { content: text(minimalPage()), capability: 'base' });
  }
  if (recipe.resolvedFeatures.includes('database')) {
    if (recipe.config.database === 'turso') {
      files.set('src/db/config.ts', { content: text(tursoConfig()), capability: 'database' });
    } else if (recipe.config.database === 'sqlite') {
      files.set('src/db/config.ts', { content: text(sqliteConfig()), capability: 'database' });
    }
    if (!recipe.resolvedFeatures.includes('dashboard')) {
      files.set('src/seeders/database.seeder.ts', {
        content: text(blankSeeder()),
        capability: 'database',
      });
    }
  }
  if (recipe.resolvedFeatures.includes('auth')) {
    files.set('src/config/oauth.ts', {
      content: text(oauthConfig(recipe.config.oauth)),
      capability: 'auth',
    });
  }
  if (recipe.resolvedFeatures.includes('ui')) {
    files.set('src/components/ui/index.ts', {
      content: text("export * from '@cossackframework/ui';\n"),
      capability: 'ui',
    });
  }
  if (recipe.resolvedFeatures.includes('dashboard')) {
    files.set('src/dashboard/types.ts', { content: text(dashboardTypes()), capability: 'dashboard' });
    files.set('src/dashboard/registry.ts', {
      content: text(dashboardRegistry(recipe.dashboardModules)),
      capability: 'dashboard',
    });
    files.set('src/pages/dashboard/layout.ts', {
      content: text(dashboardLayout()),
      capability: 'dashboard',
    });
    for (const module of recipe.dashboardModules) {
      files.set(`src/dashboard/modules/${module}.ts`, {
        content: text(descriptor(module)),
        capability: `dashboard:${module}`,
      });
    }
  }
  if (recipe.adapter === 'cloudflare') {
    files.set('wrangler.jsonc', {
      content: text(wranglerConfig(recipe, options.projectName ?? 'my-cossack-app')),
      capability: 'base',
    });
  }
  return files;
}

async function access(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function readManifest(projectDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(projectDir, '.cossack/scaffold.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function currentHash(file) {
  try {
    return hash(await fs.readFile(file));
  } catch {
    return null;
  }
}

async function buildPlan(projectDir, rendered, manifest, force = false) {
  const writes = [];
  const deletes = [];
  const conflicts = [];
  const owned = manifest?.files ?? {};

  for (const [rel, entry] of rendered) {
    const absolute = path.join(projectDir, rel);
    const existingHash = await currentHash(absolute);
    const nextHash = hash(entry.content);
    if (existingHash === nextHash) continue;
    const baseline = typeof owned[rel] === 'string' ? owned[rel] : owned[rel]?.hash;
    const userOwned = existingHash !== null && !baseline;
    const modified = baseline && existingHash !== baseline;
    if ((userOwned || modified) && rel !== 'package.json' && !force) {
      conflicts.push(rel);
      continue;
    }
    writes.push({ path: rel, capability: entry.capability, overwrite: existingHash !== null });
  }

  for (const [rel, ownedEntry] of Object.entries(owned)) {
    if (rendered.has(rel)) continue;
    const baseline = typeof ownedEntry === 'string' ? ownedEntry : ownedEntry.hash;
    const existingHash = await currentHash(path.join(projectDir, rel));
    if (existingHash === null) continue;
    if (existingHash !== baseline && !force) {
      conflicts.push(rel);
      continue;
    }
    deletes.push({ path: rel, capability: ownedEntry.capability ?? 'base' });
  }
  return { writes, deletes, conflicts };
}

export async function planChanges(projectDir, recipe, manifest = undefined) {
  const resolvedManifest = manifest === undefined ? await readManifest(projectDir) : manifest;
  const projectName = path.basename(projectDir);
  const rendered = await renderRecipe(recipe, { projectName });
  return buildPlan(projectDir, rendered, resolvedManifest);
}

async function mergePackage(projectDir, rendered) {
  const entry = rendered.get('package.json');
  if (!entry || !(await access(path.join(projectDir, 'package.json')))) return;
  const current = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'));
  const desired = JSON.parse(entry.content.toString('utf8'));
  const merged = {
    ...current,
    scripts: { ...(current.scripts ?? {}), ...(desired.scripts ?? {}) },
    dependencies: { ...(current.dependencies ?? {}), ...(desired.dependencies ?? {}) },
    devDependencies: { ...(current.devDependencies ?? {}), ...(desired.devDependencies ?? {}) },
  };
  entry.content = text(JSON.stringify(merged, null, 2) + '\n');
}

async function applyPlan(projectDir, rendered, plan) {
  for (const change of plan.deletes) await fs.rm(path.join(projectDir, change.path), { force: true });
  for (const change of plan.writes) {
    const entry = rendered.get(change.path);
    const absolute = path.join(projectDir, change.path);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, entry.content);
  }
}

export async function writeManifest(projectDir, recipe, rendered) {
  const files = {};
  for (const [rel, entry] of rendered) {
    const contentHash = await currentHash(path.join(projectDir, rel));
    if (contentHash) files[rel] = { capability: entry.capability, hash: contentHash };
  }
  const manifest = {
    schemaVersion: 2,
    tool: '@cossackframework/scaffold',
    templateVersion,
    updatedAt: new Date().toISOString(),
    runtime: recipe.adapter,
    adapter: recipe.adapter,
    preset: recipe.preset,
    explicitFeatures: recipe.explicitFeatures,
    resolvedFeatures: recipe.resolvedFeatures,
    dashboardModules: recipe.dashboardModules,
    config: recipe.config,
    files,
  };
  const manifestDir = path.join(projectDir, '.cossack');
  await fs.mkdir(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, 'scaffold.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return manifestPath;
}

async function promptCreationOptions(options) {
  if (options.interactive !== true) return options;
  let cancelled = false;
  const onCancel = () => {
    cancelled = true;
    return false;
  };
  const primary = await prompts([
    !options.adapter && {
      type: 'select', name: 'adapter', message: 'Runtime adapter',
      choices: [{ title: 'Cloudflare Workers', value: 'cloudflare' }, { title: 'Node.js', value: 'node' }],
    },
    !options.preset && {
      type: 'select', name: 'preset', message: 'Project preset', initial: 3,
      choices: Object.keys(PRESET_REGISTRY).map((value) => ({ title: value, value })),
    },
  ].filter(Boolean), { onCancel });
  const selected = { ...options, ...primary };
  if (cancelled) return { ...selected, _cancelled: true };
  const provisional = resolveRecipe(selected);
  const configuration = await prompts([
    provisional.resolvedFeatures.includes('database') && options.database === undefined && {
      type: 'select', name: 'database', message: 'Database provider',
      choices: Object.entries(DATABASE_PROVIDERS)
        .filter(([, value]) => value.adapters.includes(provisional.adapter))
        .map(([value]) => ({ title: value, value })),
    },
    provisional.resolvedFeatures.includes('ui') && options.theme === undefined && {
      type: 'select', name: 'theme', message: 'UI theme',
      choices: UI_THEMES.map((value) => ({ title: value, value })),
    },
    provisional.resolvedFeatures.includes('auth') && options.oauth === undefined && {
      type: 'multiselect', name: 'oauth', message: 'OAuth providers (optional)',
      choices: OAUTH_PROVIDERS.map((value) => ({ title: value, value })),
    },
    provisional.resolvedFeatures.includes('dashboard') &&
      options.dashboardModules === undefined &&
      options.dashboardFeatures === undefined && {
        type: 'multiselect',
        name: 'dashboardModules',
        message: 'Dashboard modules',
        choices: DASHBOARD_MODULES.map((value) => ({ title: value, value, selected: true })),
      },
  ].filter(Boolean), { onCancel });
  return { ...selected, ...configuration, _cancelled: cancelled };
}

async function confirmPlan(plan, options) {
  if (options.yes || options.confirm === false || options.interactive !== true) return true;
  console.log('\nPlanned scaffold changes:');
  for (const change of plan.writes) {
    console.log(`  ${change.overwrite ? 'update' : 'create'}  ${change.path}  [${change.capability}]`);
  }
  for (const change of plan.deletes) {
    console.log(`  delete  ${change.path}  [${change.capability}]`);
  }
  const response = await prompts({
    type: 'confirm',
    name: 'confirmed',
    message: `Apply ${plan.writes.length} write(s) and ${plan.deletes.length} deletion(s)?`,
    initial: true,
  });
  return response.confirmed === true;
}

export async function createApp(projectName, options = {}) {
  if (!projectName) throw new Error('Please provide a project name');
  const prompted = await promptCreationOptions(options);
  const projectDir = path.resolve(prompted.cwd ?? process.cwd(), projectName);
  if (prompted._cancelled) {
    return {
      projectDir,
      adapter: prompted.adapter ?? 'cloudflare',
      manifestPath: path.join(projectDir, '.cossack/scaffold.json'),
      recipe: resolveRecipe({ ...prompted, interactive: false }),
      status: 'cancelled',
    };
  }
  const recipe = resolveRecipe(prompted);
  if (await access(projectDir) && (await fs.readdir(projectDir)).length > 0 && !prompted.force) {
    throw new Error(`Target directory is not empty: ${projectDir}`);
  }
  const rendered = await renderRecipe(recipe, { projectName: path.basename(projectDir) });
  const plan = await buildPlan(projectDir, rendered, null, prompted.force);
  if (plan.conflicts.length) throw new Error(`Scaffold conflicts: ${plan.conflicts.join(', ')}`);
  if (!await confirmPlan(plan, prompted)) {
    return { projectDir, adapter: recipe.adapter, manifestPath: path.join(projectDir, '.cossack/scaffold.json'), recipe, status: 'cancelled' };
  }
  await applyPlan(projectDir, rendered, plan);
  const manifestPath = await writeManifest(projectDir, recipe, rendered);
  return { projectDir, adapter: recipe.adapter, manifestPath, recipe };
}

async function inferRecipe(projectDir, manifest) {
  if (manifest?.schemaVersion === 2) {
    return resolveRecipe({
      adapter: manifest.runtime ?? manifest.adapter,
      preset: 'minimal',
      features: manifest.explicitFeatures ?? manifest.resolvedFeatures,
      database: manifest.config?.database,
      oauth: manifest.config?.oauth,
      theme: manifest.config?.theme,
      dashboardModules: manifest.dashboardModules,
    });
  }
  const pkg = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'));
  const dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const features = [];
  if (dependencies['@cossackframework/ui']) features.push('ui');
  if (dependencies['@cossackframework/database']) features.push('database');
  if (dependencies['@cossackframework/auth']) features.push('auth');
  return resolveRecipe({
    adapter: await access(path.join(projectDir, 'wrangler.jsonc')) ? 'cloudflare' : 'node',
    preset: 'minimal',
    features,
  });
}

async function promptAddOptions(current, feature, options) {
  if (options.interactive !== true) return options;
  const nextFeatures = resolveFeatures([...current.explicitFeatures, feature]);
  const questions = [];
  if (!current.resolvedFeatures.includes('database') &&
      nextFeatures.includes('database') &&
      options.database === undefined) {
    questions.push({
      type: 'select', name: 'database', message: 'Database provider',
      choices: Object.entries(DATABASE_PROVIDERS)
        .filter(([, value]) => value.adapters.includes(current.adapter))
        .map(([value]) => ({ title: value, value })),
    });
  }
  if (!current.resolvedFeatures.includes('ui') &&
      nextFeatures.includes('ui') &&
      options.theme === undefined) {
    questions.push({
      type: 'select', name: 'theme', message: 'UI theme',
      choices: UI_THEMES.map((value) => ({ title: value, value })),
    });
  }
  if (!current.resolvedFeatures.includes('auth') &&
      nextFeatures.includes('auth') &&
      options.oauth === undefined) {
    questions.push({
      type: 'multiselect', name: 'oauth', message: 'OAuth providers (optional)',
      choices: OAUTH_PROVIDERS.map((value) => ({ title: value, value })),
    });
  }
  let cancelled = false;
  const answers = await prompts(questions, {
    onCancel: () => {
      cancelled = true;
      return false;
    },
  });
  return { ...options, ...answers, _cancelled: cancelled };
}

export async function addFeature(projectDir, feature, options = {}) {
  if (!FEATURES.includes(feature)) {
    throw new Error(`Unknown feature "${feature}". Supported values: ${FEATURES.join(', ')}`);
  }
  const root = path.resolve(projectDir);
  const manifest = await readManifest(root);
  const current = await inferRecipe(root, manifest);
  const prompted = await promptAddOptions(current, feature, options);
  if (prompted._cancelled) {
    return {
      status: 'cancelled',
      recipe: current,
      changes: { writes: [], deletes: [], conflicts: [] },
      manifestPath: path.join(root, '.cossack/scaffold.json'),
    };
  }
  const alreadyInstalled = current.resolvedFeatures.includes(feature);
  const explicitFeatures = [...new Set([...current.explicitFeatures, feature])];
  let dashboardModules = current.dashboardModules;
  if (feature === 'dashboard') {
    const requested = prompted.features ?? prompted.dashboardModules;
    if (requested !== undefined) {
      const additions = resolveDashboardModules(requested, true);
      dashboardModules = DASHBOARD_MODULES.filter((module) =>
        [...current.dashboardModules, ...additions].includes(module),
      );
    } else if (!alreadyInstalled) {
      dashboardModules = [...DASHBOARD_MODULES];
    }
  }
  const recipe = resolveRecipe({
    adapter: current.adapter,
    preset: 'minimal',
    features: explicitFeatures,
    database: prompted.database ?? current.config.database,
    oauth: prompted.oauth ?? current.config.oauth,
    theme: prompted.theme ?? current.config.theme,
    dashboardModules,
  });
  const rendered = await renderRecipe(recipe, { projectName: path.basename(root) });
  await mergePackage(root, rendered);
  const plan = await buildPlan(root, rendered, manifest, prompted.force);
  if (plan.conflicts.length) {
    throw new Error(`Scaffold conflicts: ${plan.conflicts.join(', ')}. Re-run with --force to overwrite.`);
  }
  if (plan.writes.length === 0 && plan.deletes.length === 0) {
    return { status: 'present', recipe, changes: plan, manifestPath: path.join(root, '.cossack/scaffold.json') };
  }
  if (prompted.dryRun) {
    return { status: 'dry-run', recipe, changes: plan, manifestPath: path.join(root, '.cossack/scaffold.json') };
  }
  if (!await confirmPlan(plan, prompted)) {
    return { status: 'cancelled', recipe: current, changes: plan, manifestPath: path.join(root, '.cossack/scaffold.json') };
  }
  await applyPlan(root, rendered, plan);
  const manifestPath = await writeManifest(root, recipe, rendered);
  return { status: 'added', recipe, changes: plan, manifestPath };
}
