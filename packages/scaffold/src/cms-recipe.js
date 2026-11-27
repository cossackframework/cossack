/**
 * The cms feature: the RomeDB CMS host, its dashboard screens under /dashboard, first-run
 * setup, the public site and its default theme. It requires auth and dashboard.
 *
 * The CMS application is served from the @cossackframework/cms package (specs/cms-served-app.md):
 * the project mounts it (package.json#cossack.packages) and holds none of its files, the sign-in
 * pages and the dashboard included. This module renders what the project does hold:
 * `src/cms.config.ts`, and the entry file patches. `cossack-recipe.json` in the package's `app/`
 * folder lists each kind.
 */
import fs from 'node:fs/promises';

/** The package a CMS project mounts. */
export const CMS_PACKAGE = '@cossackframework/cms';
/**
 * A copy of `packages/cms/app/cossack-recipe.json`, so the scaffold (and the `cossack` CLI,
 * which a project may keep in production for migrations) does not depend on the CMS package.
 * `tests/cms-recipe.test.js` fails when the two differ.
 */
const manifest = JSON.parse(await fs.readFile(new URL('./cms-recipe.json', import.meta.url), 'utf8'));
/** Everything the package serves: its own sources, and the shell `pnpm sync` writes into it. */
const served = [...manifest.served, ...manifest.shell];
const servedDirectories = served.filter(entry => entry.endsWith('/'));
const servedFiles = new Set(served.filter(entry => !entry.endsWith('/')));
/** Produced by {@link cmsRecipeFiles}. */
const cmsRendered = new Set(manifest.rendered);

/**
 * A path the package serves. The project holds no file there: a file at such a path would
 * override the package's (specs/package-routes.md), so the recipe leaves it out.
 */
export function isServedCmsPath(rel) {
  return !cmsRendered.has(rel) && (servedFiles.has(rel) || servedDirectories.some(directory => rel.startsWith(directory)));
}

/** A path the cms capability writes into the project. */
export function isCmsPath(rel) {
  return cmsRendered.has(rel);
}

export function cmsRecipeFiles({ adapter, oauth = [] }) {
  return {
    // The project's own file: written once, then merged on upgrades like any owned file.
    'src/cms.config.ts': `import { contentModule, formsModule, type ResourceDeclaration } from '@cossackframework/cms';
import type { CmsProjectConfig } from '@cossackframework/cms/server';
import { ${adapter === 'cloudflare' ? 'cloudflareStorage' : 'nodeStorage'} } from '@cossackframework/cms/storage/${adapter === 'cloudflare' ? 'cloudflare' : 'node'}';

/**
 * Where the CMS keeps its data: ${adapter === 'cloudflare'
    ? 'RomeDB over HTTP (ROMEDB_URL, ROMEDB_TOKEN), unconfirmed writes in a Durable\n * Object (ROMEDB_PENDING), media in R2 (MEDIA) and resized images through the Images binding (IMAGES).'
    : 'a RomeDB file or service (ROMEDB_URL), unconfirmed writes as private\n * files, media in a local directory or S3 (MEDIA_DIR, S3_BUCKET) and resized images through sharp.'}
 * Replace a member to keep something elsewhere: \`{ ...${adapter === 'cloudflare' ? 'cloudflareStorage' : 'nodeStorage'}, mediaStorage: env => myProvider }\`.
 */
export const storage = ${adapter === 'cloudflare' ? 'cloudflareStorage' : 'nodeStorage'};

/**
 * Code-declared resources, stored in strict RomeDB collections, such as an \`app/leads\`
 * resource with \`defineResource\`. Change a declaration, then apply the plan from
 * /dashboard/tools/schema. Content types made in the dashboard are collections instead:
 * Collections in the dashboard defines them and their fields.
 */
export const resources: ResourceDeclaration[] = [];

/** Built-in modules: posts, pages, categories, tags and the core blocks; forms and their input blocks. Plugins add their own. */
export const modules = [contentModule, formsModule];

/**
 * Options for each site's CMS. An unset option keeps its default. Give an object, or a
 * function of the environment bindings and the site: \`(env, site) => ({ ... })\`.
 */
export const options: CmsProjectConfig = {
    // First path segments an entry's address cannot take, added to the CMS's own and to this project's routes.
    // reservedPaths: ['pricing'],
    // OAuth providers on the sign-in page. Each reads <PROVIDER>_CLIENT_ID and <PROVIDER>_CLIENT_SECRET;
    // OAUTH_SECRET signs the state. The provider's verified email names the account.
    ${oauth.length ? `oauth: [${oauth.map(provider => `'${provider}'`).join(', ')}],` : "// oauth: ['github'],"}
    // Blocks and settings groups declared in code. Plugins declare theirs in their manifest.
    // blocks: [],
    // settings: [],
    // Providers. The defaults read STRIPE_SECRET_KEY, the AI binding, CLOUDFLARE_API_TOKEN and EMAIL.
    // payments: undefined,
    // ai: undefined,
    // purgers: [],
    // mail: undefined,
    // mailFrom: 'no-reply@example.com',
};
`,
  };
}

/**
 * Worker entry: export the CMS's Durable Object classes and entrypoints, and run its
 * maintenance from cron. The package holds the code (`app/src/cms/entry.ts`, `worker.ts`).
 */
export function patchCmsWorkerEntry(source, { schedules }) {
  let patched = source.replace("import { template } from './root';", "import { template } from './root';\nimport { cmsAppOptions, cmsScheduled } from '@cossackframework/cms/app/cms/entry';");
  patched = patched.replace('  htmlTemplate: template,\n', '  htmlTemplate: template,\n  // A rendered plugin\'s pages and handlers answer only while the plugin is active in the CMS.\n  ...cmsAppOptions,\n');
  patched = patched.replace('export { SseDurableObject };', `export { SseDurableObject };
// The CMS's Durable Object class and Worker entrypoints, which wrangler.jsonc names: pending
// RomeDB writes (ROMEDB_PENDING), and the bridge and log tail of isolated plugins.
export { RomeDBPendingWrites, PluginBridge, PluginTail } from '@cossackframework/cms/app/cms/worker';`);
  if (schedules) {
    return patched.replace(
      'async scheduled(controller: ScheduledController, env: CloudflareBindings) { await createSchedules(env).scheduled(controller); },',
      'async scheduled(controller: ScheduledController, env: CloudflareBindings, ctx: ExecutionContext) {\n    cmsScheduled(env, ctx);\n    // The CMS\'s every-minute cron runs only its maintenance unless a schedule uses that cron too.\n    const schedules = createSchedules(env);\n    if (schedules.list().some(schedule => schedule.cron === controller.cron)) await schedules.scheduled(controller);\n  },',
    );
  }
  return patched.replace('fetch: app.fetch,', 'fetch: app.fetch,\n  // Recover unconfirmed writes, deliver outbox events and keep the Cloud database warm.\n  async scheduled(_controller: ScheduledController, env: CloudflareBindings, ctx: ExecutionContext) {\n    cmsScheduled(env, ctx);\n  },');
}

/** Node entry: the same options, and maintenance every minute in the server process. */
export function patchCmsNodeEntry(source) {
  return source
    .replace("import { template } from './root';", "import { template } from './root';\nimport { cmsAppOptions, startCmsMaintenance } from '@cossackframework/cms/app/cms/entry';")
    .replace('htmlTemplate: template, runtimeAdapter: runtime })', 'htmlTemplate: template, runtimeAdapter: runtime, ...cmsAppOptions })')
    .replace('  dev: import.meta.env?.DEV,\n', '  dev: import.meta.env?.DEV,\n  // Recover unconfirmed writes and deliver outbox events in the background.\n  started: startCmsMaintenance,\n');
}

export function cmsSetupCode() {
  return [...crypto.getRandomValues(new Uint8Array(12))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
