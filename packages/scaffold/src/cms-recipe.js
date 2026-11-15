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
import path from 'node:path';
import { createRequire } from 'node:module';

/** The package a CMS project mounts. */
export const CMS_PACKAGE = '@cossackframework/cms';
/** The CMS application inside @cossackframework/cms. */
export const cmsAppDir = path.join(path.dirname(createRequire(import.meta.url).resolve(`${CMS_PACKAGE}/package.json`)), 'app');
const manifest = JSON.parse(await fs.readFile(path.join(cmsAppDir, 'cossack-recipe.json'), 'utf8'));
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

export function cmsRecipeFiles({ adapter }) {
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
 * Worker entry: export the pending-write Durable Object, run maintenance from cron, and run
 * isolated plugins through the Worker Loader binding with the bridge they call back.
 */
export function patchCmsWorkerEntry(source, { schedules }) {
  let patched = source.replace("import { template } from './root';", "import { template } from './root';\nimport { cloudflarePluginRunner, createPluginBridge, PluginTail } from '@cossackframework/cms/cloudflare';\nimport { networkFor, setPluginRunner } from '@cossackframework/cms/app/cms/index';\nimport { runNetworkMaintenance } from '@cossackframework/cms/app/cms/maintenance';\nimport { pluginRouteActive } from '@cossackframework/cms/app/cms/middleware';");
  patched = patched.replace('  htmlTemplate: template,\n', '  htmlTemplate: template,\n  // A rendered plugin\'s pages and handlers answer only while the plugin is active in the CMS.\n  isPluginActive: pluginRouteActive,\n');
  patched = patched.replace('export { SseDurableObject };', `export { SseDurableObject };
// Unconfirmed RomeDB writes (ROMEDB_PENDING) survive isolate restarts here.
export { RomeDBPendingWrites } from '@cossackframework/romedb/cloudflare';
// Isolated plugins run in Workers of their own through the Worker Loader binding (LOADER, which
// cossack add plugin adds with the first one), and call the CMS back through PluginBridge.
setPluginRunner(cloudflarePluginRunner());
export const PluginBridge = createPluginBridge<CloudflareBindings>((env, site) => networkFor(env as never).hostById(site));
export { PluginTail };`);
  const maintenance = 'ctx.waitUntil(runNetworkMaintenance(networkFor(env as never), { warm: true }));';
  if (schedules) {
    return patched.replace(
      'async scheduled(controller: ScheduledController, env: CloudflareBindings) { await createSchedules(env).scheduled(controller); },',
      `async scheduled(controller: ScheduledController, env: CloudflareBindings, ctx: ExecutionContext) {\n    ${maintenance}\n    await createSchedules(env).scheduled(controller);\n  },`,
    );
  }
  return patched.replace('fetch: app.fetch,', `fetch: app.fetch,\n  // Recover unconfirmed writes, deliver outbox events and keep the Cloud database warm.\n  async scheduled(_controller: ScheduledController, env: CloudflareBindings, ctx: ExecutionContext) {\n    ${maintenance}\n  },`);
}

/** Node entry: run maintenance every minute in the server process. */
export function patchCmsNodeEntry(source) {
  return source
    .replace("import { template } from './root';", "import { template } from './root';\nimport { networkFor } from '@cossackframework/cms/app/cms/index';\nimport { runNetworkMaintenance } from '@cossackframework/cms/app/cms/maintenance';\nimport { pluginRouteActive } from '@cossackframework/cms/app/cms/middleware';")
    // A rendered plugin's pages and handlers answer only while the plugin is active in the CMS.
    .replace('htmlTemplate: template, runtimeAdapter: runtime })', 'htmlTemplate: template, runtimeAdapter: runtime, isPluginActive: pluginRouteActive })')
    .replace('  runtime.attach(server, fetch);', `  runtime.attach(server, fetch);
  // Recover unconfirmed writes and deliver outbox events in the background, on each site in turn.
  const maintenance = setInterval(() => {
    runNetworkMaintenance(networkFor(env as never)).catch(error => console.error('[cms] maintenance failed', error));
  }, 60_000);
  maintenance.unref();`);
}

/**
 * Vite: plugin policy lints fail builds (raw RomeQL, undeclared network, permissions or hooks).
 * `pnpm dev` starts \`romedb serve\` for a loopback ROMEDB_URL; on Node, RomeDB's native
 * addon loads with Node rather than through Vite.
 */
export function patchCmsViteConfig(source, { adapter }) {
  const cloudflare = adapter === 'cloudflare';
  let patched = source
    .replace("import { cossackSsg } from '@cossackframework/framework/vite-ssg-plugin';", `import { cossackSsg } from '@cossackframework/framework/vite-ssg-plugin';\nimport { cossackPluginPolicy } from 'cossack/plugin-policy';\nimport { ${cloudflare ? 'romedbDev, romedbDevVars' : 'romedbDev'} } from '@cossackframework/romedb/dev';\nimport { cossackCmsIcons } from '@cossackframework/cms/vite';`)
    .replace('  plugins: [\n', '  plugins: [\n    // Starts `romedb serve` in development when ROMEDB_URL is a loopback URL.\n    romedbDev(),\n')
    .replace('    cossackConfig(),', '    cossackConfig(),\n    // Rendered plugins must stay within their manifest; violations fail the build.\n    cossackPluginPolicy(),\n    // The icon sprites under /assets/icons/, served in development and emitted into the client build.\n    cossackCmsIcons(),')
    // Plugins with only server code run in Workers of their own on Cloudflare (specs/cms-plugin-isolation.md).
    .replace('cossackPages({ ', "cossackPages({ pluginIsolation: { runtime: '@cossackframework/cms/isolate' }, ");
  if (cloudflare) {
    patched = patched.replace("      viteEnvironment: { name: 'ssr' },\n", "      viteEnvironment: { name: 'ssr' },\n      // The token of the local romedb serve that romedbDev started.\n      config: romedbDevVars,\n");
  } else {
    patched = patched.replace("            noExternal: [\n              'hono',", "            // RomeDB's native addon loads with Node, not through Vite, and shares @romedb/client's classes.\n            external: ['@romedb/client', '@romedb/node'],\n            noExternal: [\n              'hono',");
  }
  return patched;
}

export function cmsSetupCode() {
  return [...crypto.getRandomValues(new Uint8Array(12))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
