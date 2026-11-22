import { workflowsRecipeFiles } from './workflow-recipes.js';
import { DASHBOARD_PACKAGE, dashboardConfigFile, dashboardSourceDir, isServedDashboardPath, mountsDashboard } from './dashboard-recipe.js';
export { DASHBOARD_PACKAGE, SERVED_DASHBOARD_PATHS, isServedDashboardPath } from './dashboard-recipe.js';
import { CMS_PACKAGE, cmsRecipeFiles, cmsSetupCode, isCmsPath, isServedCmsPath, patchCmsNodeEntry, patchCmsWorkerEntry } from './cms-recipe.js';
import { jobsRecipeFiles, turnstileRecipeFiles, schedulesRecipeFiles, notificationsRecipeFiles } from './service-recipes.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import prompts from 'prompts';
import { parseDocument } from 'yaml';
import { ASSETS_RUN_WORKER_FIRST } from '@cossackframework/core/static-assets';
import { dependencyBaseline, planDependencyChanges } from './dependencies.js';
export { dependencyBaseline, planDependencyChanges } from './dependencies.js';
import { mergeText } from './merge.js';
export { mergeText, diffLines, hasConflictMarkers, MERGE_SIZE_LIMIT } from './merge.js';
import { putBase, readBase, pruneBases, BASE_DIRECTORY } from './base-store.js';
export { putBase, readBase, pruneBases, BASE_DIRECTORY } from './base-store.js';
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
  recipeCapabilityRequirements,
  recipeCapabilityDiagnostics,
  projectNameProblem,
  authStore,
  jobLedger,
  ormOnRomeDB,
} from './registry.js';

export {
  projectNameProblem,
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
  recipeCapabilityRequirements,
  recipeCapabilityDiagnostics,
  jobLedger,
  ormOnRomeDB,
};

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const templateDir = path.join(packageDir, 'template');
const scaffoldPackage = JSON.parse(
  await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'),
);
const templateVersion = scaffoldPackage.version;
const dependencyVersions = scaffoldPackage.scaffold?.dependencyVersions ?? {};
/**
 * The README for this recipe: the template marks the parts that are about one runtime, one
 * database or the CMS (`<!-- @cossack:name -->` to `<!-- /@cossack:name -->`), and only the
 * ones the project has are kept.
 */
export function readmeFor(template, recipe) {
  const database = recipe.resolvedFeatures.includes('database') && recipe.adapter === 'cloudflare' ? recipe.config.database : '';
  const kept = {
    cloudflare: recipe.adapter === 'cloudflare',
    node: recipe.adapter === 'node',
    cms: recipe.resolvedFeatures.includes('cms'),
    d1: database === 'd1',
    hyperdrive: database.startsWith('hyperdrive-'),
    'cloudflare-database': database === 'd1' || database.startsWith('hyperdrive-'),
  };
  let result = template;
  // Inner parts first, so a kept part can hold others.
  for (let pass = 0; pass < 3; pass++) {
    result = result.replace(/<!-- @cossack:([a-z0-9-]+) -->\n((?:(?!<!-- @cossack:)[\s\S])*?)<!-- \/@cossack:\1 -->\n/g, (_, name, body) => kept[name] ? body : '');
  }
  return `${result.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

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
/** Schema 4 records a merge base per file. Schema 3 is read as a manifest without bases. */
export const MANIFEST_SCHEMA_VERSION = 4;
const supportedManifest = manifest => manifest?.schemaVersion === 3 || manifest?.schemaVersion === MANIFEST_SCHEMA_VERSION;
// These merge by key, never by line, so they keep no base text.
const KEY_MERGED = new Set(['package.json', 'pnpm-workspace.yaml']);
const LOCAL_ENV_PATHS = new Set(['.env', '.dev.vars']);
const PNPM_MANAGED_BUILDS = new Set([
  'esbuild',
  'sharp',
  'workerd',
]);
const ADAPTER_PATHS = new Set([
  '.github/workflows/preview.yml',
  '.env.example',
  '.dev.vars.example',
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
  '.vscode/settings.json',
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
  'src/migrations/index.ts',
  'src/seeders/index.ts',
  'src/migrations/0006_create_cache_table.ts',
]);
const AUTH_PATHS = new Set([
  'src/auth-input.ts',
  'src/auth-options.ts',
  'src/auth-providers.ts',
  'src/pages/auth/[provider]/redirect.ts',
  'src/pages/auth/[provider]/callback.ts',
  'src/auth-bot-check.ts',
  'src/auth-bot-token.ts',
  'src/auth.ts',
  'src/config/auth.ts',
  'src/middlewares/auth.ts',
  'src/pages/auth/forgot-password/index.ts',
  'src/pages/auth/layout.ts',
  'src/brand.ts',
  'src/pages/auth/login/index.ts',
  'src/pages/auth/register/index.ts',
  'src/pages/auth/reset-password/index.ts',
  'src/pages/auth/two-factor/index.ts',
  'src/pages/auth/setup/index.ts',
  'src/pages/auth/verify/index.ts',
  'src/pages/auth/magic/index.ts',
  'src/passkeys.client.ts',
]);
/** Auth storage on the ORM; the CMS store keeps users and sessions in RomeDB instead. */
const AUTH_ORM_PATHS = new Set([
  'src/lib/uuid.ts',
  'src/services/security.ts',
  'src/migrations/0001_create_users.ts',
  'src/migrations/0002_create_sessions.ts',
  'src/migrations/0008_add_session_public_id.ts',
  'src/migrations/0005_create_oauth_accounts.ts',
  'src/migrations/0009_create_account_security.ts',
  'src/migrations/0010_add_user_status.ts',
  'src/migrations/0011_create_api_tokens.ts',
  'src/migrations/0012_create_tenants.ts',
  'src/migrations/0013_add_network_admin.ts',
  'src/migrations/0014_tenant_lifecycle.ts',
  'src/migrations/0015_tenant_sessions.ts',
  'src/services/api-tokens.ts',
  'src/services/tenants.ts',
  'src/tenants.ts',
  'src/mail.ts',
  'src/avatars.ts',
  'src/auth-events.ts',
  'src/middlewares/tenant.ts',
  'src/models/ApiToken.ts',
  'src/models/Tenant.ts',
  'src/models/TenantDomain.ts',
  'src/models/TenantMember.ts',
  'src/models/TenantHandoff.ts',
  'src/models/TenantNetwork.ts',
  'src/models/TenantSession.ts',
  'src/models/User.ts',
  'src/models/Session.ts',
  'src/models/OAuthAccount.ts',
  'src/models/UserSecurity.ts',
  'src/models/Passkey.ts',
  'src/models/AuthChallenge.ts',
  'src/models/AuthAttempt.ts',
]);
const DASHBOARD_CORE_PATHS = new Set([
  'src/dashboard/access.ts',
  'src/dashboard/agent-icons.ts',
  'src/dashboard/app-passwords.ts',
  'src/dashboard/avatar-field.ts',
  'src/dashboard/bulk.ts',
  'src/dashboard/icons.ts',
  'src/dashboard/head.ts',
  'src/dashboard/list-table.ts',
  'src/dashboard/page.ts',
  'src/dashboard/tabs.ts',
  'src/dashboard/time-ago.ts',
  'src/dashboard/session-list.ts',
  'src/dashboard/types.ts',
  'src/dashboard/registry.ts',
  'src/dashboard/modules/users.ts',
  'src/dashboard/modules/sessions.ts',
  'src/dashboard/modules/settings.ts',
  'src/dashboard/modules/roles.ts',
  'src/pages/dashboard/index.ts',
  'src/pages/dashboard/layout.ts',
]);
const RBAC_PATHS = new Set([
  'src/lib/permissions.ts',
  'src/services/rbac.ts',
  'src/services/roles.ts',
  'src/services/users.ts',
]);
const RBAC_ORM_PATHS = new Set([
  'src/migrations/0003_create_roles.ts',
  'src/migrations/0007_create_user_roles.ts',
  'src/models/Role.ts',
  'src/models/UserRole.ts',
]);
const MODULE_PATHS = {
  users: [
    'src/pages/dashboard/users/index.ts',
    'src/pages/dashboard/users/new/index.ts',
    'src/pages/dashboard/users/[id]/index.ts',
    'src/pages/dashboard/users/registrations/index.ts',
    'src/dashboard/user-sections.ts',
  ],
  sessions: ['src/pages/dashboard/sessions/index.ts'],
  settings: ['src/pages/dashboard/profile/index.ts', 'src/pages/dashboard/profile/security/index.ts'],
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
  'patches/appdmg@0.6.6.patch',
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
  if (rel === '.github/workflows/preview.yml') return recipe.adapter === 'cloudflare' ? 'base' : null;
  // The Update button under Tools → Updates asks this workflow to run cossack upgrade.
  if (rel === '.github/workflows/cossack-update.yml') return recipe.resolvedFeatures.includes('cms') ? 'cms' : null;
  if (rel === 'src/pages/resource/index.ts') return recipe.resolvedFeatures.includes('resource') ? 'resource' : null;
  if (rel === 'src/pages/mutation/index.ts') return recipe.resolvedFeatures.includes('mutation') ? 'mutation' : null;
  if (rel.startsWith('src/pages/scoped-service/') || rel === 'src/services/scoped-counter.ts') {
    return recipe.resolvedFeatures.includes('scoped-service') ? 'scoped-service' : null;
  }
  if (rel.startsWith('src/pages/protected-route/') || rel === 'src/middlewares/protected-route.ts') {
    return recipe.resolvedFeatures.includes('protected-route') ? 'protected-route' : null;
  }
  if (BASE_PATHS.has(rel) || rel.startsWith('public/') || rel === 'tsconfig.json') return 'base';
  if (UI_PATHS.has(rel)) return recipe.resolvedFeatures.includes('ui') ? 'ui' : null;
  if (ORM_PATHS.has(rel)) return recipe.resolvedFeatures.includes('database') ? 'database' : null;
  const ormAuth = recipe.resolvedFeatures.includes('auth');
  if (AUTH_ORM_PATHS.has(rel)) return ormAuth ? 'auth' : null;
  if (AUTH_PATHS.has(rel)) return recipe.resolvedFeatures.includes('auth') ? 'auth' : null;
  if (DASHBOARD_CORE_PATHS.has(rel)) return recipe.resolvedFeatures.includes('dashboard') ? 'dashboard' : null;
  // The application seeder belongs to the ORM; it seeds RBAC roles only for ORM auth.
  // The CMS makes its first account and roles on its setup page.
  if (rel === 'src/seeders/application.seeder.ts') return recipe.resolvedFeatures.includes('dashboard') && recipe.resolvedFeatures.includes('database') && !recipe.resolvedFeatures.includes('cms') ? 'dashboard' : null;
  // Roles are part of ORM sign-in: the served auth.ts reads them for every user.
  if (RBAC_ORM_PATHS.has(rel)) return ormAuth ? 'auth' : null;
  if (RBAC_PATHS.has(rel)) return recipe.resolvedFeatures.includes('auth') ? 'auth' : null;
  // Every module's pages are served; src/dashboard.config.ts says which ones answer.
  for (const paths of Object.values(MODULE_PATHS)) {
    if (paths.includes(rel)) return recipe.resolvedFeatures.includes('dashboard') ? 'dashboard' : null;
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
      "import { ormRequestMiddleware } from '../middlewares/orm';",
    );
    entries.push('  ormRequestMiddleware,');
  }
  // The CMS's middleware comes from its package, in one list: its host, the session, the
  // principal and the sign-in guard. The project's own goes after it.
  if (recipe.resolvedFeatures.includes('cms')) {
    imports.push(`import { cmsMiddlewares } from '${CMS_PACKAGE}/app/cms/middlewares';`);
    entries.push('  ...cmsMiddlewares,');
  } else if (recipe.resolvedFeatures.includes('auth')) {
    // The session and the sign-in guard, from the package that serves the sign-in pages.
    // The request's tenant first (src/dashboard.config.ts: `tenants`; it does nothing while they are off).
    imports.push(`import { tenantMiddleware } from '${DASHBOARD_PACKAGE}/app/middlewares/tenant';`);
    imports.push(`import { authMiddlewares } from '${DASHBOARD_PACKAGE}/app/middlewares/auth';`);
    entries.push('  tenantMiddleware,');
    entries.push('  ...authMiddlewares,');
  }
  return `${imports.join('\n')}\n\nconst middlewares: MiddlewareHandler[] = [\n${entries.join('\n')}\n];\n\nexport default middlewares;\n`;
}

function wranglerConfig(recipe, projectName) {
  const json = JSON.stringify;
  // Comments cannot hold line breaks; names are validated on creation, but
  // existing projects keep their directory name.
  const commentName = projectName.replace(/[\r\n\u2028\u2029]/g, ' ');
  let database = '';
  if (recipe.resolvedFeatures.includes('database') && recipe.config.database === 'd1') {
    database = `,\n  // Remote D1 deployments require database_id. Use the returned ID for an existing database,\n  // or create a remote database and update this config with:\n  // pnpm exec wrangler d1 create ${commentName}-db --update-config --binding DB\n  // This command creates a Cloudflare resource. Local development keeps its separate local DB.\n  "d1_databases": [{\n    "binding": "DB",\n    "database_name": ${json(`${projectName}-db`)},\n    "preview_database_id": ${json(`${projectName}-local`)}\n  }]`;
  } else if (recipe.resolvedFeatures.includes('database') &&
      recipe.config.database.startsWith('hyperdrive-')) {
    database = `,\n  // Replace this placeholder with a real Hyperdrive configuration ID before deploying.\n  "hyperdrive": [{\n    "binding": "HYPERDRIVE",\n    "id": "00000000000000000000000000000000"\n  }]`;
  }
  const email = recipe.resolvedFeatures.includes('notifications') || (recipe.resolvedFeatures.includes('auth') &&
      recipe.config.authMethods.includes('credentials'))
    ? `,\n  "send_email": [{ "name": "EMAIL" }]`
    : '';
  // Distributed SSE coordination for `@Page({ transport: 'sse' })` pages, and the live instances
  // of realtime pages, layouts and components (`transport: 'durable-object'`), which the framework
  // reaches through COSSACK_OBJECT. Both are SQLite-backed: new_sqlite_classes, not new_classes.
  const cms = recipe.resolvedFeatures.includes('cms');
  // The ORM on RomeDB keeps unconfirmed writes in the same Durable Object as the CMS does.
  const pending = cms || ormOnRomeDB(recipe);
  const sse = `,
  "durable_objects": {
    "bindings": [{ "name": "COSSACK_SSE", "class_name": "SseDurableObject" }, { "name": "COSSACK_OBJECT", "class_name": "AppDurableObject" }${pending ? ', { "name": "ROMEDB_PENDING", "class_name": "RomeDBPendingWrites" }' : ''}]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["SseDurableObject"] }, { "tag": "realtime-v1", "new_sqlite_classes": ["AppDurableObject"] }${cms ? ', { "tag": "cms-v1", "new_sqlite_classes": ["RomeDBPendingWrites"] }' : pending ? ', { "tag": "romedb-v1", "new_sqlite_classes": ["RomeDBPendingWrites"] }' : ''}]${cms ? `,
  // CMS media. Local development uses a local bucket; create the remote one with
  // pnpm exec wrangler r2 bucket create ${commentName}-media
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": ${json(`${projectName}-media`)} }],
  // Resized image variants, crops and AVIF/WebP. Remove it to serve images as uploaded.
  "images": { "binding": "IMAGES" }` : ''}`;
  const compatibilityFlag = recipe.config.database.startsWith('hyperdrive-')
    ? 'nodejs_compat'
    : 'nodejs_als';
  const jobDatabase = `{ "binding": "JOB_STATE", "database_name": ${json(`${projectName}-job-state`)}, "preview_database_id": ${json(`${projectName}-job-state-local`)}, "migrations_dir": "src/jobs/migrations" }`;
  const hasJobs = recipe.resolvedFeatures.includes('jobs');
  const jobs = hasJobs ? `,
  "queues": { "producers": [{ "binding": "JOBS", "queue": ${json(`${projectName}-jobs`)} }], "consumers": [{ "queue": ${json(`${projectName}-jobs`)}, "max_batch_size": 10, "max_retries": 5 }] }` : '';
  // A CMS project keeps the ledger in its RomeDB database (src/jobs/ledger.ts): no D1 for it.
  if (hasJobs && jobLedger(recipe) === 'd1') {
    if (recipe.resolvedFeatures.includes('database') && recipe.config.database === 'd1') database = database.replace(/]$/, `,${jobDatabase}]`);
    else database += `,\n  "d1_databases": [${jobDatabase}]`;
  }
  const workflows = recipe.resolvedFeatures.includes('workflows') ? `,\n  \"workflows\": [{ \"name\": ${json(`${projectName}-approval`)}, \"binding\": \"WORKFLOWS\", \"class_name\": \"ApprovalWorkflow\" }]` : '';
  // The CMS publishes scheduled entries and delivers webhooks every minute.
  const crons = [...(recipe.resolvedFeatures.includes('schedules') ? ['0 * * * *'] : []), ...(cms ? ['* * * * *'] : [])];
  const schedules = crons.length ? `,\n  "triggers": { "crons": ${JSON.stringify(crons)} }` : '';
  const notifications = recipe.resolvedFeatures.includes('notifications') ? ',\n    "MAIL_FROM": "no-reply@example.com"' : '';
  const turnstile = recipe.resolvedFeatures.includes('turnstile') ? ',\n    "TURNSTILE_SITE_KEY": "your-site-key",\n    "TURNSTILE_HOSTNAME": "localhost"' : '';
  return `{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": ${json(projectName)},
  "compatibility_flags": ["${compatibilityFlag}", "enable_request_signal"],
  "compatibility_date": "2026-06-06",
  "main": "./src/index.ts",
  "upload_source_maps": true,
  "assets": { "binding": "ASSETS", "run_worker_first": [${ASSETS_RUN_WORKER_FIRST.map(rule => json(rule)).join(', ')}] },
  "secrets": { "required": ${JSON.stringify(cloudflareEnvironmentValues(recipe, true).map(([name]) => name))} },
  "vars": {
    "APP_URL": "https://example.com",
    "APP_LOCALE": "en"${hasJobs ? `,\n    "JOB_NAMESPACE": ${json(`${projectName}-jobs-default`)}` : ''}${turnstile}${notifications}
  }${database}${email}${sse}${jobs}${schedules}${workflows}
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
  if (recipe.resolvedFeatures.includes('cms')) {
    dependencies['@cossackframework/cms'] = `^${templateVersion}`;
    dependencies['@cossackframework/romedb'] = `^${templateVersion}`;
    dependencies['@cossackframework/auth'] = `^${templateVersion}`;
    // Node stores media in S3 when S3_BUCKET is set, otherwise in a local directory.
    if (recipe.adapter === 'node') dependencies['@aws-sdk/client-s3'] = dependencyVersion('@aws-sdk/client-s3');
    // Node resizes images with sharp; Workers use the Images binding.
    if (recipe.adapter === 'node') dependencies.sharp = dependencyVersion('sharp');
    // Node opens RomeDB files in process with @romedb/node. Both stay outside the server bundle and
    // on one version: the embedded client and the URL client share @romedb/client's value classes.
    if (recipe.adapter === 'node') for (const name of ['@romedb/client', '@romedb/node']) dependencies[name] = dependencyVersion(name);
    // The editor, passkey and QR code libraries are the CMS package's own dependencies.
  }
  if (recipe.resolvedFeatures.includes('database')) {
    dependencies['@cossackframework/database'] = `^${templateVersion}`;
    dependencies['reflect-metadata'] = '^0.2.2';
    if (recipe.config.database === 'turso') {
      dependencies['@tursodatabase/serverless'] = dependencyVersion('@tursodatabase/serverless');
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
    } else if (recipe.config.database === 'romedb') {
      dependencies['@cossackframework/romedb'] = `^${templateVersion}`;
      // Node opens RomeDB files in process with @romedb/node, on one version with @romedb/client.
      if (recipe.adapter === 'node') for (const name of ['@romedb/client', '@romedb/node']) dependencies[name] = dependencyVersion(name);
    }
  }
  if (recipe.resolvedFeatures.includes('auth') || recipe.resolvedFeatures.includes('turnstile')) dependencies['@cossackframework/auth'] = `^${templateVersion}`;
  if (mountsDashboard(recipe)) dependencies[DASHBOARD_PACKAGE] = `^${templateVersion}`;
  if (recipe.adapter === 'node') {
    dependencies['@cossackframework/node-adapter'] = `^${templateVersion}`;
    dependencies['@hono/node-server'] = dependencyVersion('@hono/node-server');
    dependencies.ws = dependencyVersion('ws');
  }
  if (recipe.resolvedFeatures.includes('desktop')) {
    dependencies['@cossackframework/desktop'] = `^${templateVersion}`;
  }
  const devDependencies = {
    '@cossackframework/typescript-plugin': `^${templateVersion}`,
    '@types/node': dependencyVersion('@types/node'),
    '@tailwindcss/vite': dependencyVersion('@tailwindcss/vite'),
    prettier: dependencyVersion('prettier'),
    tailwindcss: dependencyVersion('tailwindcss'),
    tsx: dependencyVersion('tsx'),
    typescript: dependencyVersion('typescript'),
    vite: dependencyVersion('vite'),
    vitest: dependencyVersion('vitest'),
  };
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
    : {
        dev: 'vite dev',
        build: 'vite build',
        'build:ssg': 'vite build',
        'cf-typegen': 'wrangler types --env-interface CloudflareBindings',
        deploy: 'cossack deploy',
      };
  // The command writes the generated types first (Cloudflare's bindings, typed URLs, config()
  // keys) and then runs tsc. It owns the steps, so a release never has to change this script.
  scripts.typecheck = 'cossack typecheck';
  scripts['check:templates'] = 'cossack check templates';
  scripts.format = 'prettier --write "src/**/*.ts"';
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
    // The packages whose pages the application mounts (specs/package-routes.md).
    cossack: { runtime: recipe.adapter, ...(recipe.resolvedFeatures.includes('cms') ? { packages: [CMS_PACKAGE] } : mountsDashboard(recipe) ? { packages: [DASHBOARD_PACKAGE] } : {}), ...recipeRecord(recipe) },
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
    // appdmg's callback API needs a compatibility patch for image-size 2.
    // Key the patch by range: generated apps have no lockfile, and an exact
    // key fails with ERR_PNPM_UNUSED_PATCH once maker-dmg resolves 0.6.7.
    ? `\n\noverrides:\n  '@electron/rebuild': ${dependencyVersion('@electron/rebuild')}\n  'image-size@<2.0.3': 2.0.4\n\npatchedDependencies:\n  appdmg@^0.6.6: patches/appdmg@0.6.6.patch\n`
    : '\n';
  return `${recipe.resolvedFeatures.includes('desktop') ? 'nodeLinker: hoisted\n\n' : ''}allowBuilds:\n${builds.map((name) => `  ${name.startsWith('@') ? `'${name}'` : name}: true`).join('\n')}${overrides}`;
}

/**
 * The ORM on RomeDB. The server applies pending migrations when it starts: one process owns
 * a RomeDB file, so a command cannot open it beside the running server. A CMS project uses
 * the CMS's own instance, so both share one connection.
 */
function romedbOrmFactory(recipe) {
  const cms = recipe.resolvedFeatures.includes('cms');
  if (recipe.adapter === 'node') {
    // In a CMS project the server takes the CMS's instance: one process owns a database file.
    // The import is dynamic, so a command, which runs outside Vite, never loads the CMS's pages.
    const serverDatabase = cms
      ? `async function serverDatabase(env: ORMEnvironment): Promise<RomeDB> {
  const { cmsFor } = await import('${CMS_PACKAGE}/app/cms/index');
  return cmsFor(env as Parameters<typeof cmsFor>[0]).db;
}`
      : `async function serverDatabase(env: ORMEnvironment): Promise<RomeDB> {
  return getRomeDB(env);
}`;
    return `import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applyPendingMigrations, createORM, createTenantORMs, tenantUrl, type ORM, type TenantDatabase, type TenantORM } from '@cossackframework/database';
import { createRomeDB, type RomeDB } from '@cossackframework/romedb';
import { connectNode, FilePendingWriteStore, isServiceUrl } from '@cossackframework/romedb/node';
import { romedb } from '@cossackframework/romedb/orm';
import { migrations } from '../migrations';
import { models } from '../models';

export type ORMEnvironment = Record<string, string | undefined>;

let database: RomeDB | undefined;

/**
 * A RomeDB instance from the environment. ROMEDB_URL is a file path (the database opens in
 * this process and is created on first use) or the URL of \`romedb serve\` or RomeDB Cloud,
 * which needs ROMEDB_TOKEN. One process owns a file, so there is one instance.
 */
export function getRomeDB(env: ORMEnvironment = process.env): RomeDB {
  if (database) return database;
  const url = env.ROMEDB_URL || 'storage/romedb/app.romedb';
  const token = env.ROMEDB_TOKEN || undefined;
  if (isServiceUrl(url) && !token) throw new Error(\`ROMEDB_TOKEN is required for \${url}. Use a file path in ROMEDB_URL to keep the database in this process.\`);
  return database = createRomeDB({
    url,
    ...(token ? { token } : {}),
    connect: () => connectNode({ url, ...(token ? { token } : {}) }),
    // A write is saved here before it is sent, so an unconfirmed one survives a restart.
    pending: new FilePendingWriteStore(env.ROMEDB_PENDING_DIR ?? '.cossack/romedb-pending'),
  });
}

/** For commands (\`cossack migration\`, \`cossack seed\`). With a database file, stop the server first. */
export function createToolingAdapter() {
  // A command passes its own context here, not the environment.
  return romedb(getRomeDB());
}

${serverDatabase}

let singleton: Promise<ORM> | undefined;

/** The application's ORM. The first call applies the migrations that are not applied yet. */
export function getORM(env: ORMEnvironment = process.env): Promise<ORM> {
  singleton ??= serverDatabase(env).then(db => romedb(db)).then(async (adapter) => {
    const orm = createORM({ adapter, entities: models });
    await applyPendingMigrations(orm, migrations);
    return orm;
  });
  // A failed start is not kept: the next request tries again.
  singleton.catch(() => { singleton = undefined; });
  return singleton;
}

const tenants = createTenantORMs({
  // A file beside the main one, or TENANT_DATABASE_URL with {tenant} in it for a service.
  adapter: (tenant) => {
    const main = process.env.ROMEDB_URL || 'storage/romedb/app.romedb';
    const service = isServiceUrl(main);
    const url = service ? tenantUrl(process.env.TENANT_DATABASE_URL, tenant) : join(dirname(main), 'tenants', \`\${tenant.database}.romedb\`);
    const token = service ? process.env.TENANT_DATABASE_TOKEN ?? process.env.ROMEDB_TOKEN : undefined;
    if (!service) mkdirSync(dirname(url), { recursive: true });
    return romedb(createRomeDB({
      url,
      ...(token ? { token } : {}),
      connect: () => connectNode({ url, ...(token ? { token } : {}) }),
      pending: new FilePendingWriteStore(join(process.env.ROMEDB_PENDING_DIR ?? '.cossack/romedb-pending', 'tenants', tenant.database)),
    }));
  },
  entities: models,
  migrations,
});

/** The ORM of a tenant's database, for \`tenants\` in src/dashboard.config.ts. Its migrations apply when it is first opened. */
export function tenantORM(_env: unknown, tenant: TenantDatabase): Promise<TenantORM> {
  return tenants.open(tenant);
}
`;
  }
  const instance = cms
    ? `import { cmsFor, type CmsBindings } from '${CMS_PACKAGE}/app/cms/index';

export type ORMEnvironment = CmsBindings;

/** The CMS's RomeDB instance, so the ORM and the CMS share one connection. */
export function getRomeDB(env: ORMEnvironment): RomeDB {
  return cmsFor(env).db;
}`
    : `import { createRomeDB, type PendingWriteStore } from '@cossackframework/romedb';
import { DurableObjectPendingWriteStore, type DurableObjectNamespaceLike } from '@cossackframework/romedb/cloudflare';

export interface ORMEnvironment {
  /** A RomeDB Cloud database, or the loopback URL that \`pnpm dev\` serves with \`romedb serve\`. */
  ROMEDB_URL?: string;
  ROMEDB_TOKEN?: string;
  /** Durable Object namespace of RomeDBPendingWrites (exported from src/index.ts). */
  ROMEDB_PENDING?: DurableObjectNamespaceLike;
}

function required<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(\`\${name} is required\`);
  return value;
}

let database: { url: string; db: RomeDB } | undefined;

/** One instance for the isolate. Commands pass their own pending-write store. */
export function getRomeDB(env: ORMEnvironment, pending?: PendingWriteStore): RomeDB {
  const url = required(env.ROMEDB_URL, 'ROMEDB_URL');
  if (!pending && database?.url === url) return database.db;
  const db = createRomeDB({
    url,
    token: required(env.ROMEDB_TOKEN, 'ROMEDB_TOKEN'),
    // A write is saved in a Durable Object before it is sent, so an unconfirmed one survives the isolate.
    pending: pending ?? new DurableObjectPendingWriteStore(required(env.ROMEDB_PENDING, 'ROMEDB_PENDING')),
  });
  if (!pending) database = { url, db };
  return db;
}`;
  return `import { AsyncLocalStorage } from 'node:async_hooks';
import { applyPendingMigrations, createORM, createTenantORMs, tenantUrl, type TenantDatabase, type TenantORM } from '@cossackframework/database';
import type { Adapter } from '@cossackframework/database';
import { createAsyncLocalScope } from '@cossackframework/database/adapter';
import type { RomeDB } from '@cossackframework/romedb';
import { romedb } from '@cossackframework/romedb/orm';
${instance}
import { migrations } from '../migrations';
import { models } from '../models';

export async function createRuntimeAdapter(env: ORMEnvironment): Promise<Adapter> {
  return romedb(getRomeDB(env));
}

let migrated: Promise<unknown> | undefined;

export async function createRequestORM(env: ORMEnvironment) {
  const adapter = await createRuntimeAdapter(env);
  const orm = createORM({
    adapter: { ...adapter, scope: createAsyncLocalScope(new AsyncLocalStorage()) },
    entities: models,
  });
  // Once for the isolate: apply the migrations that are not applied yet.
  migrated ??= applyPendingMigrations(orm, migrations);
  migrated.catch(() => { migrated = undefined; });
  await migrated;
  return orm;
}
${cms ? `
/** A CMS project's tenants are the CMS's sites. */
export function tenantORM(_env: unknown, _tenant: TenantDatabase): Promise<TenantORM> {
  throw new Error('Tenants of the dashboard package are not used with the CMS: use its network of sites.');
}` : `
const tenants = createTenantORMs({
  // TENANT_DATABASE_URL has {tenant} in it: a RomeDB Cloud database per tenant.
  adapter: async (tenant) => {
    const env = tenantEnvironment.getStore()!;
    const adapter = await romedb(createRomeDB({
      url: tenantUrl(env.TENANT_DATABASE_URL, tenant),
      token: required(env.TENANT_DATABASE_TOKEN ?? env.ROMEDB_TOKEN, 'ROMEDB_TOKEN'),
      pending: new DurableObjectPendingWriteStore(required(env.ROMEDB_PENDING, 'ROMEDB_PENDING'), { name: \`tenant:\${tenant.database}\` }),
    }));
    return { ...adapter, scope: createAsyncLocalScope(new AsyncLocalStorage()) };
  },
  entities: models,
  migrations,
  perRequest: true,
});
const tenantEnvironment = new AsyncLocalStorage<ORMEnvironment & { TENANT_DATABASE_URL?: string; TENANT_DATABASE_TOKEN?: string }>();

/** The ORM of a tenant's database for this request, for tenants in src/dashboard.config.ts. Release it after the request. */
export function tenantORM(env: unknown, tenant: TenantDatabase): Promise<TenantORM> {
  return tenantEnvironment.run(env as ORMEnvironment, () => tenants.open(tenant));
}`}
`;
}

function ormFactory(recipe) {
  const provider = recipe.config.database;
  if (provider === 'romedb') return romedbOrmFactory(recipe);
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
    // A tenant's database: a file beside the main one, or TENANT_DATABASE_URL with {tenant} in it.
    const tenantAdapter = provider === 'sqlite'
      ? `(tenant) => {
    const directory = join(dirname(process.env.DB_PATH ?? './database.sqlite'), 'tenants');
    mkdirSync(directory, { recursive: true });
    return nodeSQLite({ filename: join(directory, \`\${tenant.database}.sqlite\`) });
  }`
      : provider === 'turso'
        ? `(tenant) => turso({
    url: tenantUrl(process.env.TENANT_DATABASE_URL, tenant),
    authToken: process.env.TENANT_DATABASE_TOKEN ?? process.env.TURSO_AUTH_TOKEN,
  })`
        : `(tenant) => ${provider}(tenantUrl(process.env.TENANT_DATABASE_URL, tenant))`;
    const tenantImports = provider === 'sqlite'
      ? "import { mkdirSync } from 'node:fs';\nimport { dirname, join } from 'node:path';\nimport { createORM, createTenantORMs, type ORM, type TenantDatabase, type TenantORM } from '@cossackframework/database';"
      : "import { createORM, createTenantORMs, tenantUrl, type ORM, type TenantDatabase, type TenantORM } from '@cossackframework/database';";
    return `${tenantImports}
import { ${adapterImport} } from '@cossackframework/database/node';
import { migrations } from '../migrations';
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

const tenants = createTenantORMs({
  adapter: ${tenantAdapter},
  entities: models,
  migrations,
});

/** The ORM of a tenant's database, for \`tenants\` in src/dashboard.config.ts. Its migrations apply when it is first opened. */
export function tenantORM(_env: unknown, tenant: TenantDatabase): Promise<TenantORM> {
  return tenants.open(tenant);
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
  // A tenant's database: a binding per tenant (D1, Hyperdrive), or TENANT_DATABASE_URL with {tenant} in it (Turso).
  const tenantAdapterExpression = provider === 'd1'
    ? `d1(binding<D1Database>(env, 'DB', tenant))`
    : provider === 'turso'
      ? `turso({
      url: tenantUrl((env as { TENANT_DATABASE_URL?: string }).TENANT_DATABASE_URL, tenant),
      authToken: (env as { TENANT_DATABASE_TOKEN?: string }).TENANT_DATABASE_TOKEN ?? env.TURSO_AUTH_TOKEN,
    })`
      : provider === 'hyperdrive-postgres'
        ? `hyperdrivePostgres(binding<Hyperdrive>(env, 'HYPERDRIVE', tenant))`
        : `hyperdriveMySQL(binding<Hyperdrive>(env, 'HYPERDRIVE', tenant))`;
  const runtimeModule = provider === 'turso'
    ? '@cossackframework/database/cloudflare-turso'
    : '@cossackframework/database/cloudflare';
  const envShape = provider === 'd1'
    ? 'DB: D1Database;'
    : provider === 'turso'
      ? 'TURSO_DATABASE_URL?: string;\n  TURSO_AUTH_TOKEN?: string;'
      : 'HYPERDRIVE: Hyperdrive;';
  return `import { AsyncLocalStorage } from 'node:async_hooks';
import { createORM, createTenantORMs, tenantUrl, type TenantDatabase, type TenantORM } from '@cossackframework/database';
import type { Adapter } from '@cossackframework/database';
import { createAsyncLocalScope } from '@cossackframework/database/adapter';
import { ${runtimeImport} } from '${runtimeModule}';
import { migrations } from '../migrations';
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
  const adapter = await createRuntimeAdapter(env);
  return createORM({
    adapter: { ...adapter, scope: createAsyncLocalScope(new AsyncLocalStorage()) },
    entities: models,
  });
}

/** A tenant's own binding, such as DB_ACME for the tenant \`acme\`. */
function binding<T>(env: ORMEnvironment, prefix: string, tenant: TenantDatabase): T {
  const name = \`\${prefix}_\${tenant.slug.toUpperCase().replaceAll('-', '_')}\`;
  const value = (env as unknown as Record<string, unknown>)[name];
  if (!value) throw new Error(\`The tenant \${tenant.slug} needs the binding \${name}.\`);
  return value as T;
}

const tenantEnvironment = new AsyncLocalStorage<ORMEnvironment>();
const tenants = createTenantORMs({
  adapter: async (tenant) => {
    const env = tenantEnvironment.getStore()!;
    void tenantUrl; void binding;
    const adapter = await ${tenantAdapterExpression};
    return { ...adapter, scope: createAsyncLocalScope(new AsyncLocalStorage()) };
  },
  entities: models,
  migrations,
  perRequest: true,
});

/** The ORM of a tenant's database for this request, for \`tenants\` in src/dashboard.config.ts. Release it after the request. */
export function tenantORM(env: unknown, tenant: TenantDatabase): Promise<TenantORM> {
  return tenantEnvironment.run(env as ORMEnvironment, () => tenants.open(tenant));
}
`;
}

function ormTooling(recipe) {
  if (recipe.config.database === 'romedb') {
    // Commands run outside the Worker, where no Durable Object holds unconfirmed writes.
    return `import type { Adapter, ORMToolingContext } from '@cossackframework/database';
import { createCloudflareToolingPlatform } from '@cossackframework/database/tooling';
import { createRomeDB, MemoryPendingWriteStore } from '@cossackframework/romedb';
import { romedb } from '@cossackframework/romedb/orm';

interface ToolingEnvironment { ROMEDB_URL?: string; ROMEDB_TOKEN?: string }

export async function createToolingAdapter(context: ORMToolingContext): Promise<Adapter> {
  const platform = await createCloudflareToolingPlatform<ToolingEnvironment>(context);
  try {
    // \`pnpm dev\` passes the local service's token in the environment; .dev.vars holds the URL.
    const url = platform.env.ROMEDB_URL ?? process.env.ROMEDB_URL;
    const token = platform.env.ROMEDB_TOKEN ?? process.env.ROMEDB_TOKEN;
    if (!url || !token) throw new Error('ROMEDB_URL and ROMEDB_TOKEN are required. The server applies migrations when it starts, so a command is rarely needed.');
    return await romedb(createRomeDB({ url, token, pending: new MemoryPendingWriteStore() }));
  } finally {
    await platform.dispose();
  }
}
`;
  }
  if (recipe.config.database === 'd1') {
    return `import type { Adapter, ORMToolingContext } from '@cossackframework/database';
import { createD1ToolingAdapter } from '@cossackframework/database/tooling';

export async function createToolingAdapter(context: ORMToolingContext): Promise<Adapter> {
  return createD1ToolingAdapter(context, { binding: 'DB' });
}
`;
  }
  return `import type { Adapter, ORMToolingContext } from '@cossackframework/database';
import { createCloudflareToolingPlatform } from '@cossackframework/database/tooling';
import {
  createRuntimeAdapter,
  type ORMEnvironment,
} from './factory';

export async function createToolingAdapter(context: ORMToolingContext): Promise<Adapter> {
  const platform = await createCloudflareToolingPlatform<ORMEnvironment>(context);
  try {
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
  } catch (error) {
    await platform.dispose();
    throw error;
  }
}
`;
}

function ormConfiguration(recipe) {
  const toolingImport = recipe.adapter === 'node'
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
    ? recipe.config.database === 'romedb'
      // The database opens with the first request, not when this module loads: a build that
      // imports the module must not take the file from a running server.
      ? (recipe.resolvedFeatures.includes('cms')
        // The CMS's database is opened with the request's bindings, the ones its own middleware uses.
        ? `export const ormRequestMiddleware = async (context: Context, next: () => Promise<void>) =>
  ormMiddleware(await getORM(context.env as ORMEnvironment))(context, next);`
        : `export const ormRequestMiddleware = async (context: Context, next: () => Promise<void>) =>
  ormMiddleware(await getORM())(context, next);`)
      : `const orm = await getORM();
export const ormRequestMiddleware = ormMiddleware(orm);`
    : `export const ormRequestMiddleware = ormMiddleware((context: Context) =>
  createRequestORM(context.env as ORMEnvironment));`;
  const factoryImport = recipe.adapter === 'node'
    ? recipe.config.database === 'romedb' && recipe.resolvedFeatures.includes('cms')
      ? "import { getORM, type ORMEnvironment } from '../orm/factory';"
      : "import { getORM } from '../orm/factory';"
    : "import { createRequestORM, type ORMEnvironment } from '../orm/factory';";
  return `import {
  createDatabaseCacheStore,
  createDatabaseSessionStore,
  ormMiddleware,
} from '@cossackframework/database/cossack';
import { extendCacheDriver } from '@cossackframework/framework/cache';
import { createSessionMiddleware } from '@cossackframework/framework/session';
${factoryImport}
${recipe.adapter === 'node' && recipe.config.database !== 'romedb' ? '' : "import type { Context } from 'hono';\n"}

${runtime}

export const sessionMiddleware = createSessionMiddleware({
  store: createDatabaseSessionStore(),
});

extendCacheDriver('database', () => createDatabaseCacheStore());
`;
}

/** The entities of sign-in on the ORM. Roles are part of it: the served auth.ts reads them for every user. */
const ACCOUNT_MODELS = ['User', 'Session', 'OAuthAccount', 'UserSecurity', 'Passkey', 'AuthChallenge', 'AuthAttempt', 'ApiToken', 'Tenant', 'TenantDomain', 'TenantMember', 'TenantHandoff', 'TenantNetwork', 'TenantSession', 'Role', 'UserRole'];
/** Their migrations, in the order they apply. */
const ACCOUNT_MIGRATIONS = [
  '0001_create_users.ts', '0002_create_sessions.ts', '0003_create_roles.ts', '0005_create_oauth_accounts.ts', '0007_create_user_roles.ts',
  '0008_add_session_public_id.ts', '0009_create_account_security.ts', '0010_add_user_status.ts', '0011_create_api_tokens.ts', '0012_create_tenants.ts', '0013_add_network_admin.ts', '0014_tenant_lifecycle.ts', '0015_tenant_sessions.ts',
];

function modelsBarrel(recipe, names = accountBarrelNames(recipe)) {
  const imports = names.map((name) => `import { ${name} } from './${name}';`);
  const exports = names.map((name) => `export { ${name} } from './${name}';`);
  return `import 'reflect-metadata';
${imports.join('\n')}

${exports.join('\n')}

export const models = [${names.join(', ')}] as const;
`;
}

function accountBarrelNames(recipe) {
  const ormAuth = recipe.resolvedFeatures.includes('auth');
  return [...(ormAuth ? ACCOUNT_MODELS : []), 'CacheItem'];
}

function registeredBarrel(kind, files) {
  const imports = files.map((file, index) =>
    `import item${index} from './${file.replace(/\.ts$/, '')}';`);
  return `${imports.join('\n')}

export const ${kind} = [${files.map((_, index) => `item${index}`).join(', ')}] as const;
`;
}

function nodeEntry({ sqlite = false } = {}) {
  return `import { createApp } from '@cossackframework/framework/router';
import { createNodeAdapter, nodeApplication } from '@cossackframework/node-adapter';
import { App } from './App';
import { template } from './root';

export const runtime = createNodeAdapter();
const frameworkApp = createApp({ AppComponent: App, htmlTemplate: template, runtimeAdapter: runtime });

// The Node server: static files, the bindings (production and the Node Vite plugin share
// createEnv) and a clean shutdown. It starts when Node runs this module.
export const { app, createEnv, env } = await nodeApplication({
  runtime,
  fetch: frameworkApp.fetch,
  entry: import.meta.url,
  dev: import.meta.env?.DEV,${sqlite ? "\n  bindings: variables => ({ DB_PATH: variables.DB_PATH ?? './database.sqlite' })," : ''}
});
`;
}

function desktopIdentifier(projectName) {
  const slug = path.basename(projectName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `dev.cossack.${slug || 'app'}`;
}

function desktopEntry(projectName) {
  return `import { app as electronApp, configureDesktopClose, createDesktopApp, electronRuntimeAdapter } from '@cossackframework/desktop';
import { createApp } from '@cossackframework/framework/router';
import { fileURLToPath } from 'node:url';
import { App } from '../App';
import { template } from '../root';

// Decide here which variables become application bindings. desktop:dev calls
// createEnv with the .env files and process variables; production uses env.
export function createEnv(variables: Record<string, string | undefined> = process.env): Record<string, unknown> {
  return { ...variables };
}
export const env: Record<string, unknown> = import.meta.env.DEV ? {} : createEnv();
export const frameworkApp = createApp({
  AppComponent: App,
  htmlTemplate: template,
  runtimeAdapter: electronRuntimeAdapter,
});

export async function startDesktop(createApplication = createDesktopApp) {
  const desktop = await createApplication({
    identifier: ${JSON.stringify(desktopIdentifier(projectName))},
    productName: ${JSON.stringify(projectName)},
    assetsRoot: fileURLToPath(new URL('../client/', import.meta.url)),
    env,
    fetch: (request, requestEnv) => frameworkApp.fetch(request, requestEnv),
    window: {
      title: ${JSON.stringify(projectName)},
      icon: fileURLToPath(new URL('../../desktop-assets/icon-256.png', import.meta.url)),
    },
  });
  configureDesktopClose({
    window: desktop.mainWindow,
    behavior: 'quit',
    onQuit: () => desktop.quit(),
  });
  return desktop;
}

if (!import.meta.env.DEV) void startDesktop().catch((error) => {
  console.error('Cossack Desktop failed to start.', error);
  electronApp.exit(1);
});
`;
}

function forgeConfiguration(projectName) {
  const identifier = desktopIdentifier(projectName);
  const executableName = identifier.slice('dev.cossack.'.length);
  const name = JSON.stringify(projectName);
  const description = JSON.stringify(`${projectName} desktop application`);
  const bin = JSON.stringify(executableName);
  const bundleId = JSON.stringify(identifier);
  return `import path from 'node:path';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerWix } from '@electron-forge/maker-wix';
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    prune: false,
    // Package only runtime artifacts; never copy project secrets or web-server output.
    ignore: (file) => file !== '' && !/^\\/(?:package\\.json$|dist$|dist\\/(?:client|desktop)(?:\\/|$)|desktop-assets(?:\\/|$))/.test(file),
    name: ${name},
    executableName: ${bin},
    appBundleId: ${bundleId},
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
        name: ${bin},
        productName: ${name},
        genericName: ${name},
        description: ${description},
        bin: ${bin},
        maintainer: 'Cossack Framework <maintainers@cossack.dev>',
        homepage: 'https://cossack.dev',
        desktopTemplate: path.resolve('desktop-assets/linux.desktop.ejs'),
        icon: 'desktop-assets/icon-512.png',
        categories: ['Utility'],
        section: 'utils',
      },
    }),
    new MakerWix({
      name: ${name},
      manufacturer: 'Cossack Framework',
      appUserModelId: ${bundleId},
      icon: 'desktop-assets/icon.ico',
      exe: ${JSON.stringify(`${executableName}.exe`)},
    }),
    new MakerDMG({
      name: ${name},
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

function generateAuthSecret() {
  return randomBytes(32).toString('base64url');
}

function ensureEnvironmentSecrets(recipe, existingSecrets) {
  const needsOAuthSecret = recipe.resolvedFeatures.includes('auth') &&
    recipe.config.authMethods.includes('oauth');
  return {
    ...recipe,
    config: {
      ...recipe.config,
      appSecret: existingSecrets?.appSecret ??
        recipe.config.appSecret ??
        generateAuthSecret(),
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

// A project records no hash and no stored text of its scaffold files: the packages it mounts
// serve what a release changes, its own files are its own, and `cossack upgrade` changes its
// dependencies. Its recipe is in `package.json#cossack` (`features`, `template`, `options`).
// `.cossack/scaffold.json` exists only for the copies `cossack eject` made.
const RECIPE_OPTIONS = ['database', 'authMethods', 'oauth', 'theme'];
/** The recipe as `package.json#cossack` records it: the features, and the options that are not the defaults. */
export function recipeRecord(recipe) {
  const defaults = resolveRecipe({ adapter: recipe.adapter, preset: 'minimal', features: recipe.explicitFeatures });
  const options = {};
  for (const key of RECIPE_OPTIONS) {
    if (JSON.stringify(recipe.config[key]) !== JSON.stringify(defaults.config[key])) options[key] = recipe.config[key];
  }
  if (JSON.stringify(recipe.dashboardModules) !== JSON.stringify(defaults.dashboardModules)) options.dashboardModules = recipe.dashboardModules;
  return { features: recipe.explicitFeatures, template: templateVersion, ...(Object.keys(options).length ? { options } : {}) };
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
  const port = '3000';
  const values = [
    // Quote names that dotenv would otherwise truncate or reinterpret.
    ['APP_NAME', /^[\w./:@+-]*$/.test(projectName) ? projectName : JSON.stringify(projectName)],
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
    } else if (recipe.config.database === 'romedb') {
      // A file in this process by default; a URL (romedb serve, RomeDB Cloud) needs ROMEDB_TOKEN.
      // A CMS project already names them below.
      if (!recipe.resolvedFeatures.includes('cms')) values.push(['ROMEDB_URL', 'storage/romedb/app.romedb'], ['ROMEDB_TOKEN', ''], ['ROMEDB_PENDING_DIR', '.cossack/romedb-pending']);
    } else {
      values.push(['DATABASE_URL', example
        ? `${recipe.config.database}://user:password@localhost:5432/database`
        : '']);
    }
  }
  if (recipe.resolvedFeatures.includes('auth')) {
    values.push(['AUTH_REDIRECT_AFTER_LOGIN',
      recipe.resolvedFeatures.includes('dashboard') ? '/dashboard'
        : recipe.resolvedFeatures.includes('protected-route') ? '/protected-route' : '/']);
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
  if (recipe.resolvedFeatures.includes('turnstile')) values.push(['TURNSTILE_SITE_KEY', 'your-site-key'], ['TURNSTILE_SECRET_KEY', 'your-secret-key'], ['TURNSTILE_HOSTNAME', 'localhost']);
  if (recipe.resolvedFeatures.includes('cms')) {
    values.push(...cmsEnvironmentValues(example, 'node'), ['ROMEDB_PENDING_DIR', '.cossack/romedb-pending'], ['MEDIA_DIR', 'storage/media']);
    // Set S3_BUCKET to keep media in S3 or an S3-compatible service instead of MEDIA_DIR.
    for (const name of ['S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) values.push([name, '']);
  }
  return values;
}

function cloudflareEnvironmentValues(recipe, example = false) {
  const values = [['APP_SECRET', example
    ? 'replace-with-a-random-32-byte-secret'
    : (recipe.config.appSecret ?? generateAuthSecret())]];
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
  if (recipe.resolvedFeatures.includes('turnstile')) values.push(['TURNSTILE_SECRET_KEY', 'your-secret-key']);
  if (recipe.resolvedFeatures.includes('cms')) values.push(...cmsEnvironmentValues(example, 'cloudflare'));
  // Workers reach RomeDB over HTTP. Locally, \`pnpm dev\` starts \`romedb serve\` for the loopback
  // URL and passes its token, so .dev.vars holds none.
  else if (ormOnRomeDB(recipe)) values.push(...(example
    ? [['ROMEDB_URL', 'https://cloud.romedb.com/v1/organizations/<organization>/databases/<database>'], ['ROMEDB_TOKEN', 'your-romedb-database-grant']]
    : [['ROMEDB_URL', 'http://127.0.0.1:4321']]));
  return values;
}

/**
 * RomeDB connection and the first-run setup code. Node keeps the database in a file by default
 * (a URL needs ROMEDB_TOKEN). Workers reach RomeDB over HTTP: locally, \`pnpm dev\` starts
 * \`romedb serve\` for the loopback URL and passes its token, so .dev.vars holds none.
 */
function cmsEnvironmentValues(example, adapter) {
  const setup = ['CMS_SETUP_CODE', example ? 'choose-a-one-time-setup-code' : cmsSetupCode()];
  if (adapter === 'node') return [['ROMEDB_URL', 'storage/romedb/app.romedb'], ['ROMEDB_TOKEN', ''], setup];
  if (!example) return [['ROMEDB_URL', 'http://127.0.0.1:4321'], setup];
  return [
    ['ROMEDB_URL', 'https://cloud.romedb.com/v1/organizations/<organization>/databases/<database>'],
    ['ROMEDB_TOKEN', 'your-romedb-database-grant'],
    setup,
  ];
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

/** The application stylesheet: the chosen theme after the base theme, and the CMS block styles when the cms feature is on. */
function applyStyles(content, recipe) {
  const marker = '@import "@cossackframework/ui/theme/theme.css";';
  const imports = [marker];
  if (recipe.config.theme !== 'default') imports.push(`@import "@cossackframework/ui/theme/themes/${recipe.config.theme}.css";`);
  // The CMS dashboard switches palettes at runtime (Settings → Interface).
  if (recipe.resolvedFeatures.includes('cms')) imports.push('@import "@cossackframework/ui/theme/palettes.css";', `@import "${CMS_PACKAGE}/app/cms/blocks.css";`);
  const styled = content.replace(marker, imports.join('\n'));
  // Tailwind does not scan node_modules: name the served CMS files, as for the UI package.
  const source = '@source "../node_modules/@cossackframework/ui/dist";';
  const served = recipe.resolvedFeatures.includes('cms') ? CMS_PACKAGE : mountsDashboard(recipe) ? DASHBOARD_PACKAGE : null;
  return served ? styled.replace(source, `${source}\n@source "../node_modules/${served}/app/src";`) : styled;
}

export async function renderRecipe(recipe, options = {}) {
  const diagnostics = recipeCapabilityDiagnostics(recipe);
  if (diagnostics.length) {
    const diagnostic = diagnostics[0];
    throw Object.assign(new Error(`${diagnostic.source.file}: ${diagnostic.message}`), {
      code: diagnostic.code, diagnostics,
    });
  }
  const files = new Map();
  for (const rel of await walk(templateDir)) {
    if (rel === 'package.json') continue;
    const capability = capabilityFor(rel, recipe);
    if (!capability) continue;
    let content = await fs.readFile(path.join(templateDir, rel));
    if (rel === 'src/style.css') content = text(applyStyles(content.toString('utf8'), recipe));
    if (rel === 'src/config/database.ts') {
      content = text(content.toString('utf8').replace(
        "default: env('DB_CONNECTION', 'd1')",
        `default: env('DB_CONNECTION', '${recipe.config.database}')`,
      ));
    }
    if ((recipe.adapter === 'node') &&
        ['wrangler.jsonc', 'worker-configuration.d.ts'].includes(rel)) continue;
    if (recipe.adapter !== 'node' && rel === 'scripts/dev.js') continue;
    if (recipe.adapter === 'node' && rel === 'src/index.ts') {
      content = text(nodeEntry({ sqlite: recipe.resolvedFeatures.includes('database') && recipe.config.database === 'sqlite' }));
      if (recipe.resolvedFeatures.includes('cms')) content = text(patchCmsNodeEntry(content.toString('utf8')));
    }
    files.set(rel, { content, capability });
  }

  // The sign-in pages, the dashboard and their modules are the dashboard package's sources. A
  // project mounts them. Only the packages' own applications hold them (`servedFiles`): the
  // dashboard's development app, and the CMS, which ships a copy of the shell.
  if (options.servedFiles === true && recipe.resolvedFeatures.includes('auth')) {
    const source = dashboardSourceDir();
    for (const rel of await walk(path.join(source, 'src'), 'src')) {
      if (!isServedDashboardPath(rel)) continue;
      const capability = capabilityFor(rel, recipe);
      if (capability) files.set(rel, { content: await fs.readFile(path.join(source, rel)), capability });
    }
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
        types: ['vite/client', 'node'],
      },
      include: [
        'src/**/*.ts',
        '.cossack/config.d.ts',
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
    content: text('node_modules/\ndist/\nout/\n.wrangler/\n.env*\n.dev.vars*\n!.env.example\n!.dev.vars.example\n.cossack/routes.ts\n.cossack/config.d.ts\n.cossack/preview.json\n.cossack/preview-secrets.json\n.cossack/**/*.lock\n.cossack/romedb-pending/\n' +
      (recipe.resolvedFeatures.includes('cms') ? 'storage/media/\nstorage/romedb/\n' : ormOnRomeDB(recipe) ? 'storage/romedb/\n' : '')),
    capability: 'base',
  });

  // Stored merge bases are committed, and they are not source to review.
  files.set('.gitattributes', { content: text('.cossack/base/** -diff linguist-generated\n'), capability: 'base' });

  if (!recipe.resolvedFeatures.includes('ui')) {
    files.set('src/App.ts', { content: text(minimalApp()), capability: 'base' });
    files.set('src/root.ts', { content: text(minimalRoot()), capability: 'base' });
    files.set('src/style.css', { content: text('/* Application styles */\n'), capability: 'base' });
  }
  // The CMS site serves the home page from src/pages/(site)/index.ts.
  if (!recipe.resolvedFeatures.includes('examples') && !recipe.resolvedFeatures.includes('cms')) {
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
        content: text(ormTooling(recipe)),
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
    const ormAuth = recipe.resolvedFeatures.includes('auth');
    const migrationFiles = [...(ormAuth ? ACCOUNT_MIGRATIONS : []), '0006_create_cache_table.ts'];
    files.set('src/migrations/index.ts', {
      content: text(registeredBarrel('migrations', migrationFiles)),
      capability: 'database',
    });
    const seedFiles = ['application.seeder.ts'];
    files.set('src/seeders/index.ts', {
      content: text(registeredBarrel('seeds', seedFiles)),
      capability: 'database',
    });
    if (!ormAuth || !recipe.resolvedFeatures.includes('dashboard') || recipe.resolvedFeatures.includes('cms')) {
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
  if (recipe.adapter === 'cloudflare') {
    files.set('wrangler.jsonc', {
      content: text(wranglerConfig(recipe, options.projectName ?? 'my-cossack-app')),
      capability: 'base',
    });
  }
  for (const [feature, generated] of [['turnstile', turnstileRecipeFiles], ['jobs', jobsRecipeFiles], ['schedules', schedulesRecipeFiles], ['notifications', notificationsRecipeFiles], ['workflows', workflowsRecipeFiles]]) {
    if (!recipe.resolvedFeatures.includes(feature)) continue;
    for (const [file, source] of Object.entries(generated({ notifications: recipe.resolvedFeatures.includes('notifications'), ledger: jobLedger(recipe) }))) files.set(file, { content: text(source), capability: feature });
  }
  if (recipe.resolvedFeatures.includes('workflows')) {
    const entry = files.get('src/index.ts');
    files.set('src/index.ts', { ...entry, content: text(entry.content.toString('utf8') + "\nexport { ApprovalWorkflow } from './workflows/entry';\n") });
  }
  if (recipe.resolvedFeatures.includes('jobs')) {
    const entry = files.get('src/index.ts');
    const source = entry.content.toString('utf8').replace("import { template } from './root';", "import { template } from './root';\nimport { createJobs } from './jobs';")
      .replace('fetch: app.fetch,', "fetch: app.fetch,\n  async queue(batch: MessageBatch, env: CloudflareBindings) { await createJobs(env).queue(batch); },");
    files.set('src/index.ts', { ...entry, content: text(source) });
  }
  if (recipe.resolvedFeatures.includes('schedules')) {
    const entry = files.get('src/index.ts');
    const source = entry.content.toString('utf8').replace("import { createJobs } from './jobs';", "import { createJobs } from './jobs';\nimport { createSchedules } from './schedules/index';")
      .replace('fetch: app.fetch,', "fetch: app.fetch,\n  async scheduled(controller: ScheduledController, env: CloudflareBindings) { await createSchedules(env).scheduled(controller); },");
    files.set('src/index.ts', { ...entry, content: text(source) });
  }
  if (ormOnRomeDB(recipe) && recipe.adapter === 'cloudflare' && !recipe.resolvedFeatures.includes('cms')) {
    const entry = files.get('src/index.ts');
    files.set('src/index.ts', { ...entry, content: text(entry.content.toString('utf8').replace('export { SseDurableObject };', `export { SseDurableObject };
// The Durable Object that keeps unconfirmed RomeDB writes, which wrangler.jsonc names (ROMEDB_PENDING).
export { RomeDBPendingWrites } from '@cossackframework/romedb/cloudflare';`)) });
  }
  if (recipe.resolvedFeatures.includes('cms')) {
    for (const [file, source] of Object.entries(cmsRecipeFiles({ adapter: recipe.adapter, oauth: recipe.config.authMethods.includes('oauth') ? recipe.config.oauth : [] }))) files.set(file, { content: text(source), capability: 'cms' });
    if (recipe.adapter === 'cloudflare') {
      const entry = files.get('src/index.ts');
      files.set('src/index.ts', { ...entry, content: text(patchCmsWorkerEntry(entry.content.toString('utf8'), { schedules: recipe.resolvedFeatures.includes('schedules') })) });
    }
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
  if (recipe.adapter === 'node') {
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
      // Wrangler drops every other name from .dev.vars when secrets.required is set.
      content: text('# Wrangler loads only the names in wrangler.jsonc "secrets.required" from .dev.vars.\n' +
        '# Development-only values go in vite.config.ts: see docs/environment.md.\n' + environmentExample(exampleValues)),
      // APP_SECRET is required by every Cloudflare recipe, not only databases.
      capability: 'base',
    });
    }
  }
  // A CMS project mounts the CMS application from its package, the sign-in pages and the
  // dashboard included, and holds none of those files: a file at a served path would override
  // the package's. `servedFiles` keeps them, for the package's own application
  // (packages/cms/app), which is where the package serves them from.
  if (recipe.resolvedFeatures.includes('cms') && options.servedFiles !== true) {
    for (const rel of [...files.keys()]) if (isServedCmsPath(rel)) files.delete(rel);
  }
  // Sign-in on the database ORM: the pages, the dashboard and their modules are served from
  // @cossackframework/dashboard. The project holds its choices, and its models and migrations.
  if (mountsDashboard(recipe)) {
    files.set('src/dashboard.config.ts', { content: text(dashboardConfigFile(recipe)), capability: 'auth' });
    if (options.servedFiles !== true) for (const rel of [...files.keys()]) if (isServedDashboardPath(rel)) files.delete(rel);
  }
  const readme = files.get('README.md');
  if (readme) files.set('README.md', { ...readme, content: text(readmeFor(readme.content.toString('utf8'), recipe)) });
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

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The project's recorded recipe, from `package.json#cossack`, as a manifest. The result has
 * `recordsFiles: false`: no file is recorded. `.cossack/scaffold.json`, when the project has
 * one, holds only the copies `cossack eject` made, which the result carries as `ejected`.
 */
export async function readManifest(projectDir) {
  const stored = await readJson(path.join(projectDir, '.cossack/scaffold.json'));
  const record = (await readJson(path.join(projectDir, 'package.json')))?.cossack;
  if (Array.isArray(record?.features) && ADAPTERS.includes(record.runtime)) {
    let recipe;
    try {
      recipe = resolveRecipe({ adapter: record.runtime, preset: 'minimal', features: record.features, ...record.options });
    } catch {
      return stored;
    }
    return {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      tool: '@cossackframework/scaffold',
      recordsFiles: false,
      templateVersion: record.template,
      runtime: recipe.adapter,
      preset: 'minimal',
      explicitFeatures: recipe.explicitFeatures,
      resolvedFeatures: recipe.resolvedFeatures,
      dashboardModules: recipe.dashboardModules,
      config: publicRecipe(recipe).config,
      ...(stored?.ejected && Object.keys(stored.ejected).length ? { ejected: stored.ejected } : {}),
    };
  }
  // A recipe still in the manifest, from before it moved to package.json: its file records are
  // not used, and the next change (add, remove, upgrade) moves the recipe and removes them.
  if (stored && supportedManifest(stored) && Array.isArray(stored.explicitFeatures ?? stored.resolvedFeatures)) {
    const { files: _files, dependencyBaseline: _baseline, ...recipe } = stored;
    return { ...recipe, recordsFiles: false };
  }
  return stored;
}

/**
 * The files as the project's recipe renders them now stand in for a record of them: a file
 * equal to the rendering is replaced, another one is merged over it.
 */
function withRenderedFiles(manifest, rendered) {
  if (!manifest) return manifest;
  const files = {};
  const bases = new Map();
  for (const [rel, entry] of rendered) {
    if (entry.capability === LOCAL_ENV_CAPABILITY) continue;
    const name = hash(entry.content);
    files[rel] = { capability: entry.capability, hash: name, ...(KEY_MERGED.has(rel) ? {} : { base: name }) };
    bases.set(name, entry.content);
  }
  return { ...manifest, files, bases };
}

/**
 * Leave a project without file records: the manifest keeps only the copies `cossack eject`
 * made, and goes when there are none. The recipe is in package.json, which the rendering wrote.
 */
export async function dropFileRecords(projectDir, previousManifest = undefined) {
  const manifestPath = path.join(projectDir, '.cossack/scaffold.json');
  const ejected = previousManifest?.ejected;
  if (ejected && Object.keys(ejected).length) {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify({ schemaVersion: MANIFEST_SCHEMA_VERSION, tool: '@cossackframework/scaffold', ejected }, null, 2) + '\n');
  } else {
    await fs.rm(manifestPath, { force: true });
  }
  await pruneBases(projectDir);
  await fs.rmdir(path.join(projectDir, BASE_DIRECTORY)).catch(() => {});
  await fs.rmdir(path.join(projectDir, '.cossack')).catch(() => {});
  return path.join(projectDir, 'package.json');
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
      // Both the project and the recipe changed the file: merge them over the stored upstream text.
      const base = modified && existingHash !== null
        ? manifest?.bases?.get(owned[rel]?.base) ?? await readBase(projectDir, owned[rel]?.base) : null;
      const merged = base ? mergeText(base, await fs.readFile(absolute), entry.content) : null;
      if (merged?.status !== 'clean') {
        conflicts.push(rel);
        continue;
      }
      writes.push({ path: rel, capability: entry.capability, overwrite: true, merged: true, content: Buffer.from(merged.text) });
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

/** `package.json#cossack`: the recipe's values win; mounted packages the project added itself are kept. */
function mergeCossackField(current = {}, desired = {}, previous = {}) {
  const merged = { ...current, ...desired };
  // The recorded recipe goes when the recipe is no longer recorded here.
  for (const key of ['features', 'options']) if (!Object.hasOwn(desired, key)) delete merged[key];
  // The template is the version of the project's own files: only the project raises it.
  if (!Object.hasOwn(desired, 'template')) delete merged.template;
  else if (typeof current.template === 'string') merged.template = current.template;
  const own = (current.packages ?? []).filter(name => !(previous.packages ?? []).includes(name));
  const packages = [...new Set([...(desired.packages ?? []), ...own])];
  if (packages.length) merged.packages = packages;
  else delete merged.packages;
  return merged;
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
  const recorded = await readManifest(projectDir);
  let ownedDependencies = recorded?.dependencyBaseline ?? previous;
  if (recorded && !recorded.dependencyBaseline) {
    // The project states its dependencies through its recipe, as this release renders it.
    ownedDependencies = JSON.parse(packageJson(await inferRecipe(projectDir, recorded), path.basename(projectDir)));
  }
  const dependencies = planDependencyChanges(current, desired, ownedDependencies, { force: forceManaged });
  const previouslyManagedBuilds = new Set([
    ...PNPM_MANAGED_BUILDS,
    ...(previous.pnpm?.onlyBuiltDependencies ?? []),
  ]);
  const userBuilds = (current.pnpm?.onlyBuiltDependencies ?? []).filter(
    (name) => !previouslyManagedBuilds.has(name),
  );
  const merged = {
    ...current,
    cossack: mergeCossackField(current.cossack, desired.cossack, previous.cossack),
    scripts: mergePackageSection(
      current.scripts,
      desired.scripts,
      previous.scripts,
      forceManaged,
    ),
    ...dependencies.next,
  };
  if (current.pnpm) {
    const pnpm = { ...current.pnpm };
    delete pnpm.onlyBuiltDependencies;
    if (Object.keys(pnpm).length > 0) merged.pnpm = pnpm;
    else delete merged.pnpm;
  }
  entry.content = text(JSON.stringify(merged, null, 2) + '\n');
  entry.dependencyBaseline = dependencies.baseline;
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
  // Feature composition must install its dependency fixes as well as its build approvals.
  for (const key of ['overrides', 'patchedDependencies']) {
    const existing = current.get(key)?.toJSON?.() ?? {};
    const before = previous[key] ?? {};
    const after = desired[key] ?? {};
    const merged = { ...existing };
    for (const [name, value] of Object.entries(before)) {
      if (!(name in after) && existing[name] === value) delete merged[name];
    }
    for (const [name, value] of Object.entries(after)) {
      if (!(name in existing) || existing[name] === before[name]) merged[name] = value;
    }
    if (Object.keys(merged).length) current.set(key, merged);
    else current.delete(key);
  }
  if (desired.nodeLinker && (!current.has('nodeLinker') || current.get('nodeLinker') === previous.nodeLinker)) {
    current.set('nodeLinker', desired.nodeLinker);
  } else if (!desired.nodeLinker && previous.nodeLinker && current.get('nodeLinker') === previous.nodeLinker) {
    // Removing the feature that required the linker restores pnpm's default.
    current.delete('nodeLinker');
  }
  // Nothing changed: the file keeps its own text, its comments and quoting included.
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  const unchanged = canonical(current.toJS()) === canonical(parseDocument(currentSource).toJS());
  entry.content = text(unchanged ? currentSource : current.toString());
  return entry;
}

/**
 * `pnpm-workspace.yaml` for an upgrade: the template's keys go over the project's file, and
 * keys the project added (its own overrides, build approvals) stay. The manifest records the
 * file with those keys, so a plain copy of the template's text would drop them.
 */
export async function upgradedPnpmWorkspace(projectDir, content) {
  return (await mergePnpmWorkspace(projectDir, new Map([['pnpm-workspace.yaml', { content }]]))).content;
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
    await fs.writeFile(absolute, change.content ?? entry.content);
  }
}

/** Record the outcome of a change: the recipe is in the package.json the change wrote, and no file is recorded. */
export async function writeManifest(projectDir, _recipe, _rendered, previousManifest = undefined) {
  return dropFileRecords(projectDir, previousManifest);
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
      ],
    },
    // A CMS project starts from the CMS alone: the other presets' examples conflict with it.
    !options.preset && !parseList(options.features).includes('cms') && {
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
  if (!projectName) throw Object.assign(new Error('Please provide a project name'), { code: 'COSSACK_ARGUMENT_MISSING' });
  const nameProblem = projectNameProblem(path.basename(path.resolve(options.cwd ?? process.cwd(), projectName)));
  if (nameProblem) throw Object.assign(new Error(nameProblem), { code: 'COSSACK_PROJECT_NAME_INVALID' });
  if (options.dryRun) options = { ...options, interactive: false };
  let previous = {};
  let startAtLast = false;
  while (true) {
    const prompted = await promptCreationOptions(options, previous, startAtLast);
    const projectDir = path.resolve(prompted.cwd ?? process.cwd(), projectName);
    const recipe = ensureEnvironmentSecrets(resolveRecipe(prompted));
    const existing = await fs.stat(projectDir).catch(error => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (existing && !existing.isDirectory()) {
      throw Object.assign(new Error(`Target path exists and is not a directory: ${projectDir}`), { code: 'COSSACK_TARGET_NOT_DIRECTORY' });
    }
    if (existing && (await fs.readdir(projectDir)).length > 0 && !prompted.force) {
      throw new Error(`Target directory is not empty: ${projectDir}`);
    }
    const rendered = await renderRecipe(recipe, {
      projectName: path.basename(projectDir),
      authSecret: recipe.config.authSecret,
    });
    const plan = await buildPlan(projectDir, rendered, null, prompted.force);
    if (plan.conflicts.length) throw new Error(`Scaffold conflicts: ${plan.conflicts.join(', ')}`);
    if (prompted.dryRun) {
      return {
        status: 'dry-run', projectDir, adapter: recipe.adapter,
        manifestPath: path.join(projectDir, 'package.json'),
        recipe: publicRecipe(recipe), changes: plan,
      };
    }
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
      return { projectDir, adapter: recipe.adapter, manifestPath: path.join(projectDir, 'package.json'), recipe: publicRecipe(recipe), status: 'cancelled' };
    }
    const manifestPath = await applyPlanAndManifestAtomically(projectDir, rendered, plan, recipe, undefined);
    return {
      status: 'created',
      changes: plan,
      projectDir,
      adapter: recipe.adapter,
      manifestPath,
      recipe: publicRecipe(recipe),
    };
  }
}

/** Resolve recorded features through the same registry used for composition. */
export function resolveManifestRecipe(manifest) {
  if (!manifest || !supportedManifest(manifest) || !ADAPTERS.includes(manifest.runtime ?? manifest.adapter) ||
      !Array.isArray(manifest.explicitFeatures ?? manifest.resolvedFeatures)) {
    throw new Error('A scaffold manifest with a runtime and feature list is required.');
  }
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
  if (manifest && !supportedManifest(manifest)) {
    throw new Error(
      `Unsupported scaffold manifest schema ${manifest.schemaVersion ?? '(missing)'}. ` +
      `Cossack requires schema version ${MANIFEST_SCHEMA_VERSION}.`,
    );
  }
  if (manifest) {
    return resolveManifestRecipe(manifest);
  }
  const pkg = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'));
  const dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const features = [];
  if (dependencies['@cossackframework/ui']) features.push('ui');
  if (dependencies['@cossackframework/database']) features.push('database');
  if (dependencies['@cossackframework/studio']) features.push('studio');
  if (dependencies['@cossackframework/auth']) features.push('auth');
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

/**
 * Apply a plan and write the manifest as one unit. On any failure, every
 * touched file is restored to its previous bytes (or removed when it did not
 * exist) and directories created for the plan are removed again, so a failed
 * command leaves neither half-written files nor a stale manifest.
 */
async function applyPlanAndManifestAtomically(
  projectDir,
  rendered,
  plan,
  recipe,
  manifest,
) {
  const affected = new Set([
    ...plan.writes.map((change) => change.path),
    ...plan.deletes.map((change) => change.path),
    '.cossack/scaffold.json',
  ]);
  const snapshots = new Map();
  for (const rel of affected) {
    try {
      snapshots.set(rel, await fs.readFile(path.join(projectDir, rel)));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      snapshots.set(rel, null);
    }
  }
  // Directories that do not exist yet, including the project directory itself.
  const createdDirectories = new Set();
  for (const rel of affected) {
    let directory = path.dirname(path.join(projectDir, rel));
    while (!createdDirectories.has(directory) && !(await access(directory))) {
      createdDirectories.add(directory);
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  const baseDirectory = path.join(projectDir, BASE_DIRECTORY);
  const baseDirectoryExisted = await access(baseDirectory);
  const basesBefore = new Set(await fs.readdir(baseDirectory).catch(() => []));
  try {
    await applyPlan(projectDir, rendered, plan);
    return await writeManifest(projectDir, recipe, rendered, manifest, plan);
  } catch (error) {
    const failures = [];
    // Bases stored for this plan go with it. Blobs the old manifest names are never pruned before the new one is in place.
    for (const name of await fs.readdir(baseDirectory).catch(() => [])) {
      if (!basesBefore.has(name)) await fs.rm(path.join(baseDirectory, name), { force: true }).catch(() => {});
    }
    if (!baseDirectoryExisted) await fs.rmdir(baseDirectory).catch(() => {});
    for (const [rel, content] of snapshots) {
      const absolute = path.join(projectDir, rel);
      try {
        if (content === null) {
          await fs.rm(absolute, { force: true });
        } else {
          await fs.mkdir(path.dirname(absolute), { recursive: true });
          await fs.writeFile(absolute, content);
        }
      } catch {
        failures.push(rel);
      }
    }
    // Deepest first; a directory that still holds other files is kept.
    for (const directory of [...createdDirectories].sort((a, b) => b.length - a.length)) {
      await fs.rmdir(directory).catch(() => {});
    }
    if (failures.length) {
      error.message += ` Restoring the project also failed for: ${failures.join(', ')}.`;
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
  const manifestPath = path.join(root, 'package.json');
  const manifest = await readManifest(root);
  if (!manifest) {
    throw new Error(
      'Adapter switching requires a recipe in package.json#cossack (features). Create the project with cossack create.',
    );
  }
  if (!supportedManifest(manifest)) {
    throw new Error(
      `Unsupported scaffold manifest schema ${manifest.schemaVersion ?? '(missing)'}. ` +
      `Adapter switching requires schema version ${MANIFEST_SCHEMA_VERSION}.`,
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
  const targetDefault = target === 'cloudflare' ? 'd1' : 'sqlite';
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
    const recorded = withRenderedFiles(manifest, previousRendered);
    const plan = await buildPlan(
      root,
      rendered,
      recorded,
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
      recorded,
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
  if (feature === 'cms' && current.resolvedFeatures.includes('database') && current.config.database !== 'romedb') {
    throw new Error('This project keeps its data in another database. The cms feature keeps content and accounts in RomeDB, so add it to a new project: cossack create <name> --features cms.');
  }
  if (options.dryRun) options = { ...options, interactive: false };
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
    const recorded = withRenderedFiles(manifest, manifest
      ? await renderRecipe(current, { projectName: path.basename(root), environmentContent: environment.content }) : undefined);
    const plan = await buildPlan(root, rendered, recorded, prompted.force);
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
        manifestPath: path.join(root, 'package.json'),
      };
    }
    if (prompted.dryRun) {
      return {
        status: 'dry-run',
        recipe: publicRecipe(recipe),
        changes: plan,
        addedFeatures,
        addedDashboardModules,
        manifestPath: path.join(root, 'package.json'),
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
        manifestPath: path.join(root, 'package.json'),
      };
    }
    const manifestPath = await applyPlanAndManifestAtomically(root, rendered, plan, recipe, recorded);
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
      manifestPath: path.join(root, 'package.json'),
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
  const recorded = withRenderedFiles(manifest, previousRendered);
  const plan = await buildPlan(root, rendered, recorded, options.force);
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
      manifestPath: path.join(root, 'package.json'),
    };
  }
  if (options.dryRun) {
    return {
      status: 'dry-run',
      recipe: publicRecipe(recipe),
      changes: plan,
      manifestPath: path.join(root, 'package.json'),
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
      manifestPath: path.join(root, 'package.json'),
    };
  }
  const manifestPath = await applyPlanAndManifestAtomically(root, rendered, plan, recipe, recorded);
  return {
    status: 'removed',
    recipe: publicRecipe(recipe),
    changes: plan,
    manifestPath,
  };
}
