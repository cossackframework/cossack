import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import prompts from 'prompts';
import { parseDocument } from 'yaml';
import {
  ADAPTERS,
  FEATURES,
  AUTH_METHODS,
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
  AUTH_METHODS,
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
const scaffoldPackage = JSON.parse(
  await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'),
);
const templateVersion = scaffoldPackage.version;
const dependencyVersions = scaffoldPackage.scaffold?.dependencyVersions ?? {};
function dependencyVersion(name) {
  const version = dependencyVersions[name];
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Missing scaffold.dependencyVersions entry for ${name}`);
  }
  return version;
}
const text = (value) => Buffer.from(value, 'utf8');
const hash = (content) => createHash('sha256').update(content).digest('hex');
const LOCAL_ENV_CAPABILITY = 'local-environment';
const LOCAL_ENV_PATHS = new Set(['.env', '.dev.vars']);
const PNPM_MANAGED_BUILDS = new Set([
  'esbuild',
  'sharp',
  'workerd',
]);
const ADAPTER_PATHS = new Set([
  '.env.example',
  '.dev.vars.example',
  'deno.json',
  'package.json',
  'scripts/dev.js',
  'orm.config.ts',
  'src/orm/factory.ts',
  'src/orm/tooling.ts',
  'src/index.ts',
  'tsconfig.json',
  'vite.config.ts',
  'worker-configuration.d.ts',
  'wrangler.jsonc',
]);
const TRANSFERRED_ENV_NAMES = new Set([
  'APP_NAME',
  'APP_ENV',
  'APP_DEBUG',
  'APP_URL',
  'APP_LOCALE',
  'APP_FALLBACK_LOCALE',
  'APP_SECRET',
  'PORT',
  'CACHE_DRIVER',
  'CORS_ENABLED',
  'CORS_ORIGINS',
  'AUTH_REDIRECT_AFTER_LOGIN',
  'AUTH_REDIRECT_AFTER_LOGOUT',
  'MAIL_FROM',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'OAUTH_SECRET',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  ...OAUTH_PROVIDERS.flatMap((provider) => {
    const prefix = provider.toUpperCase();
    return [`${prefix}_CLIENT_ID`, `${prefix}_CLIENT_SECRET`];
  }),
]);

export class PromptAbortedError extends Error {
  constructor() {
    super('Prompt aborted');
    this.name = 'PromptAbortedError';
    this.code = 'COSSACK_PROMPT_ABORTED';
  }
}

let promptRunner = prompts;
let promptInputOverride;

/** @internal Test hook for deterministic prompt navigation/cancellation tests. */
export function _setPromptTestOverrides(overrides = undefined) {
  promptRunner = overrides?.prompt ?? prompts;
  promptInputOverride = overrides?.input;
}

function questionWithPreviousValue(question, previousValue) {
  const prepared = { ...question };
  delete prepared.when;
  if (previousValue === undefined) return prepared;
  if (prepared.type === 'select') {
    const index = prepared.choices.findIndex((choice) => choice.value === previousValue);
    if (index >= 0) prepared.initial = index;
  } else if (prepared.type === 'multiselect') {
    const selected = new Set(previousValue);
    prepared.choices = prepared.choices.map((choice) => ({
      ...choice,
      selected: selected.has(choice.value),
    }));
  } else {
    prepared.initial = previousValue;
  }
  return prepared;
}

async function promptOne(question, previousValue) {
  let cancelKind = 'abort';
  let cancelled = false;
  const input = question.stdin ?? promptInputOverride ?? process.stdin;
  const observeKey = (_input, key = {}) => {
    if (key.name === 'escape') cancelKind = 'back';
    else if ((key.ctrl && key.name === 'c') || (key.ctrl && key.name === 'd')) {
      cancelKind = 'abort';
    }
  };
  input.on?.('keypress', observeKey);
  try {
    const prepared = questionWithPreviousValue(question, previousValue);
    const answer = await promptRunner(prepared, {
      onCancel: () => {
        cancelled = true;
        return false;
      },
    });
    if (cancelled) {
      if (cancelKind === 'back') return { action: 'back' };
      throw new PromptAbortedError();
    }
    return { action: 'submit', value: answer[question.name] };
  } finally {
    input.removeListener?.('keypress', observeKey);
  }
}

async function promptWizard(questions, initialAnswers = {}, startAtLast = false) {
  const answers = { ...initialAnswers };
  let cursor = startAtLast ? Number.POSITIVE_INFINITY : 0;
  while (true) {
    const active = questions.filter((question) =>
      !question.when || question.when(answers),
    );
    if (cursor === Number.POSITIVE_INFINITY) cursor = Math.max(0, active.length - 1);
    if (cursor >= active.length) return answers;
    const rawQuestion = active[cursor];
    const question = {
      ...rawQuestion,
      choices: typeof rawQuestion.choices === 'function'
        ? rawQuestion.choices(answers)
        : rawQuestion.choices,
    };
    const result = await promptOne(question, answers[question.name]);
    if (result.action === 'back') {
      cursor = Math.max(0, cursor - 1);
      continue;
    }
    answers[question.name] = result.value;
    cursor += 1;
  }
}

const BASE_PATHS = new Set([
  '.prettierrc.json',
  '.vscode/cossack.code-snippets',
  'AGENTS.md',
  'pnpm-workspace.yaml',
  'README.md',
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
  'wrangler.jsonc',
  'vitest.config.ts',
]);
const UI_PATHS = new Set([
  'src/App.ts',
  'src/style.css',
  'src/stores.client.ts',
  'public/logo.svg',
]);
const ORM_PATHS = new Set([
  'orm.config.ts',
  'src/orm/factory.ts',
  'src/middlewares/orm.ts',
  'src/models/index.ts',
  'src/models/CacheItem.ts',
  'src/models/OAuthAccount.ts',
  'src/models/Role.ts',
  'src/models/Session.ts',
  'src/models/User.ts',
  'src/models/UserRole.ts',
  'src/migrations/index.ts',
  'src/seeders/index.ts',
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
const CREDENTIAL_AUTH_PATHS = new Set([
  'src/pages/auth/register/index.ts',
  'src/pages/auth/forgot-password/index.ts',
  'src/pages/auth/reset-password/index.ts',
]);
const DASHBOARD_CORE_PATHS = new Set([
  'src/pages/dashboard/index.ts',
  'src/pages/dashboard/layout.ts',
  'src/seeders/application.seeder.ts',
]);
const MARKDOWN_PATHS = new Set([
  'src/markdown-processor.ts',
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
const DESKTOP_PATHS = new Set([
  'src/desktop/index.ts',
  'forge.config.ts',
  'desktop-assets/icon.icns',
  'desktop-assets/icon.ico',
  'desktop-assets/linux.desktop.ejs',
  'desktop-assets/icon-16.png',
  'desktop-assets/icon-32.png',
  'desktop-assets/icon-64.png',
  'desktop-assets/icon-128.png',
  'desktop-assets/icon-256.png',
  'desktop-assets/icon-512.png',
  'desktop-assets/tray-linux-22.png',
  'desktop-assets/tray-linux-44.png',
  'desktop-assets/tray-macosTemplate.png',
  'desktop-assets/tray-macosTemplate@2x.png',
  'desktop-assets/tray-windows-16.png',
  'desktop-assets/tray-windows-32.png',
]);

function capabilityFor(rel, recipe) {
  if (BASE_PATHS.has(rel) || rel.startsWith('public/') || rel === 'tsconfig.json') return 'base';
  if (UI_PATHS.has(rel)) return recipe.resolvedFeatures.includes('ui') ? 'ui' : null;
  if (ORM_PATHS.has(rel)) return recipe.resolvedFeatures.includes('database') ? 'database' : null;
  if (AUTH_PATHS.has(rel)) return recipe.resolvedFeatures.includes('auth') ? 'auth' : null;
  if (DASHBOARD_CORE_PATHS.has(rel)) return recipe.resolvedFeatures.includes('dashboard') ? 'dashboard' : null;
  if (MARKDOWN_PATHS.has(rel)) return recipe.resolvedFeatures.includes('markdown') ? 'markdown' : null;
  if (RBAC_PATHS.has(rel)) {
    const modules = recipe.dashboardModules;
    return modules.includes('users') || modules.includes('roles') ? 'dashboard:rbac' : null;
  }
  for (const [module, paths] of Object.entries(MODULE_PATHS)) {
    if (paths.includes(rel)) return recipe.dashboardModules.includes(module) ? `dashboard:${module}` : null;
  }
  if (EXAMPLE_PATHS.has(rel)) return recipe.resolvedFeatures.includes('examples') ? 'examples' : null;
  if (DESKTOP_PATHS.has(rel)) return recipe.resolvedFeatures.includes('desktop') ? 'desktop' : null;
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
    imports.push(
      "import { ormRequestMiddleware, sessionMiddleware } from '../middlewares/orm';",
    );
    entries.push('  ormRequestMiddleware,');
  }
  if (recipe.resolvedFeatures.includes('auth')) {
    imports.push("import { auth } from '../auth';", "import { authGuard } from '../middlewares/auth';");
    entries.push('  sessionMiddleware,', '  auth.middleware,', '  authGuard,');
  }
  return `${imports.join('\n')}\n\nconst middlewares: MiddlewareHandler[] = [\n${entries.join('\n')}\n];\n\nexport default middlewares;\n`;
}

function wranglerConfig(recipe, projectName) {
  let database = '';
  if (recipe.resolvedFeatures.includes('database') && recipe.config.database === 'd1') {
    database = `,\n  "d1_databases": [{\n    "binding": "DB",\n    "database_name": "${projectName}-db",\n    "database_id": "00000000-0000-0000-0000-000000000000",\n    "preview_database_id": "${projectName}-local"\n  }]`;
  } else if (recipe.resolvedFeatures.includes('database') &&
      recipe.config.database.startsWith('hyperdrive-')) {
    database = `,\n  "hyperdrive": [{\n    "binding": "HYPERDRIVE",\n    "id": "00000000000000000000000000000000"\n  }]`;
  }
  const email = recipe.resolvedFeatures.includes('auth') &&
      recipe.config.authMethods.includes('credentials')
    ? `,\n  "send_email": [{ "name": "EMAIL" }]`
    : '';
  const compatibilityFlag = recipe.config.database.startsWith('hyperdrive-')
    ? 'nodejs_compat'
    : 'nodejs_als';
  return `{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "${projectName}",
  "compatibility_flags": ["${compatibilityFlag}"],
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
    hono: dependencyVersion('hono'),
  };
  if (recipe.resolvedFeatures.includes('ui')) {
    dependencies['@cossackframework/ui'] = `^${templateVersion}`;
    dependencies['@cossackframework/solar-icons'] =
      dependencyVersion('@cossackframework/solar-icons');
  }
  if (recipe.resolvedFeatures.includes('database')) {
    dependencies['@cossackframework/database'] = `^${templateVersion}`;
    dependencies['reflect-metadata'] = '^0.2.2';
    if (recipe.config.database === 'turso') {
      dependencies['@tursodatabase/serverless'] = dependencyVersion('@tursodatabase/serverless');
    } else if (recipe.adapter === 'deno' && recipe.config.database === 'sqlite') {
      dependencies['@tursodatabase/database'] = dependencyVersion('@tursodatabase/database');
    } else if (
      recipe.config.database === 'postgres' ||
      recipe.config.database === 'hyperdrive-postgres'
    ) {
      dependencies.pg = dependencyVersion('pg');
    } else if (
      recipe.config.database === 'mysql' ||
      recipe.config.database === 'hyperdrive-mysql'
    ) {
      dependencies.mysql2 = dependencyVersion('mysql2');
    }
  }
  if (recipe.resolvedFeatures.includes('auth')) dependencies['@cossackframework/auth'] = `^${templateVersion}`;
  if (recipe.adapter === 'node') {
    dependencies['@cossackframework/node-adapter'] = `^${templateVersion}`;
    dependencies['@hono/node-server'] = dependencyVersion('@hono/node-server');
    dependencies.ws = dependencyVersion('ws');
  } else if (recipe.adapter === 'deno') {
    dependencies['@cossackframework/deno-adapter'] = `^${templateVersion}`;
  }
  if (recipe.resolvedFeatures.includes('desktop')) {
    dependencies['@cossackframework/desktop'] = `^${templateVersion}`;
  }
  const devDependencies = {
    '@types/node': dependencyVersion('@types/node'),
    '@tailwindcss/vite': dependencyVersion('@tailwindcss/vite'),
    prettier: dependencyVersion('prettier'),
    tailwindcss: dependencyVersion('tailwindcss'),
    tsx: dependencyVersion('tsx'),
    typescript: dependencyVersion('typescript'),
    vite: dependencyVersion('vite'),
    vitest: dependencyVersion('vitest'),
  };
  if (recipe.adapter === 'deno') {
    devDependencies['@types/deno'] = '^2.3.0';
  }
  if (recipe.resolvedFeatures.includes('desktop')) {
    devDependencies.electron = dependencyVersion('electron');
    for (const name of [
      '@electron-forge/cli',
      '@electron-forge/maker-deb',
      '@electron-forge/maker-dmg',
      '@electron-forge/maker-wix',
      '@electron-forge/shared-types',
    ]) devDependencies[name] = dependencyVersion(name);
  }
  if (recipe.resolvedFeatures.includes('studio')) {
    devDependencies['@cossackframework/studio'] = `^${templateVersion}`;
  }
  if (recipe.resolvedFeatures.includes('markdown')) {
    for (const name of [
      '@types/mdast',
      'rehype-raw',
      'rehype-slug',
      'rehype-stringify',
      'remark-frontmatter',
      'remark-gfm',
      'remark-parse',
      'remark-rehype',
      'remark-sugar-high',
      'remark-toc',
      'unified',
      'vfile-matter',
    ]) {
      devDependencies[name] = dependencyVersion(name);
    }
  }
  if (recipe.adapter === 'cloudflare') {
    devDependencies['@cloudflare/vite-plugin'] =
      dependencyVersion('@cloudflare/vite-plugin');
    devDependencies.wrangler = dependencyVersion('wrangler');
  } else if (recipe.adapter === 'node') {
    devDependencies['@types/ws'] = dependencyVersion('@types/ws');
    if (
      recipe.resolvedFeatures.includes('database') &&
      (recipe.config.database === 'postgres' ||
        recipe.config.database === 'hyperdrive-postgres')
    ) {
      devDependencies['@types/pg'] = dependencyVersion('@types/pg');
    }
  }
  const scripts = recipe.adapter === 'node'
    ? {
        dev: 'node --env-file-if-exists=.env scripts/dev.js',
        build: 'vite build && vite build --ssr src/index.ts --outDir dist/server',
        start: 'node --env-file-if-exists=.env dist/server/index.js',
      }
    : recipe.adapter === 'deno'
      ? {
          dev: 'vite dev',
          build: 'vite build && vite build --ssr src/index.ts --outDir dist/server',
          start: 'deno run --allow-env --allow-net --allow-read dist/server/index.js',
          deploy: 'deno task build && deno deploy',
        }
      : {
        dev: 'vite dev',
        build: 'vite build',
        'build:ssg': 'vite build',
        'cf-typegen': 'wrangler types --env-interface CloudflareBindings',
        deploy: 'vite build && wrangler deploy',
      };
  if (recipe.resolvedFeatures.includes('desktop')) {
    scripts['build:desktop'] = 'vite build && vite build --mode desktop --ssr src/desktop/index.ts --outDir dist/desktop --minify false';
    scripts['desktop:dev'] = 'cossack-desktop';
    scripts['desktop:package'] = 'pnpm run build:desktop && electron-forge package';
    scripts['desktop:make'] = 'pnpm run build:desktop && electron-forge make';
    scripts['desktop:build'] = 'pnpm run desktop:make';
  }
  if (recipe.resolvedFeatures.includes('database')) {
    scripts.migrate = recipe.adapter === 'node'
      ? 'node --env-file-if-exists=.env ./node_modules/cossack/bin/cossack.js migration up'
      : recipe.adapter === 'deno'
        ? 'deno run -A npm:cossack migration up'
        : 'cossack migration up';
    scripts['schema:check'] = 'cossack schema check';
  }
  if (recipe.resolvedFeatures.includes('studio')) {
    scripts.studio = 'cossack studio';
  }
  return JSON.stringify({
    name: projectName,
    version: '0.1.0',
    type: 'module',
    ...(recipe.resolvedFeatures.includes('desktop') ? { engines: { node: '>=22' } } : {}),
    description: 'The Borderless TypeScript Framework',
    cossack: { runtime: recipe.adapter },
    scripts,
    dependencies,
    devDependencies,
    ...(recipe.resolvedFeatures.includes('desktop') ? { main: 'dist/desktop/index.js' } : {}),
  }, null, 2) + '\n';
}

function pnpmWorkspace(recipe) {
  // Forge's packager and native makers use these transitive packages during
  // installation. pnpm requires each build script to be approved explicitly.
  const desktopBuilds = [
    '@bitdisaster/exe-icon-extractor',
    'electron',
    'fs-xattr',
    'macos-alias',
  ];
  const builds = [
    ...(recipe.resolvedFeatures.includes('desktop') ? desktopBuilds : []),
    'esbuild',
    'sharp',
    'workerd',
  ];
  const overrides = recipe.resolvedFeatures.includes('desktop')
    ? `\n\noverrides:\n  '@electron/rebuild': ${dependencyVersion('@electron/rebuild')}\n`
    : '\n';
  return `${recipe.resolvedFeatures.includes('desktop') ? 'nodeLinker: hoisted\n\n' : ''}allowBuilds:\n${builds.map((name) => `  ${name.startsWith('@') ? `'${name}'` : name}: true`).join('\n')}${overrides}`;
}

function ormFactory(recipe) {
  const provider = recipe.config.database;
  if (recipe.adapter === 'deno') {
    const adapterImport = provider === 'sqlite'
      ? 'denoSQLite'
      : provider === 'turso'
        ? 'turso'
        : provider;
    const adapterExpression = provider === 'sqlite'
      ? "denoSQLite({ filename: env.DB_PATH ?? './database.sqlite' })"
      : provider === 'turso'
        ? `turso({
      url: required(env.TURSO_DATABASE_URL, 'TURSO_DATABASE_URL'),
      authToken: env.TURSO_AUTH_TOKEN,
    })`
        : provider === 'postgres'
          ? "postgres(required(env.DATABASE_URL, 'DATABASE_URL'))"
          : "mysql(required(env.DATABASE_URL, 'DATABASE_URL'))";
    return `import { createORM, type ORM } from '@cossackframework/database';
import { ${adapterImport} } from '@cossackframework/database/deno';
import { models } from '../models';

export type ORMEnvironment = Record<string, string | undefined>;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(\`\${name} is required\`);
  return value;
}

export function createToolingAdapter(env: ORMEnvironment = Deno.env.toObject()) {
  return ${adapterExpression};
}

export function createRequestORM(env: ORMEnvironment) {
  return createToolingAdapter(env).then((adapter) => createORM({ adapter, entities: models }));
}

let singleton: Promise<ORM> | undefined;
export function getORM(env: ORMEnvironment = Deno.env.toObject()): Promise<ORM> {
  return singleton ??= createRequestORM(env);
}
`;
  }
  if (recipe.adapter === 'node') {
    const adapterImport = provider === 'sqlite'
      ? 'nodeSQLite'
      : provider === 'turso'
        ? 'turso'
        : provider;
    const adapterExpression = provider === 'sqlite'
      ? "nodeSQLite({ filename: env.DB_PATH ?? './database.sqlite' })"
      : provider === 'turso'
        ? `turso({
      url: required(env.TURSO_DATABASE_URL, 'TURSO_DATABASE_URL'),
      authToken: env.TURSO_AUTH_TOKEN,
    })`
        : provider === 'postgres'
          ? "postgres(required(env.DATABASE_URL, 'DATABASE_URL'))"
          : "mysql(required(env.DATABASE_URL, 'DATABASE_URL'))";
    return `import { createORM, type ORM } from '@cossackframework/database';
import { ${adapterImport} } from '@cossackframework/database/node';
import { models } from '../models';

export type ORMEnvironment = Record<string, string | undefined>;

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(\`\${name} is required\`);
  return value;
}

export function createToolingAdapter(env: ORMEnvironment = process.env) {
  return ${adapterExpression};
}

let singleton: Promise<ORM> | undefined;

export function getORM(env: ORMEnvironment = process.env): Promise<ORM> {
  return singleton ??= createToolingAdapter(env).then((adapter) =>
    createORM({ adapter, entities: models }));
}
`;
  }

  const runtimeImport = provider === 'd1'
    ? 'd1'
    : provider === 'turso'
      ? 'turso'
      : provider === 'hyperdrive-postgres'
        ? 'hyperdrivePostgres'
        : 'hyperdriveMySQL';
  const adapterExpression = provider === 'd1'
    ? 'd1(env.DB)'
    : provider === 'turso'
      ? `turso({
      url: required(env.TURSO_DATABASE_URL, 'TURSO_DATABASE_URL'),
      authToken: env.TURSO_AUTH_TOKEN,
    })`
      : provider === 'hyperdrive-postgres'
        ? 'hyperdrivePostgres(env.HYPERDRIVE)'
        : 'hyperdriveMySQL(env.HYPERDRIVE)';
  const envShape = provider === 'd1'
    ? 'DB: D1Database;'
    : provider === 'turso'
      ? 'TURSO_DATABASE_URL?: string;\n  TURSO_AUTH_TOKEN?: string;'
      : 'HYPERDRIVE: Hyperdrive;';
  return `import { createORM } from '@cossackframework/database';
import type { Adapter } from '@cossackframework/database';
import { ${runtimeImport} } from '@cossackframework/database/cloudflare';
import { models } from '../models';

export interface ORMEnvironment {
  ${envShape}
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(\`\${name} is required\`);
  return value;
}

export async function createRuntimeAdapter(env: ORMEnvironment): Promise<Adapter> {
  return ${adapterExpression};
}

export async function createRequestORM(env: ORMEnvironment) {
  return createORM({ adapter: await createRuntimeAdapter(env), entities: models });
}
`;
}

function ormTooling() {
  return `import type { Adapter } from '@cossackframework/database';
import { getPlatformProxy } from 'wrangler';
import {
  createRuntimeAdapter,
  type ORMEnvironment,
} from './factory';

export async function createToolingAdapter(): Promise<Adapter> {
  const platform = await getPlatformProxy<ORMEnvironment>({ remoteBindings: false });
  const adapter = await createRuntimeAdapter(platform.env);
  const close = adapter.driver.close.bind(adapter.driver);
  adapter.driver.close = async () => {
    try {
      await close();
    } finally {
      await platform.dispose();
    }
  };
  return adapter;
}
`;
}

function ormConfiguration(recipe) {
  const toolingImport = recipe.adapter === 'node' || recipe.adapter === 'deno'
    ? "import { createToolingAdapter } from './src/orm/factory';"
    : "import { createToolingAdapter } from './src/orm/tooling';";
  return `import { defineConfig } from '@cossackframework/database';
${toolingImport}
import { models } from './src/models';
import { migrations } from './src/migrations';
import { seeds } from './src/seeders';

export default defineConfig({
  adapter: createToolingAdapter,
  entities: models,
  migrations,
  migrationDirectory: './src/migrations',
  seeds,
});
`;
}

function ormMiddlewareModule(recipe) {
  const runtime = recipe.adapter === 'node'
    ? `const orm = await getORM();
export const ormRequestMiddleware = ormMiddleware(orm);`
    : recipe.adapter === 'deno'
      ? `export const ormRequestMiddleware = ormMiddleware((context) =>
  createRequestORM(context.env as ORMEnvironment));`
      : `export const ormRequestMiddleware = ormMiddleware((context) =>
  createRequestORM(context.env as ORMEnvironment));`;
  const factoryImport = recipe.adapter === 'node'
    ? "import { getORM } from '../orm/factory';"
    : "import { createRequestORM, type ORMEnvironment } from '../orm/factory';";
  return `import {
  createDatabaseCacheStore,
  createDatabaseSessionStore,
  ormMiddleware,
} from '@cossackframework/database/cossack';
import { extendCacheDriver } from '@cossackframework/framework/cache';
import { createSessionMiddleware } from '@cossackframework/framework/session';
${factoryImport}

${runtime}

export const sessionMiddleware = createSessionMiddleware({
  store: createDatabaseSessionStore(),
});

extendCacheDriver('database', () => createDatabaseCacheStore());
`;
}

function modelsBarrel(recipe) {
  const names = [
    ...(recipe.resolvedFeatures.includes('auth')
      ? ['User', 'Session', 'OAuthAccount']
      : []),
    ...(recipe.dashboardModules.includes('roles') ||
        recipe.dashboardModules.includes('users')
      ? ['Role', 'UserRole']
      : []),
    'CacheItem',
  ];
  const imports = names.map((name) => `import { ${name} } from './${name}';`);
  const exports = names.map((name) => `export { ${name} } from './${name}';`);
  return `import 'reflect-metadata';
${imports.join('\n')}

${exports.join('\n')}

export const models = [${names.join(', ')}] as const;
`;
}

function registeredBarrel(kind, files) {
  const imports = files.map((file, index) =>
    `import item${index} from './${file.replace(/\.ts$/, '')}';`);
  return `${imports.join('\n')}

export const ${kind} = [${files.map((_, index) => `item${index}`).join(', ')}] as const;
`;
}

function oauthRouteBlock(providers, appName = 'app') {
  if (!providers.length) return '';
  return providers.map((provider) => `${appName}.get(
  '/auth/${provider}/redirect',
  oauth.redirect('${provider}'),
);
${appName}.get(
  '/auth/${provider}/callback',
  oauth.callback('${provider}', {
    onUser: (user, tokens, c) => handleOAuthUser('${provider}', user, tokens, c),
  }),
);`).join('\n');
}

function nodeEntry(providers = []) {
  const oauthImport = providers.length
    ? "import { oauth, handleOAuthUser } from './auth';\n"
    : '';
  const routes = oauthRouteBlock(providers, 'frameworkApp');
  return `import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApp } from '@cossackframework/framework/router';
import { serveStatic } from '@cossackframework/node-adapter';
import { App } from './App';
import { template } from './root';
${oauthImport}

const frameworkApp = createApp({ AppComponent: App, htmlTemplate: template });
${routes}
export const app = new Hono();
app.use('*', serveStatic({
  root: fileURLToPath(new URL('../client', import.meta.url)),
  index: false,
  cacheControl: (_filePath, urlPath) => urlPath.startsWith('/assets/') && /\\.[a-zA-Z0-9_-]{8,}\\.[^/]+$/.test(urlPath)
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate',
}));
app.route('/', frameworkApp);

export const env: Record<string, unknown> = {
  ...process.env,
  DB_PATH: process.env.DB_PATH ?? './database.sqlite',
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  serve({ fetch: (request) => app.fetch(request, env), port: Number(process.env.PORT) || 3000 });
}
`;
}

function denoEntry(providers = []) {
  const oauthImport = providers.length
    ? "import { oauth, handleOAuthUser } from './auth';\n"
    : '';
  const routes = oauthRouteBlock(providers, 'frameworkApp');
  return `import { createApp } from '@cossackframework/framework/router';
import { createDenoAdapter } from '@cossackframework/deno-adapter';
import { App } from './App';
import { template } from './root';
${oauthImport}
export const env: Record<string, unknown> = Deno.env.toObject();
export const runtime = createDenoAdapter({ env });
export const frameworkApp = createApp({
  AppComponent: App,
  htmlTemplate: template,
  runtimeAdapter: runtime,
});
${routes}
export default {
  fetch: (request: Request, requestEnv?: Record<string, unknown>) =>
    runtime.fetch(frameworkApp, request, requestEnv),
};

if (import.meta.main) {
  runtime.serve(frameworkApp);
}
`;
}

function desktopIdentifier(projectName) {
  const slug = path.basename(projectName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `dev.cossack.${slug || 'app'}`;
}

function denoConfiguration() {
  const tasks = {
    dev: 'pnpm run dev',
    build: 'pnpm run build',
    start: 'deno run --allow-env --allow-net --allow-read dist/server/index.js',
    deploy: 'deno task build && deno deploy',
  };
  return JSON.stringify({
    nodeModulesDir: 'auto',
    imports: {
      hono: `npm:hono@${dependencyVersion('hono')}`,
      vite: `npm:vite@${dependencyVersion('vite')}`,
    },
    tasks,
  }, null, 2) + '\n';
}

function desktopEntry(projectName) {
  return `import { app as electronApp, configureDesktopClose, createDesktopApp, electronRuntimeAdapter } from '@cossackframework/desktop';
import { createApp } from '@cossackframework/framework/router';
import { fileURLToPath } from 'node:url';
import { App } from '../App';
import { template } from '../root';

export const env: Record<string, unknown> = { ...process.env };
export const frameworkApp = createApp({
  AppComponent: App,
  htmlTemplate: template,
  runtimeAdapter: electronRuntimeAdapter,
});

async function main() {
  const desktop = await createDesktopApp({
    identifier: '${desktopIdentifier(projectName)}',
    productName: '${projectName.replaceAll("'", "\\'")}',
    assetsRoot: fileURLToPath(new URL('../client/', import.meta.url)),
    env,
    fetch: (request, requestEnv) => frameworkApp.fetch(request, requestEnv),
    window: {
      title: '${projectName.replaceAll("'", "\\'")}',
      icon: fileURLToPath(new URL('../../desktop-assets/icon-256.png', import.meta.url)),
    },
  });
  configureDesktopClose({
    window: desktop.mainWindow,
    behavior: 'quit',
    onQuit: () => desktop.quit(),
  });
}

void main().catch((error) => {
  console.error('Cossack Desktop failed to start.', error);
  electronApp.exit(1);
});
`;
}

function forgeConfiguration(projectName) {
  const identifier = desktopIdentifier(projectName);
  const executableName = identifier.slice('dev.cossack.'.length);
  const safeName = projectName.replaceAll("'", "\\'");
  return `import path from 'node:path';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerWix } from '@electron-forge/maker-wix';
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    prune: false,
    ignore: [/^\\/node_modules(?:\\/|$)/, /^\\/src(?:\\/|$)/, /^\\/public(?:\\/|$)/],
    name: '${safeName}',
    executableName: '${executableName}',
    appBundleId: '${identifier}',
    appCategoryType: 'public.app-category.developer-tools',
    icon: process.platform === 'darwin'
      ? 'desktop-assets/icon.icns'
      : process.platform === 'win32'
        ? 'desktop-assets/icon.ico'
        : 'desktop-assets/icon-512.png',
    ...(process.env.APPLE_IDENTITY ? { osxSign: { identity: process.env.APPLE_IDENTITY } } : {}),
    ...(process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID ? {
      osxNotarize: {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      },
    } : {}),
  },
  makers: [
    new MakerDeb({
      options: {
        name: '${executableName}',
        productName: '${safeName}',
        genericName: '${safeName}',
        description: '${safeName} desktop application',
        bin: '${executableName}',
        maintainer: 'Cossack Framework <maintainers@cossack.dev>',
        homepage: 'https://cossack.dev',
        desktopTemplate: path.resolve('desktop-assets/linux.desktop.ejs'),
        icon: 'desktop-assets/icon-512.png',
        categories: ['Utility'],
        section: 'utils',
      },
    }),
    new MakerWix({
      name: '${safeName}',
      manufacturer: 'Cossack Framework',
      appUserModelId: '${identifier}',
      icon: 'desktop-assets/icon.ico',
      exe: '${executableName}.exe',
    }),
    new MakerDMG({
      name: '${safeName}',
      format: 'ULFO',
    }),
  ],
};

export default config;
`;
}

function linuxDesktopTemplate(projectName) {
  return `[Desktop Entry]
Name=<%= productName %>
Comment=<%= description %>
GenericName=<%= genericName %>
Exec=<%= name %> --ozone-platform=x11 %U
Icon=<%= name %>
Type=Application
StartupNotify=true
StartupWMClass=${desktopIdentifier(projectName)}
Categories=<%= categories.join(';') %>;
`;
}

function descriptor(module) {
  const definitions = {
    users: {
      label: 'Users',
      href: '/dashboard/users',
      permission: 'admin',
      iconImport: "import { UsersGroupRoundedIcon as iconSvg } from '@cossackframework/solar-icons/users-group-rounded/line';",
      children: [
        ['All users', '/dashboard/users'],
        ['Add user', '/dashboard/users/new'],
      ],
    },
    sessions: {
      label: 'Sessions',
      href: '/dashboard/sessions',
      permission: 'authenticated',
      iconImport: "import { MonitorSmartphoneIcon as iconSvg } from '@cossackframework/solar-icons/monitor-smartphone/line';",
      placement: 'account',
    },
    settings: {
      label: 'Profile settings',
      href: '/dashboard/profile',
      permission: 'authenticated',
      iconImport: "import { UserCircleIcon as iconSvg } from '@cossackframework/solar-icons/user-circle/line';",
      placement: 'account',
    },
    roles: {
      label: 'Roles',
      href: '/dashboard/roles',
      permission: 'admin',
      iconImport: "import { ShieldKeyholeIcon as iconSvg } from '@cossackframework/solar-icons/shield-keyhole/line';",
      children: [
        ['All roles', '/dashboard/roles'],
        ['Add role', '/dashboard/roles/new'],
      ],
    },
  };
  const definition = definitions[module];
  const children = definition.children
    ? `\n  children: [\n${definition.children.map(([label, href]) =>
      `    { label: '${label}', href: '${href}' },`).join('\n')}\n  ],`
    : '';
  const placement = definition.placement
    ? `\n  placement: '${definition.placement}',`
    : '';
  return `import type { DashboardModule } from '../types';
${definition.iconImport}

const icon = { line: iconSvg };

const descriptor: DashboardModule = {
  id: '${module}',
  label: '${definition.label}',
  href: '${definition.href}',
  icon,
  authorization: '${definition.permission}',${placement}${children}
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
  return `import type { IconEntry } from '@cossackframework/solar-icons/types';

export interface DashboardModuleLink {
  label: string;
  href: string;
}

export interface DashboardModule {
  id: string;
  label: string;
  href: string;
  icon: IconEntry;
  authorization: 'authenticated' | 'admin';
  placement?: 'navigation' | 'account';
  children?: DashboardModuleLink[];
}
`;
}

function blankSeeder() {
  return `import { defineSeeder } from '@cossackframework/database';

export default defineSeeder({
  name: 'application',
  transaction: 'auto',
  async run({ orm, sql }) {
    // Add application seed data here.
  },
});
`;
}

function applyOauthToAuth(content, providers) {
  if (!providers.length) return content;
  const providerConfig = providers.map((provider) => {
    const prefix = provider.toUpperCase();
    return `    ${provider}: {
      clientId: String(c.env.${prefix}_CLIENT_ID ?? ''),
      clientSecret: String(c.env.${prefix}_CLIENT_SECRET ?? ''),
      redirectUrl: \`/auth/${provider}/callback\`,
    },`;
  }).join('\n');
  const providerEnvironment = providers.map((provider) => {
    const prefix = provider.toUpperCase();
    return `  ${provider}: {
    clientId: '${prefix}_CLIENT_ID',
    clientSecret: '${prefix}_CLIENT_SECRET',
  },`;
  }).join('\n');
  return content
    .replace(
      "import { createAuth } from '@cossackframework/auth';",
      "import { createAuth, createOAuth, type OAuthKit, type OAuthUser, type TokenSet } from '@cossackframework/auth';\nimport { OAuthAccount } from '@/models/OAuthAccount';",
    )
    .concat(`

const oauthProviderEnvironment = {
${providerEnvironment}
} as const;

function oauthConfigurationError(c: Context, provider: string): string | null {
  const providerEnvironment =
    oauthProviderEnvironment[provider as keyof typeof oauthProviderEnvironment];
  if (!providerEnvironment) {
    return \`Provider "\${provider}" is not enabled for this application.\`;
  }

  const missing = [
    providerEnvironment.clientId,
    providerEnvironment.clientSecret,
  ].filter((name) => !String(c.env[name] ?? '').trim());
  if (missing.length) {
    return \`Set \${missing.join(' and ')} before using \${provider} OAuth.\`;
  }

  if (String(c.env.OAUTH_SECRET ?? '').length < 16) {
    return 'Set OAUTH_SECRET to a random value of at least 16 characters (32+ bytes recommended).';
  }
  return null;
}

function oauthUnavailable(c: Context, provider: string, message: string): Response {
  console.warn(\`[Cossack OAuth] \${provider} is unavailable: \${message}\`);
  return c.json({
    error: 'OAuth is not configured',
    provider,
    message,
  }, 503);
}

function createOAuthForRequest(c: Context): OAuthKit {
  return createOAuth({
    secret: String(c.env.OAUTH_SECRET ?? ''),
    providers: {
${providerConfig}
    },
  });
}

export const oauth: OAuthKit = {
  redirect: (provider) => async (c, next) => {
    const error = oauthConfigurationError(c, provider);
    if (error) return oauthUnavailable(c, provider, error);
    return createOAuthForRequest(c).redirect(provider)(c, next);
  },
  callback: (provider, options) => async (c, next) => {
    const error = oauthConfigurationError(c, provider);
    if (error) return oauthUnavailable(c, provider, error);
    return createOAuthForRequest(c).callback(provider, options)(c, next);
  },
};

export async function handleOAuthUser(
  provider: string,
  oauthUser: OAuthUser,
  _tokens: TokenSet,
  c: Context,
) {
  const account = await OAuthAccount.findOne({
    where: { provider, providerUserId: oauthUser.id },
  });
  let user = account
    ? await User.findOne({ where: { id: account.userId } })
    : null;
  if (!user && oauthUser.email) {
    user = await User.findOne({ where: { email: oauthUser.email } });
  }
  if (!user) {
    const id = uuidv7();
    await User.insert({
      id,
      email: oauthUser.email ?? \`\${provider}-\${oauthUser.id}@oauth.invalid\`,
      name: oauthUser.name ?? oauthUser.nickname ?? null,
      passwordHash: null,
      avatar: oauthUser.avatar ?? null,
      meta: null,
      createdAt: new Date(),
    });
    user = await User.findOne({ where: { id } });
  }
  if (!user) throw new Error('Unable to provision OAuth user.');
  if (!account) {
    await OAuthAccount.insert({
      id: uuidv7(),
      userId: user.id,
      provider,
      providerUserId: oauthUser.id,
      createdAt: new Date(),
    });
  }
  if (auth.createSession) {
    const { headers } = await auth.createSession(publicUser(user), c);
    headers.forEach((value, key) => c.header(key, value));
  }
  return c.redirect(config('auth.redirectAfterLogin'));
}
`);
}

const OAUTH_PROVIDER_ICONS = {
  github: '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-4 shrink-0" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02.8-.22 1.65-.33 2.5-.33.85 0 1.7.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48C19.14 20.16 22 16.42 22 12c0-5.52-4.48-10-10-10z"/></svg>',
  google: '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-4 shrink-0"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09A6.5 6.5 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>',
  gitlab: '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-4 shrink-0" fill="#FC6D26"><path d="m23.96 13.59-1.35-4.14-2.66-8.2a.46.46 0 0 0-.87 0l-2.67 8.2H7.59l-2.67-8.2a.46.46 0 0 0-.87 0l-2.66 8.2-1.35 4.14a.91.91 0 0 0 .33 1.01L12 23.05l11.63-8.45a.91.91 0 0 0 .33-1.01z"/></svg>',
  facebook: '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-4 shrink-0" fill="#1877F2"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.7 4.53-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.09 24 18.1 24 12.07z"/></svg>',
  microsoft: '<svg aria-hidden="true" viewBox="0 0 24 24" class="size-4 shrink-0"><path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M13 1h10v10H13z"/><path fill="#00A4EF" d="M1 13h10v10H1z"/><path fill="#FFB900" d="M13 13h10v10H13z"/></svg>',
};

const OAUTH_PROVIDER_LABELS = {
  github: 'GitHub',
  google: 'Google',
  gitlab: 'GitLab',
  facebook: 'Facebook',
  microsoft: 'Microsoft',
};

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

function applyOauthToLogin(content, providers, authMethods) {
  if (!providers.length) return content;
  const buttons = providers.map((provider) => {
    const label = OAUTH_PROVIDER_LABELS[provider];
    return `                <a href="/auth/${provider}/redirect" data-oauth-provider="${provider}" class="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    ${OAUTH_PROVIDER_ICONS[provider]}
                    <span>Continue with ${label}</span>
                </a>`;
  }).join('\n');
  const oauthButtons = `            <div class="mt-4 space-y-2" aria-label="OAuth sign in options">
${buttons}
            </div>`;

  if (!authMethods.includes('credentials')) {
    return content
      .replace(/\n            <form @submit="[\s\S]*?<\/form>/, `\n${oauthButtons}`)
      .replace(/\n            <p class="mt-6[\s\S]*?<\/p>/, '');
  }

  const separator = `            <div class="mt-6 flex items-center gap-3" aria-hidden="true">
                <div class="h-px flex-1 bg-border"></div>
                <span class="text-xs font-medium uppercase text-muted-foreground">or</span>
                <div class="h-px flex-1 bg-border"></div>
            </div>`;
  return content.replace(
    '\n            </form>\n            <p class="mt-6',
    `\n            </form>\n${separator}\n${oauthButtons}\n            <p class="mt-6`,
  );
}

function generateAuthSecret() {
  return randomBytes(32).toString('base64url');
}

function ensureEnvironmentSecrets(recipe, existingSecrets) {
  const needsOAuthSecret = recipe.resolvedFeatures.includes('auth') &&
    recipe.config.authMethods.includes('oauth');
  const needsAppSecret = recipe.adapter === 'node';
  return {
    ...recipe,
    config: {
      ...recipe.config,
      ...(needsAppSecret
        ? {
            appSecret: existingSecrets?.appSecret ??
              recipe.config.appSecret ??
              generateAuthSecret(),
          }
        : {}),
      ...(needsOAuthSecret
        ? {
            authSecret: existingSecrets?.authSecret ??
              recipe.config.authSecret ??
              generateAuthSecret(),
          }
        : {}),
    },
  };
}

function publicRecipe(recipe) {
  const {
    appSecret: _appSecret,
    authSecret: _authSecret,
    ...config
  } = recipe.config;
  return { ...recipe, config };
}

function mergeEnvironmentContent(existing, values) {
  const normalized = existing && !existing.endsWith('\n') ? `${existing}\n` : (existing ?? '');
  let result = normalized;
  for (const [name, value] of values) {
    const pattern = new RegExp(`^${name}=(.*)$`, 'm');
    const current = result.match(pattern);
    if (!current) {
      result += `${name}=${value}\n`;
    } else if (!current[1] && value) {
      result = result.replace(pattern, `${name}=${value}`);
    }
  }
  return result;
}

function nodeEnvironmentValues(recipe, projectName, example = false) {
  const port = recipe.adapter === 'deno' ? '8000' : '3000';
  const values = [
    ['APP_NAME', projectName],
    ['APP_ENV', 'development'],
    ['APP_DEBUG', 'true'],
    ['APP_URL', `http://localhost:${port}`],
    ['APP_LOCALE', 'en'],
    ['APP_FALLBACK_LOCALE', 'en'],
    ['APP_SECRET', example
      ? 'replace-with-a-random-32-byte-secret'
      : (recipe.config.appSecret ?? generateAuthSecret())],
    ['PORT', port],
    ['CACHE_DRIVER', 'memory'],
    ['CORS_ENABLED', 'true'],
    ['CORS_ORIGINS', `http://localhost:${port}`],
  ];
  if (recipe.resolvedFeatures.includes('database')) {
    values.push(['DB_CONNECTION', recipe.config.database]);
    if (recipe.config.database === 'sqlite') {
      values.push(['DB_PATH', './database.sqlite']);
    } else if (recipe.config.database === 'turso') {
      values.push(['TURSO_DATABASE_URL', example ? 'https://your-database.turso.io' : '']);
      values.push(['TURSO_AUTH_TOKEN', example ? 'your-turso-token' : '']);
    } else {
      values.push(['DATABASE_URL', example
        ? `${recipe.config.database}://user:password@localhost:5432/database`
        : '']);
    }
  }
  if (recipe.resolvedFeatures.includes('auth')) {
    values.push(['AUTH_REDIRECT_AFTER_LOGIN',
      recipe.resolvedFeatures.includes('dashboard') ? '/dashboard' : '/']);
    values.push(['AUTH_REDIRECT_AFTER_LOGOUT', '/auth/login']);
    if (recipe.config.authMethods.includes('credentials')) {
      values.push(['MAIL_FROM', 'no-reply@localhost']);
      values.push(['SMTP_HOST', '']);
      values.push(['SMTP_PORT', '587']);
      values.push(['SMTP_SECURE', 'false']);
      values.push(['SMTP_USER', '']);
      values.push(['SMTP_PASS', '']);
    }
    if (recipe.config.authMethods.includes('oauth')) {
      values.push(['OAUTH_SECRET', example
        ? 'replace-with-a-random-32-byte-secret'
        : (recipe.config.authSecret ?? generateAuthSecret())]);
      for (const provider of recipe.config.oauth) {
        const prefix = provider.toUpperCase();
        values.push([`${prefix}_CLIENT_ID`, example ? `your-${provider}-client-id` : '']);
        values.push([`${prefix}_CLIENT_SECRET`, example ? `your-${provider}-client-secret` : '']);
      }
    }
  }
  return values;
}

function cloudflareEnvironmentValues(recipe, example = false) {
  const values = [];
  if (recipe.resolvedFeatures.includes('database') && recipe.config.database === 'turso') {
    values.push(
      ['TURSO_DATABASE_URL', example ? 'https://your-database.turso.io' : ''],
      ['TURSO_AUTH_TOKEN', example ? 'your-turso-token' : ''],
    );
  }
  if (recipe.resolvedFeatures.includes('auth') &&
      recipe.config.authMethods.includes('oauth')) {
    values.push(...oauthEnvironmentValues(recipe, example));
  }
  return values;
}

function oauthEnvironmentValues(recipe, example = false) {
  const values = [
    ['OAUTH_SECRET', example
      ? 'replace-with-a-random-32-byte-secret'
      : (recipe.config.authSecret ?? generateAuthSecret())],
  ];
  for (const provider of recipe.config.oauth) {
    const prefix = provider.toUpperCase();
    values.push([`${prefix}_CLIENT_ID`, example ? `your-${provider}-client-id` : '']);
    values.push([`${prefix}_CLIENT_SECRET`, example ? `your-${provider}-client-secret` : '']);
  }
  return values;
}

function environmentExample(values) {
  return values.map(([name, value]) => `${name}=${value}`).join('\n') + '\n';
}

async function readEnvironment(projectDir, adapter) {
  const rel = adapter === 'node' ? '.env' : '.dev.vars';
  try {
    const content = await fs.readFile(path.join(projectDir, rel), 'utf8');
    const read = (name) => content.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
    return {
      rel,
      content,
      secrets: {
        appSecret: read('APP_SECRET'),
        authSecret: read('OAUTH_SECRET'),
      },
    };
  } catch {
    return { rel, content: '', secrets: {} };
  }
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
    if (CREDENTIAL_AUTH_PATHS.has(rel) &&
        !recipe.config.authMethods.includes('credentials')) continue;
    const capability = capabilityFor(rel, recipe);
    if (!capability) continue;
    let content = await fs.readFile(path.join(templateDir, rel));
    if (rel === 'src/style.css') content = text(applyTheme(content.toString('utf8'), recipe.config.theme));
    if (rel === 'vite.config.ts' && recipe.resolvedFeatures.includes('markdown')) {
      content = text(content.toString('utf8')
        .replace(
          "import { cossackSsg } from '@cossackframework/framework/vite-ssg-plugin';",
          "import { cossackSsg } from '@cossackframework/framework/vite-ssg-plugin';\n" +
          "import { processMarkdown } from './src/markdown-processor.ts';",
        )
        .replace('    cossackPages(),', '    cossackPages({ markdownProcessor: processMarkdown }),'));
    }
    if (rel === 'src/config/database.ts') {
      content = text(content.toString('utf8').replace(
        "default: env('DB_CONNECTION', 'd1')",
        `default: env('DB_CONNECTION', '${recipe.config.database}')`,
      ));
    }
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
      content = text(applyOauthToLogin(
        content.toString('utf8'),
        recipe.config.oauth,
        recipe.config.authMethods,
      ));
    }
    if ((recipe.adapter === 'node' || recipe.adapter === 'deno') &&
        ['wrangler.jsonc', 'worker-configuration.d.ts'].includes(rel)) continue;
    if (recipe.adapter !== 'node' && rel === 'scripts/dev.js') continue;
    if (recipe.adapter === 'node' && rel === 'src/index.ts') {
      content = text(nodeEntry(
        recipe.config.authMethods.includes('oauth') ? recipe.config.oauth : [],
      ));
    }
    if (recipe.adapter === 'deno' && rel === 'src/index.ts') {
      content = text(denoEntry(
        recipe.config.authMethods.includes('oauth') ? recipe.config.oauth : [],
      ));
    }
    if ((recipe.adapter === 'node' || recipe.adapter === 'deno') && rel === 'vite.config.ts') {
      content = text(content.toString('utf8').replace(/\/\/ @cossack:cloudflare-start[\s\S]*?\/\/ @cossack:cloudflare-end\n?/g, ''));
    }
    if (rel === 'vite.config.ts') {
      let viteConfig = content.toString('utf8');
      if (!recipe.resolvedFeatures.includes('ui')) {
        viteConfig = viteConfig.replace(
          /^\s*exclude: \['@cossackframework\/solar-icons'\],\n/gm,
          '',
        );
      }
      const optionalPackages = [
        ['ui', '@cossackframework/ui'],
        ['ui', '@cossackframework/solar-icons'],
        ['auth', '@cossackframework/auth'],
        ['database', '@cossackframework/database'],
      ];
      for (const [feature, packageName] of optionalPackages) {
        if (!recipe.resolvedFeatures.includes(feature)) {
          viteConfig = viteConfig.replace(
            new RegExp(`^\\s*['\"]${packageName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}['\"],?\\n`, 'gm'),
            '',
          );
        }
      }
      content = text(viteConfig);
    }
    files.set(rel, { content, capability });
  }

  files.set('package.json', {
    content: text(packageJson(recipe, options.projectName ?? 'my-cossack-app')),
    capability: 'base',
  });
  files.set('pnpm-workspace.yaml', {
    content: text(pnpmWorkspace(recipe)),
    capability: 'base',
  });
  files.set('tsconfig.json', {
    content: text(JSON.stringify({
      ...JSON.parse(await fs.readFile(path.join(packageDir, 'tsconfig.template.json'), 'utf8')),
      compilerOptions: {
        ...JSON.parse(await fs.readFile(path.join(packageDir, 'tsconfig.template.json'), 'utf8')).compilerOptions,
        types: [
          ...(recipe.adapter === 'node'
            ? ['vite/client', 'node']
            : recipe.adapter === 'deno'
              ? ['vite/client', 'node']
              : ['vite/client', 'node']),
          ...(recipe.adapter === 'deno' ? ['@types/deno'] : []),
        ],
      },
      include: [
        'src/**/*.ts',
        ...(recipe.adapter === 'cloudflare' ? ['worker-configuration.d.ts'] : []),
      ],
    }, null, 2) + '\n'),
    capability: 'base',
  });
  files.set('src/bootstrap/middlewares.ts', {
    content: text(middlewareRegistry(recipe)),
    capability: 'base',
  });
  files.set('.gitignore', {
    content: text('node_modules/\ndist/\nout/\n.env\n.dev.vars\n'),
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
    files.set('orm.config.ts', {
      content: text(ormConfiguration(recipe)),
      capability: 'database',
    });
    files.set('src/orm/factory.ts', {
      content: text(ormFactory(recipe)),
      capability: 'database',
    });
    if (recipe.adapter === 'cloudflare') {
      files.set('src/orm/tooling.ts', {
        content: text(ormTooling()),
        capability: 'database',
      });
    }
    files.set('src/middlewares/orm.ts', {
      content: text(ormMiddlewareModule(recipe)),
      capability: 'database',
    });
    files.set('src/models/index.ts', {
      content: text(modelsBarrel(recipe)),
      capability: 'database',
    });
    const migrationFiles = [
      ...(recipe.resolvedFeatures.includes('auth')
        ? [
            '0001_create_users.ts',
            '0002_create_sessions.ts',
            '0005_create_oauth_accounts.ts',
          ]
        : []),
      ...(recipe.dashboardModules.includes('roles') ||
          recipe.dashboardModules.includes('users')
        ? ['0003_create_roles.ts', '0007_create_user_roles.ts']
        : []),
      '0006_create_cache_table.ts',
    ];
    files.set('src/migrations/index.ts', {
      content: text(registeredBarrel('migrations', migrationFiles)),
      capability: 'database',
    });
    const seedFiles = ['application.seeder.ts'];
    files.set('src/seeders/index.ts', {
      content: text(registeredBarrel('seeds', seedFiles)),
      capability: 'database',
    });
    if (!recipe.resolvedFeatures.includes('dashboard')) {
      files.set('src/seeders/application.seeder.ts', {
        content: text(blankSeeder()),
        capability: 'database',
      });
    }
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
  if (recipe.adapter === 'deno') {
    files.set('deno.json', {
      content: text(denoConfiguration()),
      capability: 'base',
    });
  }
  if (recipe.resolvedFeatures.includes('desktop')) {
    files.set('src/desktop/index.ts', {
      content: text(desktopEntry(options.projectName ?? 'my-cossack-app')),
      capability: 'desktop',
    });
    files.set('forge.config.ts', {
      content: text(forgeConfiguration(options.projectName ?? 'my-cossack-app')),
      capability: 'desktop',
    });
    files.set('desktop-assets/linux.desktop.ejs', {
      content: text(linuxDesktopTemplate(options.projectName ?? 'my-cossack-app')),
      capability: 'desktop',
    });
  }
  if (recipe.adapter === 'cloudflare' &&
      recipe.resolvedFeatures.includes('auth') &&
      recipe.config.authMethods.includes('oauth')) {
    const entry = files.get('src/index.ts');
    const source = entry.content.toString('utf8')
      .replace(
        "import { template } from './root';",
        "import { template } from './root';\nimport { oauth, handleOAuthUser } from './auth';",
      )
      .replace(
        '\nexport { AppDurableObject };',
        `\n${oauthRouteBlock(recipe.config.oauth)}\n\nexport { AppDurableObject };`,
      );
    files.set('src/index.ts', { ...entry, content: text(source) });
  }
  if (recipe.adapter === 'node' || recipe.adapter === 'deno') {
    const projectName = options.projectName ?? 'my-cossack-app';
    const values = nodeEnvironmentValues(recipe, projectName);
    files.set('.env', {
      content: text(mergeEnvironmentContent(
        options.environmentContent ?? options.authEnvContent,
        values,
      )),
      capability: LOCAL_ENV_CAPABILITY,
    });
    files.set('.env.example', {
      content: text(environmentExample(
        nodeEnvironmentValues(recipe, projectName, true),
      )),
      capability: 'base',
    });
  } else {
    const values = cloudflareEnvironmentValues(recipe);
    const exampleValues = cloudflareEnvironmentValues(recipe, true);
    if (values.length) {
    files.set('.dev.vars', {
      content: text(mergeEnvironmentContent(
        options.environmentContent ?? options.authEnvContent,
        values,
      )),
      capability: LOCAL_ENV_CAPABILITY,
    });
    }
    if (exampleValues.length) {
    files.set('.dev.vars.example', {
      content: text(environmentExample(exampleValues)),
      capability: 'database',
    });
    }
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

export async function detectProjectRuntime(projectDir, manifest = undefined) {
  const resolvedManifest = manifest === undefined ? await readManifest(projectDir) : manifest;
  const recorded = resolvedManifest?.runtime ?? resolvedManifest?.adapter;
  if (ADAPTERS.includes(recorded)) return recorded;
  let pkg = null;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'));
  } catch {
    // Runtime detection can still use adapter-specific files.
  }
  const packageRuntime = pkg?.cossack?.runtime;
  if (ADAPTERS.includes(packageRuntime)) return packageRuntime;
  const dependencies = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (dependencies['@cossackframework/deno-adapter']) return 'deno';
  if (dependencies['@cossackframework/node-adapter']) return 'node';
  if (dependencies['@cloudflare/vite-plugin'] || dependencies.wrangler) return 'cloudflare';
  if (await access(path.join(projectDir, 'wrangler.jsonc'))) return 'cloudflare';
  return undefined;
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
  const preserved = [];
  const owned = manifest?.files ?? {};
  const canForce = (rel) => typeof force === 'function' ? force(rel) : force;

  for (const [rel, entry] of rendered) {
    const absolute = path.join(projectDir, rel);
    const existingHash = await currentHash(absolute);
    const nextHash = hash(entry.content);
    const baseline = typeof owned[rel] === 'string' ? owned[rel] : owned[rel]?.hash;
    if (existingHash === nextHash) {
      if (existingHash !== null && !baseline) {
        preserved.push({
          path: rel,
          capability: entry.capability,
          reason: 'user-owned',
        });
      }
      continue;
    }
    const userOwned = existingHash !== null && !baseline;
    const modified = baseline && existingHash !== baseline;
    const recipeChanged = baseline && nextHash !== baseline;
    const mergeSafe = rel === 'package.json' ||
      rel === 'pnpm-workspace.yaml' ||
      entry.capability === LOCAL_ENV_CAPABILITY;
    if (modified && !recipeChanged && !mergeSafe && !canForce(rel)) {
      preserved.push({
        path: rel,
        capability: entry.capability,
        reason: existingHash === null ? 'locally-deleted' : 'locally-modified',
      });
      continue;
    }
    if ((userOwned || (modified && recipeChanged)) && !mergeSafe && !canForce(rel)) {
      conflicts.push(rel);
      continue;
    }
    writes.push({ path: rel, capability: entry.capability, overwrite: existingHash !== null });
  }

  for (const [rel, ownedEntry] of Object.entries(owned)) {
    if (rendered.has(rel)) continue;
    if (LOCAL_ENV_PATHS.has(rel) ||
        ownedEntry.capability === LOCAL_ENV_CAPABILITY) continue;
    const baseline = typeof ownedEntry === 'string' ? ownedEntry : ownedEntry.hash;
    const existingHash = await currentHash(path.join(projectDir, rel));
    if (existingHash === null) continue;
    if (existingHash !== baseline && !canForce(rel)) {
      conflicts.push(rel);
      continue;
    }
    deletes.push({ path: rel, capability: ownedEntry.capability ?? 'base' });
  }
  return { writes, deletes, conflicts, preserved };
}

export async function planChanges(projectDir, recipe, manifest = undefined) {
  const resolvedManifest = manifest === undefined ? await readManifest(projectDir) : manifest;
  const projectName = path.basename(projectDir);
  const rendered = await renderRecipe(recipe, { projectName });
  return buildPlan(projectDir, rendered, resolvedManifest);
}

function mergePackageSection(
  current = {},
  desired = {},
  previous = {},
  forceManaged = false,
) {
  const merged = { ...desired };
  for (const [name, currentValue] of Object.entries(current)) {
    if (name in desired) continue;
    if (name in previous &&
        (forceManaged || currentValue === previous[name])) continue;
    merged[name] = currentValue;
  }
  return merged;
}

async function mergePackage(
  projectDir,
  rendered,
  previousRendered = undefined,
  forceManaged = false,
) {
  const entry = rendered.get('package.json');
  if (!entry || !(await access(path.join(projectDir, 'package.json')))) return;
  const current = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'));
  const desired = JSON.parse(entry.content.toString('utf8'));
  const previousEntry = previousRendered?.get('package.json');
  const previous = previousEntry
    ? JSON.parse(previousEntry.content.toString('utf8'))
    : {};
  const previouslyManagedBuilds = new Set([
    ...PNPM_MANAGED_BUILDS,
    ...(previous.pnpm?.onlyBuiltDependencies ?? []),
  ]);
  const userBuilds = (current.pnpm?.onlyBuiltDependencies ?? []).filter(
    (name) => !previouslyManagedBuilds.has(name),
  );
  const merged = {
    ...current,
    cossack: { ...(current.cossack ?? {}), ...(desired.cossack ?? {}) },
    scripts: mergePackageSection(
      current.scripts,
      desired.scripts,
      previous.scripts,
      forceManaged,
    ),
    dependencies: mergePackageSection(
      current.dependencies,
      desired.dependencies,
      previous.dependencies,
      forceManaged,
    ),
    devDependencies: mergePackageSection(
      current.devDependencies,
      desired.devDependencies,
      previous.devDependencies,
      forceManaged,
    ),
  };
  if (current.pnpm) {
    const pnpm = { ...current.pnpm };
    delete pnpm.onlyBuiltDependencies;
    if (Object.keys(pnpm).length > 0) merged.pnpm = pnpm;
    else delete merged.pnpm;
  }
  entry.content = text(JSON.stringify(merged, null, 2) + '\n');
  await mergePnpmWorkspace(
    projectDir,
    rendered,
    previousRendered,
    userBuilds,
  );
}

async function mergePnpmWorkspace(
  projectDir,
  rendered,
  previousRendered = undefined,
  migratedBuilds = [],
) {
  const entry = rendered.get('pnpm-workspace.yaml');
  if (!entry) {
    throw new Error('Scaffold recipe did not render pnpm-workspace.yaml');
  }
  const workspacePath = path.join(projectDir, 'pnpm-workspace.yaml');
  const currentSource = await access(workspacePath)
    ? await fs.readFile(workspacePath, 'utf8')
    : entry.content.toString('utf8');
  const current = parseDocument(currentSource);
  if (current.errors.length > 0) {
    throw new Error(
      `Cannot update pnpm-workspace.yaml: ${current.errors[0].message}`,
    );
  }
  const desired = parseDocument(entry.content.toString('utf8')).toJS();
  const previousEntry = previousRendered?.get('pnpm-workspace.yaml');
  const previous = previousEntry
    ? parseDocument(previousEntry.content.toString('utf8')).toJS()
    : {};
  const currentBuilds = current.get('allowBuilds')?.toJSON?.() ?? {};
  const previousBuilds = previous.allowBuilds ?? {};
  const desiredBuilds = desired.allowBuilds ?? {};
  const mergedBuilds = {};
  for (const [name, value] of Object.entries(desiredBuilds)) {
    const userChanged = name in currentBuilds &&
      (!(name in previousBuilds) || currentBuilds[name] !== previousBuilds[name]);
    mergedBuilds[name] = userChanged ? currentBuilds[name] : value;
  }
  for (const [name, value] of Object.entries(currentBuilds)) {
    if (name in desiredBuilds) continue;
    if (name in previousBuilds && value === previousBuilds[name]) continue;
    mergedBuilds[name] = value;
  }
  for (const name of migratedBuilds) {
    if (!(name in mergedBuilds)) mergedBuilds[name] = true;
  }

  current.set('allowBuilds', mergedBuilds);
  entry.content = text(current.toString());
  return entry;
}

export async function migratePnpmBuildSettings(
  projectDir,
  recipe,
  options = {},
) {
  const packagePath = path.join(projectDir, 'package.json');
  const currentPackageSource = await fs.readFile(packagePath, 'utf8');
  const pkg = JSON.parse(currentPackageSource);
  const hasLegacyBuilds = pkg.pnpm &&
    Object.hasOwn(pkg.pnpm, 'onlyBuiltDependencies');
  const legacyBuilds = pkg.pnpm?.onlyBuiltDependencies ?? [];
  const migratedBuilds = legacyBuilds.filter(
    (name) => !PNPM_MANAGED_BUILDS.has(name),
  );
  if (hasLegacyBuilds) {
    delete pkg.pnpm.onlyBuiltDependencies;
    if (Object.keys(pkg.pnpm).length === 0) delete pkg.pnpm;
  }
  const nextPackageSource = hasLegacyBuilds
    ? JSON.stringify(pkg, null, 2) + '\n'
    : currentPackageSource;

  const workspacePath = path.join(projectDir, 'pnpm-workspace.yaml');
  const workspaceExists = await access(workspacePath);
  if (!hasLegacyBuilds && workspaceExists) {
    return {
      changed: false,
      packageChanged: false,
      workspaceChanged: false,
    };
  }
  const rendered = await renderRecipe(recipe, {
    projectName: path.basename(projectDir),
  });
  const workspaceEntry = await mergePnpmWorkspace(
    projectDir,
    rendered,
    undefined,
    migratedBuilds,
  );
  const currentWorkspaceSource = workspaceExists
    ? await fs.readFile(workspacePath, 'utf8')
    : null;
  const nextWorkspaceSource = workspaceEntry.content.toString('utf8');
  const packageChanged = currentPackageSource !== nextPackageSource;
  const workspaceChanged = currentWorkspaceSource !== nextWorkspaceSource;

  if (options.dryRun !== true) {
    if (packageChanged) await fs.writeFile(packagePath, nextPackageSource);
    if (workspaceChanged) {
      await fs.writeFile(workspacePath, nextWorkspaceSource);
    }
  }
  return {
    changed: packageChanged || workspaceChanged,
    packageChanged,
    workspaceChanged,
  };
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

export async function writeManifest(
  projectDir,
  recipe,
  rendered,
  previousManifest = undefined,
  plan = undefined,
) {
  const files = {};
  const written = plan
    ? new Set(plan.writes.map((change) => change.path))
    : undefined;
  for (const [rel, entry] of rendered) {
    if (entry.capability === LOCAL_ENV_CAPABILITY) continue;
    const previous = previousManifest?.files?.[rel];
    if (plan && !written.has(rel)) {
      if (previous) {
        files[rel] = {
          capability: entry.capability,
          hash: typeof previous === 'string' ? previous : previous.hash,
        };
      }
      // A matching pre-existing file without a prior manifest entry remains
      // user-owned; rendering the same bytes does not transfer ownership.
      continue;
    }
    const contentHash = await currentHash(path.join(projectDir, rel));
    if (contentHash) files[rel] = { capability: entry.capability, hash: contentHash };
  }
  const manifest = {
    schemaVersion: 3,
    tool: '@cossackframework/scaffold',
    templateVersion,
    updatedAt: new Date().toISOString(),
    runtime: recipe.adapter,
    preset: recipe.preset,
    explicitFeatures: recipe.explicitFeatures,
    resolvedFeatures: recipe.resolvedFeatures,
    dashboardModules: recipe.dashboardModules,
    config: publicRecipe(recipe).config,
    files,
  };
  const manifestDir = path.join(projectDir, '.cossack');
  await fs.mkdir(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, 'scaffold.json');
  const temporaryPath = path.join(
    manifestDir,
    `.scaffold.json.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(manifest, null, 2) + '\n');
    await fs.rename(temporaryPath, manifestPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
  return manifestPath;
}

function databaseChoices(adapter, includeAll = false) {
  return Object.entries(DATABASE_PROVIDERS)
    .filter(([, value]) => includeAll || value.adapters.includes(adapter))
    .map(([value, definition]) => ({
      title: `${value}${includeAll ? ` (${definition.adapters.join(' / ')})` : ''}`,
      value,
    }));
}

function authMethodChoices() {
  return [
    {
      title: 'Username/password',
      value: 'credentials',
      description: 'Email/password login, registration, and password reset.',
      selected: true,
    },
    {
      title: 'OAuth',
      value: 'oauth',
      description: 'Sign in through one or more external providers.',
    },
  ];
}

async function promptCreationOptions(options, previous = {}, startAtLast = false) {
  if (options.interactive !== true) return options;
  const recipeFor = (answers) => resolveRecipe({
    ...options,
    ...answers,
    authMethods: 'credentials',
    oauth: undefined,
  });
  const initialAuthMethods = options.authMethods ??
    previous.authMethods ??
    (options.oauth !== undefined && parseList(options.oauth).length
      ? ['credentials', 'oauth']
      : ['credentials']);
  const questions = [
    !options.adapter && {
      type: 'select', name: 'adapter', message: 'Runtime adapter',
      choices: [
        { title: 'Cloudflare Workers', value: 'cloudflare' },
        { title: 'Node.js', value: 'node' },
        { title: 'Deno', value: 'deno' },
      ],
    },
    !options.preset && {
      type: 'select', name: 'preset', message: 'Project preset', initial: 3,
      choices: Object.keys(PRESET_REGISTRY).map((value) => ({ title: value, value })),
    },
    options.database === undefined && {
      type: 'select', name: 'database', message: 'Database provider',
      choices: (answers) => databaseChoices(recipeFor(answers).adapter),
      when: (answers) => recipeFor(answers).resolvedFeatures.includes('database'),
    },
    options.theme === undefined && {
      type: 'select', name: 'theme', message: 'UI theme',
      choices: UI_THEMES.map((value) => ({ title: value, value })),
      when: (answers) => recipeFor(answers).resolvedFeatures.includes('ui'),
    },
    options.authMethods === undefined &&
      options.oauth === undefined && {
      type: 'multiselect',
      name: 'authMethods',
      message: 'Authentication methods',
      choices: authMethodChoices(),
      validate: (value) => value.length > 0 || 'Select at least one authentication method',
      when: (answers) => recipeFor(answers).resolvedFeatures.includes('auth'),
    },
    options.oauth === undefined && {
      type: 'multiselect', name: 'oauth', message: 'OAuth providers',
      choices: OAUTH_PROVIDERS.map((value) => ({ title: value, value })),
      validate: (value) => value.length > 0 || 'Select at least one OAuth provider',
      when: (answers) =>
        recipeFor(answers).resolvedFeatures.includes('auth') &&
        parseList(answers.authMethods).includes('oauth'),
    },
    options.dashboardModules === undefined &&
      options.dashboardFeatures === undefined && {
        type: 'multiselect',
        name: 'dashboardModules',
        message: 'Dashboard modules',
        choices: DASHBOARD_MODULES.map((value) => ({ title: value, value, selected: true })),
        when: (answers) => recipeFor(answers).resolvedFeatures.includes('dashboard'),
      },
  ].filter(Boolean);
  const answers = await promptWizard(
    questions,
    { ...previous, ...options, authMethods: initialAuthMethods },
    startAtLast,
  );
  if (!parseList(answers.authMethods).includes('oauth')) {
    answers.oauth = [];
  }
  return { ...options, ...answers };
}

async function confirmPlan(plan, options, summary = undefined) {
  if (options.yes || options.confirm === false || options.interactive !== true) return true;
  console.log('\nPlanned scaffold changes:');
  if (summary?.requested) console.log(`  requested  ${summary.requested}`);
  if (summary?.prerequisites?.length) {
    console.log(`  includes   ${summary.prerequisites.join(', ')}`);
  }
  if (summary?.dashboardModules?.length) {
    console.log(`  modules    ${summary.dashboardModules.join(', ')}`);
  }
  for (const change of plan.writes) {
    console.log(`  ${change.overwrite ? 'update' : 'create'}  ${change.path}  [${change.capability}]`);
  }
  for (const change of plan.deletes) {
    console.log(`  delete  ${change.path}  [${change.capability}]`);
  }
  for (const change of plan.preserved) {
    console.log(`  preserve  ${change.path}  [${change.reason}]`);
  }
  const result = await promptOne({
    type: 'confirm',
    name: 'confirmed',
    message: `Apply ${plan.writes.length} write(s) and ${plan.deletes.length} deletion(s)?`,
    initial: true,
  });
  if (result.action === 'back') return 'back';
  return result.value === true;
}

export async function createApp(projectName, options = {}) {
  if (!projectName) throw new Error('Please provide a project name');
  let previous = {};
  let startAtLast = false;
  while (true) {
    const prompted = await promptCreationOptions(options, previous, startAtLast);
    const projectDir = path.resolve(prompted.cwd ?? process.cwd(), projectName);
    const recipe = ensureEnvironmentSecrets(resolveRecipe(prompted));
    if (await access(projectDir) && (await fs.readdir(projectDir)).length > 0 && !prompted.force) {
      throw new Error(`Target directory is not empty: ${projectDir}`);
    }
    const rendered = await renderRecipe(recipe, {
      projectName: path.basename(projectDir),
      authSecret: recipe.config.authSecret,
    });
    const plan = await buildPlan(projectDir, rendered, null, prompted.force);
    if (plan.conflicts.length) throw new Error(`Scaffold conflicts: ${plan.conflicts.join(', ')}`);
    const confirmation = await confirmPlan(plan, prompted, {
      requested: `preset:${recipe.preset}`,
      prerequisites: recipe.resolvedFeatures,
      dashboardModules: recipe.dashboardModules,
    });
    if (confirmation === 'back') {
      previous = prompted;
      startAtLast = true;
      continue;
    }
    if (!confirmation) {
      return { projectDir, adapter: recipe.adapter, manifestPath: path.join(projectDir, '.cossack/scaffold.json'), recipe, status: 'cancelled' };
    }
    await applyPlan(projectDir, rendered, plan);
    const manifestPath = await writeManifest(projectDir, recipe, rendered, undefined, plan);
    return {
      status: 'created',
      projectDir,
      adapter: recipe.adapter,
      manifestPath,
      recipe: publicRecipe(recipe),
    };
  }
}

async function inferRecipe(projectDir, manifest) {
  if (manifest?.schemaVersion === 2) {
    throw new Error(
      'Scaffold manifest schema v2 uses the removed legacy Kysely database API. ' +
      'Back up the database, convert models and queries to the Active Record ' +
      '@cossackframework/database API, ' +
      'run `cossack schema check`, baseline migration history, then regenerate ' +
      'the manifest with Cossack 1.0.',
    );
  }
  if (manifest && manifest.schemaVersion !== 3) {
    throw new Error(
      `Unsupported scaffold manifest schema ${manifest.schemaVersion ?? '(missing)'}. ` +
      'Cossack 1.0 requires schema version 3.',
    );
  }
  if (manifest?.schemaVersion === 3) {
    return resolveRecipe({
      adapter: manifest.runtime ?? manifest.adapter,
      preset: 'minimal',
      features: manifest.explicitFeatures ?? manifest.resolvedFeatures,
      database: manifest.config?.database,
      authMethods: manifest.config?.authMethods,
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
  if (dependencies['@cossackframework/studio']) features.push('studio');
  if (dependencies['@cossackframework/auth']) features.push('auth');
  if (dependencies.unified && await access(path.join(projectDir, 'src/markdown-processor.ts'))) {
    features.push('markdown');
  }
  const runtime = await detectProjectRuntime(projectDir, manifest);
  const recipe = resolveRecipe({
    adapter: runtime ?? 'cloudflare',
    preset: 'minimal',
    features,
    authMethods: features.includes('auth') ? 'credentials' : undefined,
  });
  return runtime ? recipe : { ...recipe, adapter: 'unknown' };
}

function runtimeFromDatabase(database) {
  if (database === 'd1') return 'cloudflare';
  return undefined;
}

async function readLocalEnvironment(projectDir, rel) {
  try {
    return await fs.readFile(path.join(projectDir, rel), 'utf8');
  } catch {
    return '';
  }
}

function environmentValue(content, name) {
  return content.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
}

function transferEnvironmentValues(targetContent, sourceContent) {
  const values = [];
  for (const name of TRANSFERRED_ENV_NAMES) {
    const value = environmentValue(sourceContent, name);
    if (value) values.push([name, value]);
  }
  return mergeEnvironmentContent(targetContent, values);
}

function setEnvironmentValue(content, name, value) {
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  if (pattern.test(content)) return content.replace(pattern, `${name}=${value}`);
  const normalized = content && !content.endsWith('\n') ? `${content}\n` : content;
  return `${normalized}${name}=${value}\n`;
}

function adapterEnvironmentDefaults(recipe) {
  const values = [];
  if (recipe.resolvedFeatures.includes('database')) {
    values.push(['DB_CONNECTION', recipe.config.database]);
    if (recipe.config.database === 'turso') {
      values.push(['TURSO_DATABASE_URL', ''], ['TURSO_AUTH_TOKEN', '']);
    }
  }
  if (recipe.resolvedFeatures.includes('auth') &&
      recipe.config.authMethods.includes('oauth')) {
    values.push(...oauthEnvironmentValues(recipe));
  }
  return values;
}

function changedPackageFields(current, previous, desired) {
  const conflicts = [];
  const inspect = (section, currentValues = {}, previousValues = {}, desiredValues = {}) => {
    const managed = new Set([
      ...Object.keys(previousValues),
      ...Object.keys(desiredValues),
    ]);
    for (const name of managed) {
      const before = previousValues[name];
      const next = desiredValues[name];
      if (before === next) continue;
      const value = currentValues[name];
      if (value !== before && value !== next) {
        conflicts.push(`package.json#${section}.${name}`);
      }
    }
  };
  inspect('scripts', current.scripts, previous.scripts, desired.scripts);
  inspect(
    'dependencies',
    current.dependencies,
    previous.dependencies,
    desired.dependencies,
  );
  inspect(
    'devDependencies',
    current.devDependencies,
    previous.devDependencies,
    desired.devDependencies,
  );
  const currentRuntime = current.cossack?.runtime;
  const previousRuntime = previous.cossack?.runtime;
  const desiredRuntime = desired.cossack?.runtime;
  if (previousRuntime !== desiredRuntime &&
      currentRuntime !== previousRuntime &&
      currentRuntime !== desiredRuntime) {
    conflicts.push('package.json#cossack.runtime');
  }
  return conflicts;
}

async function packageFieldConflicts(projectDir, previousRendered, rendered) {
  const current = JSON.parse(
    await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'),
  );
  const previous = JSON.parse(
    previousRendered.get('package.json').content.toString('utf8'),
  );
  const desired = JSON.parse(
    rendered.get('package.json').content.toString('utf8'),
  );
  return changedPackageFields(current, previous, desired);
}

async function applyPlanAndManifestAtomically(
  projectDir,
  rendered,
  plan,
  recipe,
  manifest,
) {
  const manifestPath = path.join(projectDir, '.cossack/scaffold.json');
  const affected = new Set([
    ...plan.writes.map((change) => change.path),
    ...plan.deletes.map((change) => change.path),
    '.cossack/scaffold.json',
  ]);
  const snapshots = new Map();
  for (const rel of affected) {
    try {
      snapshots.set(rel, await fs.readFile(path.join(projectDir, rel)));
    } catch {
      snapshots.set(rel, null);
    }
  }
  try {
    await applyPlan(projectDir, rendered, plan);
    return await writeManifest(projectDir, recipe, rendered, manifest, plan);
  } catch (error) {
    for (const [rel, content] of snapshots) {
      const absolute = path.join(projectDir, rel);
      if (content === null) {
        await fs.rm(absolute, { force: true });
      } else {
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, content);
      }
    }
    throw error;
  }
}

function adapterSwitchResult(
  status,
  current,
  recipe,
  changes,
  manifestPath,
  databaseInstalled,
) {
  return {
    status,
    previousAdapter: current.adapter,
    targetAdapter: recipe.adapter,
    databaseChange: {
      previous: current.config.database,
      target: recipe.config.database,
      changed: current.config.database !== recipe.config.database,
      installed: databaseInstalled,
    },
    recipe: publicRecipe(recipe),
    changes,
    manifestPath,
  };
}

/**
 * Re-render a schema-v3 project for exactly one runtime adapter.
 */
export async function switchAdapter(projectDir, target, options = {}) {
  if (!ADAPTERS.includes(target)) {
    throw new Error(
      `Unknown adapter "${target ?? '(missing)'}". ` +
      `Supported values: ${ADAPTERS.join(', ')}`,
    );
  }
  const root = path.resolve(projectDir);
  const manifestPath = path.join(root, '.cossack/scaffold.json');
  const manifest = await readManifest(root);
  if (!manifest) {
    throw new Error(
      'Adapter switching requires a schema-v3 .cossack/scaffold.json manifest.',
    );
  }
  if (manifest.schemaVersion !== 3) {
    throw new Error(
      `Unsupported scaffold manifest schema ${manifest.schemaVersion ?? '(missing)'}. ` +
      'Adapter switching requires schema version 3.',
    );
  }
  const current = resolveRecipe({
    adapter: manifest.runtime ?? manifest.adapter,
    preset: manifest.preset ?? 'minimal',
    features: manifest.explicitFeatures ?? manifest.resolvedFeatures,
    database: manifest.config?.database,
    authMethods: manifest.config?.authMethods,
    oauth: manifest.config?.oauth,
    theme: manifest.config?.theme,
    dashboardModules: manifest.dashboardModules,
  });
  const empty = { writes: [], deletes: [], conflicts: [], preserved: [] };
  if (current.adapter === target) {
    return adapterSwitchResult(
      'present',
      current,
      current,
      empty,
      manifestPath,
      current.resolvedFeatures.includes('database'),
    );
  }

  const databaseInstalled = current.resolvedFeatures.includes('database');
  const targetDefault = target === 'cloudflare' ? 'd1' : target === 'deno' ? 'turso' : 'sqlite';
  const currentCompatible = DATABASE_PROVIDERS[current.config.database]
    ?.adapters.includes(target);
  const mustSelectDatabase = databaseInstalled &&
    !currentCompatible &&
    options.database === undefined;
  if (mustSelectDatabase &&
      (options.dryRun || options.interactive !== true)) {
    const supported = databaseChoices(target).map((choice) => choice.value);
    throw new Error(
      `Database provider "${current.config.database}" is not supported by the ` +
      `${target} adapter. Pass --database=${supported.join(' or --database=')}.`,
    );
  }

  let selectedDatabase = options.database ??
    (databaseInstalled && currentCompatible ? current.config.database : targetDefault);
  while (true) {
    if (mustSelectDatabase && options.interactive === true) {
      const selection = await promptOne({
        type: 'select',
        name: 'database',
        message: `Database provider for ${target}`,
        choices: databaseChoices(target),
      }, selectedDatabase);
      if (selection.action === 'back') continue;
      selectedDatabase = selection.value;
    }

    const targetEnvironmentRel = target === 'cloudflare' ? '.dev.vars' : '.env';
    const sourceEnvironmentRel = current.adapter === 'cloudflare' ? '.dev.vars' : '.env';
    const [targetEnvironment, sourceEnvironment] = await Promise.all([
      readLocalEnvironment(root, targetEnvironmentRel),
      readLocalEnvironment(root, sourceEnvironmentRel),
    ]);
    const transferredEnvironment = transferEnvironmentValues(
      targetEnvironment,
      sourceEnvironment,
    );
    let recipe = resolveRecipe({
      adapter: target,
      preset: manifest.preset ?? 'minimal',
      features: manifest.explicitFeatures ?? manifest.resolvedFeatures,
      database: selectedDatabase,
      authMethods: manifest.config?.authMethods,
      oauth: manifest.config?.oauth,
      theme: manifest.config?.theme,
      dashboardModules: manifest.dashboardModules,
    });
    recipe = ensureEnvironmentSecrets(recipe, {
      appSecret: environmentValue(targetEnvironment, 'APP_SECRET') ??
        environmentValue(sourceEnvironment, 'APP_SECRET'),
      authSecret: environmentValue(targetEnvironment, 'OAUTH_SECRET') ??
        environmentValue(sourceEnvironment, 'OAUTH_SECRET'),
    });
    const previousRendered = await renderRecipe(current, {
      projectName: path.basename(root),
      environmentContent: sourceEnvironment,
    });
    const rendered = await renderRecipe(recipe, {
      projectName: path.basename(root),
      environmentContent: transferredEnvironment,
    });
    let nextEnvironment = rendered.get(targetEnvironmentRel)?.content
      .toString('utf8') ?? transferredEnvironment;
    nextEnvironment = mergeEnvironmentContent(
      nextEnvironment,
      adapterEnvironmentDefaults(recipe),
    );
    if (databaseInstalled) {
      nextEnvironment = setEnvironmentValue(
        nextEnvironment,
        'DB_CONNECTION',
        recipe.config.database,
      );
    }
    if (nextEnvironment || targetEnvironment || sourceEnvironment) {
      rendered.set(targetEnvironmentRel, {
        content: text(nextEnvironment),
        capability: LOCAL_ENV_CAPABILITY,
      });
    }

    const packageConflicts = await packageFieldConflicts(
      root,
      previousRendered,
      rendered,
    );
    await mergePackage(root, rendered, previousRendered, options.force === true);
    const plan = await buildPlan(
      root,
      rendered,
      manifest,
      (rel) => options.force === true && ADAPTER_PATHS.has(rel),
    );
    if (!options.force) plan.conflicts.push(...packageConflicts);
    if (plan.conflicts.length) {
      throw new Error(
        `Scaffold conflicts: ${plan.conflicts.join(', ')}. ` +
        'Re-run with --force to replace runtime/provider-specific changes.',
      );
    }
    if (options.dryRun) {
      return adapterSwitchResult(
        'dry-run',
        current,
        recipe,
        plan,
        manifestPath,
        databaseInstalled,
      );
    }
    const confirmation = await confirmPlan(plan, options, {
      requested: `adapter ${target}`,
      prerequisites: current.config.database === recipe.config.database
        ? []
        : [`database ${current.config.database} → ${recipe.config.database}`],
    });
    if (confirmation === 'back') {
      if (!mustSelectDatabase) continue;
      selectedDatabase = undefined;
      continue;
    }
    if (!confirmation) {
      return adapterSwitchResult(
        'cancelled',
        current,
        current,
        plan,
        manifestPath,
        databaseInstalled,
      );
    }
    const writtenManifestPath = await applyPlanAndManifestAtomically(
      root,
      rendered,
      plan,
      recipe,
      manifest,
    );
    return adapterSwitchResult(
      'changed',
      current,
      recipe,
      plan,
      writtenManifestPath,
      databaseInstalled,
    );
  }
}

async function promptAddOptions(
  current,
  feature,
  options,
  previous = {},
  startAtLast = false,
) {
  const nextFeatures = resolveFeatures([
    ...new Set([...current.explicitFeatures, feature]),
  ]);
  const databaseNeeded = !current.resolvedFeatures.includes('database') &&
    nextFeatures.includes('database');
  const knownRuntime = ADAPTERS.includes(options.runtime)
    ? options.runtime
    : ADAPTERS.includes(options.adapter)
      ? options.adapter
      : ADAPTERS.includes(current.adapter)
        ? current.adapter
        : undefined;

  if (options.interactive !== true) {
    const database = options.database ??
      (current.resolvedFeatures.includes('database')
        ? current.config.database
        : undefined);
    const runtime = knownRuntime ??
      runtimeFromDatabase(options.database ?? (databaseNeeded ? database : undefined));
    if (!runtime) {
      throw new Error(
        `Could not determine the project runtime. Pass --runtime=${ADAPTERS.join(' or --runtime=')}.`,
      );
    }
    const authMethods = options.authMethods ??
      (!current.resolvedFeatures.includes('auth') &&
       options.oauth !== undefined &&
       parseList(options.oauth).length
        ? ['credentials', 'oauth']
        : current.config.authMethods);
    return { ...options, runtime, database, authMethods };
  }

  const questions = [];
  if (databaseNeeded && options.database === undefined) {
    questions.push({
      type: 'select', name: 'database', message: 'Database provider',
      choices: databaseChoices(knownRuntime, !knownRuntime),
    });
  }
  if (!knownRuntime) {
    questions.push({
      type: 'select',
      name: 'runtime',
      message: 'Project runtime',
      choices: [
        { title: 'Cloudflare Workers', value: 'cloudflare' },
        { title: 'Node.js', value: 'node' },
        { title: 'Deno', value: 'deno' },
      ],
      when: (answers) => {
        const database = options.database ?? answers.database;
        return !database || database === 'turso';
      },
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
      options.authMethods === undefined &&
      options.oauth === undefined) {
    questions.push({
      type: 'multiselect',
      name: 'authMethods',
      message: 'Authentication methods',
      choices: authMethodChoices(),
      validate: (value) => value.length > 0 || 'Select at least one authentication method',
    });
  }
  if (!current.resolvedFeatures.includes('auth') &&
      nextFeatures.includes('auth') &&
      options.oauth === undefined) {
    questions.push({
      type: 'multiselect', name: 'oauth', message: 'OAuth providers',
      choices: OAUTH_PROVIDERS.map((value) => ({ title: value, value })),
      validate: (value) => value.length > 0 || 'Select at least one OAuth provider',
      when: (answers) => parseList(
        options.authMethods ?? answers.authMethods,
      ).includes('oauth'),
    });
  }
  const initialAuthMethods = options.authMethods ??
    previous.authMethods ??
    (options.oauth !== undefined && parseList(options.oauth).length
      ? ['credentials', 'oauth']
      : current.config.authMethods ?? ['credentials']);
  const answers = await promptWizard(questions, {
    ...previous,
    ...options,
    authMethods: initialAuthMethods,
  }, startAtLast);
  const database = options.database ?? answers.database ??
    (databaseNeeded ? undefined : current.config.database);
  const runtime = knownRuntime ?? runtimeFromDatabase(database) ?? answers.runtime;
  if (!runtime) {
    throw new Error(
      `Could not determine the project runtime. Pass --runtime=${ADAPTERS.join(' or --runtime=')}.`,
    );
  }
  if (!parseList(answers.authMethods).includes('oauth')) answers.oauth = [];
  return { ...options, ...answers, database, runtime };
}

export async function addFeature(projectDir, feature, options = {}) {
  if (!FEATURES.includes(feature)) {
    throw new Error(`Unknown feature "${feature}". Supported values: ${FEATURES.join(', ')}`);
  }
  const root = path.resolve(projectDir);
  const manifest = await readManifest(root);
  const current = await inferRecipe(root, manifest);
  let previous = {};
  let startAtLast = false;
  while (true) {
    const prompted = await promptAddOptions(
      current,
      feature,
      options,
      previous,
      startAtLast,
    );
    const explicitFeatures = [...new Set([
      ...current.explicitFeatures,
      ...(feature === 'studio' &&
          !current.resolvedFeatures.includes('database') ? ['database'] : []),
      feature,
    ])];
    let dashboardModules = current.dashboardModules;
    if (feature === 'dashboard') {
      const requested = prompted.features ?? prompted.dashboardModules;
      if (requested !== undefined) {
        const additions = resolveDashboardModules(requested, true);
        dashboardModules = DASHBOARD_MODULES.filter((module) =>
          [...current.dashboardModules, ...additions].includes(module),
        );
      } else {
        dashboardModules = [...DASHBOARD_MODULES];
      }
    }
    const environment = await readEnvironment(root, prompted.runtime);
    let recipe = resolveRecipe({
      adapter: prompted.runtime,
      preset: 'minimal',
      features: explicitFeatures,
      database: prompted.database ?? current.config.database,
      authMethods: prompted.authMethods ?? current.config.authMethods,
      oauth: prompted.oauth ?? current.config.oauth,
      theme: prompted.theme ?? current.config.theme,
      dashboardModules,
    });
    recipe = ensureEnvironmentSecrets(recipe, environment.secrets);
    const addedFeatures = recipe.resolvedFeatures.filter(
      (candidate) => !current.resolvedFeatures.includes(candidate),
    );
    const addedDashboardModules = recipe.dashboardModules.filter(
      (module) => !current.dashboardModules.includes(module),
    );
    const rendered = await renderRecipe(recipe, {
      projectName: path.basename(root),
      authSecret: recipe.config.authSecret,
      environmentContent: environment.content,
    });
    await mergePackage(root, rendered);
    const plan = await buildPlan(root, rendered, manifest, prompted.force);
    if (plan.conflicts.length) {
      throw new Error(`Scaffold conflicts: ${plan.conflicts.join(', ')}. Re-run with --force to overwrite.`);
    }
    const recipeMetadataChanged = JSON.stringify(publicRecipe(recipe)) !==
      JSON.stringify(publicRecipe(current));
    if (plan.writes.length === 0 &&
        plan.deletes.length === 0 &&
        !recipeMetadataChanged) {
      return {
        status: 'present',
        recipe: publicRecipe(recipe),
        changes: plan,
        addedFeatures,
        addedDashboardModules,
        manifestPath: path.join(root, '.cossack/scaffold.json'),
      };
    }
    if (prompted.dryRun) {
      return {
        status: 'dry-run',
        recipe: publicRecipe(recipe),
        changes: plan,
        addedFeatures,
        addedDashboardModules,
        manifestPath: path.join(root, '.cossack/scaffold.json'),
      };
    }
    const confirmation = await confirmPlan(plan, prompted, {
      requested: feature,
      prerequisites: addedFeatures.filter((candidate) => candidate !== feature),
      dashboardModules: feature === 'dashboard' ? addedDashboardModules : [],
    });
    if (confirmation === 'back') {
      previous = prompted;
      startAtLast = true;
      continue;
    }
    if (!confirmation) {
      return {
        status: 'cancelled',
        recipe: current,
        changes: plan,
        addedFeatures: [],
        addedDashboardModules: [],
        manifestPath: path.join(root, '.cossack/scaffold.json'),
      };
    }
    await applyPlan(root, rendered, plan);
    const manifestPath = await writeManifest(root, recipe, rendered, manifest, plan);
    return {
      status: 'added',
      recipe: publicRecipe(recipe),
      changes: plan,
      addedFeatures,
      addedDashboardModules,
      manifestPath,
    };
  }
}

export async function removeFeatureFromProject(projectDir, feature, options = {}) {
  if (!FEATURES.includes(feature)) {
    throw new Error(`Unknown feature "${feature}". Supported values: ${FEATURES.join(', ')}`);
  }
  const root = path.resolve(projectDir);
  const manifest = await readManifest(root);
  const current = await inferRecipe(root, manifest);
  if (!current.resolvedFeatures.includes(feature)) {
    const empty = { writes: [], deletes: [], conflicts: [], preserved: [] };
    return {
      status: 'absent',
      recipe: publicRecipe(current),
      changes: empty,
      manifestPath: path.join(root, '.cossack/scaffold.json'),
    };
  }

  const explicitFeatures = removeFeature(current.explicitFeatures, feature);
  const environment = await readEnvironment(root, current.adapter);
  const recipe = resolveRecipe({
    adapter: current.adapter,
    preset: 'minimal',
    features: explicitFeatures,
    database: current.config.database,
    authMethods: current.config.authMethods,
    oauth: current.config.oauth,
    theme: current.config.theme,
    dashboardModules: current.dashboardModules,
  });
  const previousRendered = await renderRecipe(current, {
    projectName: path.basename(root),
    environmentContent: environment.content,
  });
  const rendered = await renderRecipe(recipe, {
    projectName: path.basename(root),
    environmentContent: environment.content,
  });
  await mergePackage(root, rendered, previousRendered);
  const plan = await buildPlan(root, rendered, manifest, options.force);
  if (plan.conflicts.length) {
    throw new Error(
      `Scaffold conflicts: ${plan.conflicts.join(', ')}. ` +
      'Re-run with --force to remove modified scaffold files.',
    );
  }
  if (plan.writes.length === 0 && plan.deletes.length === 0) {
    return {
      status: 'absent',
      recipe: publicRecipe(recipe),
      changes: plan,
      manifestPath: path.join(root, '.cossack/scaffold.json'),
    };
  }
  if (options.dryRun) {
    return {
      status: 'dry-run',
      recipe: publicRecipe(recipe),
      changes: plan,
      manifestPath: path.join(root, '.cossack/scaffold.json'),
    };
  }
  const removedFeatures = current.resolvedFeatures.filter(
    (candidate) => !recipe.resolvedFeatures.includes(candidate),
  );
  const confirmation = await confirmPlan(plan, options, {
    requested: `remove ${feature}`,
    prerequisites: removedFeatures.filter((candidate) => candidate !== feature),
  });
  if (confirmation === 'back' || !confirmation) {
    return {
      status: 'cancelled',
      recipe: publicRecipe(current),
      changes: plan,
      manifestPath: path.join(root, '.cossack/scaffold.json'),
    };
  }
  await applyPlan(root, rendered, plan);
  const manifestPath = await writeManifest(root, recipe, rendered, manifest, plan);
  return {
    status: 'removed',
    recipe: publicRecipe(recipe),
    changes: plan,
    manifestPath,
  };
}
