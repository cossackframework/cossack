/**
 * The cms feature: the RomeDB CMS host, its dashboard screens under /dashboard, first-run
 * setup, the public site and its default theme. It requires auth and dashboard.
 *
 * The CMS application is served from the @cossackframework/cms package (specs/cms-served-app.md):
 * the project mounts it (package.json#cossack.packages) and holds none of its files. This module
 * renders what the project does hold: the storage glue per runtime adapter, `src/cms.config.ts`,
 * one-line re-exports for the shell modules the CMS replaces, and the entry file patches.
 * `cossack-recipe.json` in the package's `app/` folder lists each kind.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

/** The package a CMS project mounts. */
export const CMS_PACKAGE = '@cossackframework/cms';
/** The CMS application inside @cossackframework/cms. */
export const cmsAppDir = path.join(path.dirname(createRequire(import.meta.url).resolve(`${CMS_PACKAGE}/package.json`)), 'app');
const manifest = JSON.parse(await fs.readFile(path.join(cmsAppDir, 'cossack-recipe.json'), 'utf8'));
const servedDirectories = manifest.served.filter(entry => entry.endsWith('/'));
const servedFiles = new Set(manifest.served.filter(entry => !entry.endsWith('/')));
/** Shell modules whose CMS versions are served; the project keeps a re-export at each path. */
const cmsFacades = manifest.facades;
/** Produced by {@link cmsRecipeFiles}. */
const cmsRendered = new Set(manifest.rendered);

/**
 * A path the package serves. The project holds no file there: a template file at such a path
 * would override the package's (specs/package-routes.md), so the recipe leaves it out.
 */
export function isServedCmsPath(rel) {
  return !cmsRendered.has(rel) && (servedFiles.has(rel) || servedDirectories.some(directory => rel.startsWith(directory)));
}

/** A path the cms capability writes into the project. */
export function isCmsPath(rel) {
  return cmsRendered.has(rel) || cmsFacades.includes(rel);
}

/**
 * The re-exports, by project path. Each shares the served module's one instance with the
 * package's own code. A browser-only module (`*.client.ts`) names its exports: the server
 * replaces such a module with a stub, and a stub cannot be made from `export *`.
 */
export async function cmsFacadeFiles() {
  const files = {};
  for (const rel of cmsFacades) {
    const specifier = `${CMS_PACKAGE}/app/${rel.replace(/^src\//, '').replace(/\.ts$/, '')}`;
    let body = `export * from '${specifier}';\n`;
    if (/\.client\.ts$/.test(rel)) {
      const source = await fs.readFile(path.join(cmsAppDir, rel), 'utf8');
      const values = [...source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(match => match[1]);
      const types = [...source.matchAll(/^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm)].map(match => match[1]);
      if (/^export\s*(?:\{|\*|default\b)/m.test(source)) throw new Error(`${rel}: a browser-only module the project re-exports must declare each export in place.`);
      body = `${values.length ? `export { ${values.join(', ')} } from '${specifier}';\n` : ''}${types.length ? `export type { ${types.join(', ')} } from '${specifier}';\n` : ''}`;
    }
    files[rel] = `// The CMS's version of this module, served from the package. Change behaviour with a plugin or src/cms.config.ts.\n${body}`;
  }
  return files;
}

export function cmsRecipeFiles({ adapter }) {
  return {
    // The project's own file: written once, then merged on upgrades like any owned file.
    'src/cms.config.ts': `import { contentModule, formsModule, type ResourceDeclaration } from '@cossackframework/cms';
import type { CmsProjectConfig } from '@cossackframework/cms/server';

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
    'src/cms/database.ts': adapter === 'cloudflare'
      ? `import { organizationDatabases, type DatabaseDirectory, type RomeDBOptions } from '@cossackframework/romedb';

export interface DatabaseBindings {
    /**
     * RomeDB database URL. Workers reach RomeDB over HTTP: a RomeDB Cloud database, or
     * \`romedb serve\` in development (\`pnpm dev\` starts it for a loopback URL).
     */
    ROMEDB_URL?: string;
    /** Database grant (Cloud \`query\` scope) or the local service token. Server-only. */
    ROMEDB_TOKEN?: string;
    /** Where added sites keep their databases: a RomeDB Cloud organization URL, or \`romedb serve --directory\`. */
    ROMEDB_SITES_URL?: string;
    /** Organization key with the \`manage\` and \`query\` scopes, for ROMEDB_SITES_URL. Server-only. */
    ROMEDB_SITES_TOKEN?: string;
}

/** How the CMS reaches its database. */
export function databaseConnection(env: DatabaseBindings): Pick<RomeDBOptions, 'url' | 'token' | 'connect'> {
    const url = env.ROMEDB_URL;
    const token = env.ROMEDB_TOKEN;
    if (!url || !token) throw new Error('The CMS needs ROMEDB_URL and ROMEDB_TOKEN: a RomeDB Cloud database, or a loopback URL that pnpm dev serves with romedb serve.');
    return { url, token };
}

/** How the CMS reaches an added site's database, or null while sites cannot have their own (no ROMEDB_SITES_URL). */
export function siteDatabase(env: DatabaseBindings, database: string): Pick<RomeDBOptions, 'url' | 'token' | 'connect'> | null {
    const sites = env.ROMEDB_SITES_URL;
    if (!sites) return null;
    if (!env.ROMEDB_SITES_TOKEN) throw new Error('ROMEDB_SITES_URL needs ROMEDB_SITES_TOKEN, an organization key with the manage and query scopes.');
    return { url: \`\${sites.replace(/\\/$/, '')}/databases/\${database}\`, token: env.ROMEDB_SITES_TOKEN };
}

/** Creates and deletes added sites' databases, or null without ROMEDB_SITES_URL. */
export function siteDirectory(env: DatabaseBindings): DatabaseDirectory | null {
    return env.ROMEDB_SITES_URL && env.ROMEDB_SITES_TOKEN ? organizationDatabases({ url: env.ROMEDB_SITES_URL, token: env.ROMEDB_SITES_TOKEN }) : null;
}

/** Webhook deliveries use the Worker's own fetch, which cannot reach private networks. */
export const webhookFetch: typeof fetch | undefined = undefined;
`
      : `import path from 'node:path';
import { organizationDatabases, type DatabaseDirectory, type RomeDBOptions } from '@cossackframework/romedb';
import { connectNode, fileDatabases, isServiceUrl } from '@cossackframework/romedb/node';
import { publicOnlyFetch } from '@cossackframework/cms/node';

export interface DatabaseBindings {
    /**
     * A file path opens the database in this process and creates it on first use (default
     * storage/romedb/app.romedb). A URL connects to \`romedb serve\` (\`pnpm dev\` starts it for a
     * loopback URL) or to a RomeDB Cloud database.
     */
    ROMEDB_URL?: string;
    /** Credential for a service or Cloud URL. Server-only. Files need none. */
    ROMEDB_TOKEN?: string;
    /**
     * Where added sites keep their databases when ROMEDB_URL is a URL: a RomeDB Cloud organization
     * URL, or \`romedb serve --directory\`. With a file, each site is a file beside it.
     */
    ROMEDB_SITES_URL?: string;
    /** Organization key with the \`manage\` and \`query\` scopes, for ROMEDB_SITES_URL. Server-only. */
    ROMEDB_SITES_TOKEN?: string;
}

/** How the CMS reaches its database. One process owns a file; share it through \`romedb serve\`. */
export function databaseConnection(env: DatabaseBindings): Pick<RomeDBOptions, 'url' | 'token' | 'connect'> {
    const url = env.ROMEDB_URL || 'storage/romedb/app.romedb';
    const token = env.ROMEDB_TOKEN || undefined;
    if (isServiceUrl(url) && !token) throw new Error(\`ROMEDB_TOKEN is required for \${url}. Use a file path in ROMEDB_URL to keep the database in this process.\`);
    return { url, ...(token ? { token } : {}), connect: () => connectNode({ url, ...(token ? { token } : {}) }) };
}

/**
 * How the CMS reaches an added site's database: a file beside the main one
 * (storage/romedb/<database>.romedb), or a database of ROMEDB_SITES_URL. Null when the main
 * database is a URL and ROMEDB_SITES_URL is not set.
 */
export function siteDatabase(env: DatabaseBindings, database: string): Pick<RomeDBOptions, 'url' | 'token' | 'connect'> | null {
    const sites = env.ROMEDB_SITES_URL;
    if (sites) {
        const token = env.ROMEDB_SITES_TOKEN;
        if (!token) throw new Error('ROMEDB_SITES_URL needs ROMEDB_SITES_TOKEN, an organization key with the manage and query scopes.');
        const url = \`\${sites.replace(/\\/$/, '')}/databases/\${database}\`;
        return { url, token, connect: () => connectNode({ url, token }) };
    }
    const main = env.ROMEDB_URL || 'storage/romedb/app.romedb';
    if (isServiceUrl(main)) return null;
    const url = path.join(path.dirname(main), \`\${database}.romedb\`);
    return { url, connect: () => connectNode({ url }) };
}

/** Creates and deletes added sites' databases: files beside the main one, or under ROMEDB_SITES_URL. Null when neither applies. */
export function siteDirectory(env: DatabaseBindings): DatabaseDirectory | null {
    if (env.ROMEDB_SITES_URL && env.ROMEDB_SITES_TOKEN) return organizationDatabases({ url: env.ROMEDB_SITES_URL, token: env.ROMEDB_SITES_TOKEN });
    const main = env.ROMEDB_URL || 'storage/romedb/app.romedb';
    return isServiceUrl(main) ? null : fileDatabases(path.dirname(main));
}

/** Webhook deliveries refuse names that resolve to this machine or a private network. */
export const webhookFetch: typeof fetch | undefined = publicOnlyFetch;
`,
    'src/cms/media.ts': adapter === 'cloudflare'
      ? `import type { StorageProvider } from '@cossackframework/core/storage';
import type { ImageTransformer } from '@cossackframework/cms/server';
import { createR2StorageProvider, type R2StorageBucket } from '@cossackframework/framework/storage/r2';

/** The part of the Cloudflare Images binding the CMS uses. */
interface ImagesBinding {
    input(stream: ReadableStream<Uint8Array>): ImagesChain;
}
interface ImagesChain {
    transform(options: Record<string, unknown>): ImagesChain;
    output(options: { format: string; quality?: number }): Promise<{ response(): Response }>;
}

export interface MediaBindings {
    /** R2 bucket for uploaded media (r2_buckets in wrangler.jsonc). */
    MEDIA?: R2StorageBucket;
    /** Cloudflare Images (images in wrangler.jsonc): resized variants, crops and modern formats. */
    IMAGES?: ImagesBinding;
}

/** Media bytes live in R2. Without the binding, uploads are unavailable. */
export function mediaStorage(env: MediaBindings): StorageProvider | undefined {
    return env.MEDIA ? createR2StorageProvider(env.MEDIA) : undefined;
}

/**
 * Resized images through the Images binding. Local development runs a low-fidelity version
 * without crops; variants then keep the whole image.
 */
export function imageTransformer(env: MediaBindings): ImageTransformer | undefined {
    const images = env.IMAGES;
    if (!images) return undefined;
    return {
        async transform(input, request) {
            const bytes = await new Response(input).arrayBuffer();
            const { rect, source } = request;
            const whole = rect.x === 0 && rect.y === 0 && rect.width === source.width && rect.height === source.height;
            const run = async (trim: boolean) => {
                let chain = images.input(new Response(bytes).body!);
                if (trim) chain = chain.transform({ trim: { top: rect.y, left: rect.x, bottom: source.height - rect.y - rect.height, right: source.width - rect.x - rect.width } });
                chain = chain.transform({ width: request.width, height: request.height, fit: 'cover' });
                const output = await chain.output({ format: \`image/\${request.format}\`, quality: request.quality });
                return new Uint8Array(await output.response().arrayBuffer());
            };
            if (whole) return run(false);
            try { return await run(true); } catch { return run(false); }
        },
    };
}
`
      : `import type { StorageProvider } from '@cossackframework/core/storage';
import type { ImageTransformer } from '@cossackframework/cms/server';
import { LocalStorageProvider } from '@cossackframework/node-adapter/storage';
import { S3Client } from '@aws-sdk/client-s3';
import { createS3StorageProvider } from '@cossackframework/framework/storage/s3';

export interface MediaBindings {
    /** Directory for uploaded media when S3 is not configured. Default storage/media. */
    MEDIA_DIR?: string;
    /** Store media in this S3 (or S3-compatible) bucket instead of MEDIA_DIR. */
    S3_BUCKET?: string;
    S3_REGION?: string;
    /** Endpoint of an S3-compatible service, such as R2 or MinIO. */
    S3_ENDPOINT?: string;
    S3_ACCESS_KEY_ID?: string;
    S3_SECRET_ACCESS_KEY?: string;
}

/** Media bytes live in S3 when S3_BUCKET is set, otherwise in a local directory owned by this process. */
export function mediaStorage(env: MediaBindings): StorageProvider {
    if (!env.S3_BUCKET) return new LocalStorageProvider({ root: env.MEDIA_DIR || 'storage/media' });
    const client = new S3Client({
        region: env.S3_REGION || 'auto',
        // Presigned browser uploads need this: otherwise the SDK signs a checksum of an empty body.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
        ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } } : {}),
    });
    return createS3StorageProvider({ client, bucket: env.S3_BUCKET });
}

/** Resized variants, crops and modern formats through sharp, loaded on first use. */
export function imageTransformer(_env: MediaBindings): ImageTransformer {
    return {
        async transform(input, request) {
            const { default: sharp } = await import('sharp');
            const { rect, source } = request;
            let image = sharp(Buffer.from(await new Response(input).arrayBuffer()), { failOn: 'none' });
            if (rect.x !== 0 || rect.y !== 0 || rect.width !== source.width || rect.height !== source.height) {
                image = image.extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });
            }
            const output = await image.resize(request.width, request.height, { fit: 'fill' }).toFormat(request.format, { quality: request.quality }).toBuffer();
            return new Uint8Array(output);
        },
    };
}
`,
    'src/cms/pending.ts': adapter === 'cloudflare'
      ? `import { DurableObjectPendingWriteStore, type DurableObjectNamespaceLike } from '@cossackframework/romedb/cloudflare';
import type { PendingWriteStore } from '@cossackframework/romedb';

export interface PendingBindings {
    /** Durable Object namespace for RomeDBPendingWrites (exported from src/index.ts). */
    ROMEDB_PENDING?: DurableObjectNamespaceLike;
}

/**
 * Writes are saved in a Durable Object before dispatch, so an unconfirmed write survives the
 * isolate. Each database has its own objects; the main site's keep their name.
 */
export function pendingWrites(env: PendingBindings, database = 'main'): PendingWriteStore {
    if (!env.ROMEDB_PENDING) throw new Error('Bind the ROMEDB_PENDING Durable Object (class RomeDBPendingWrites) in wrangler.jsonc.');
    return new DurableObjectPendingWriteStore(env.ROMEDB_PENDING, database === 'main' ? {} : { name: \`romedb:\${database}\` });
}
`
      : `import path from 'node:path';
import { FilePendingWriteStore } from '@cossackframework/romedb/node';
import type { PendingWriteStore } from '@cossackframework/romedb';

export interface PendingBindings {
    /** Directory for unconfirmed writes. Default .cossack/romedb-pending. */
    ROMEDB_PENDING_DIR?: string;
}

/**
 * Writes are saved as private files before dispatch, so an unconfirmed write survives a
 * restart. Each added site has its own folder (sites/<database>); the main site's are at the top.
 */
export function pendingWrites(env: PendingBindings, database = 'main'): PendingWriteStore {
    const directory = env.ROMEDB_PENDING_DIR ?? '.cossack/romedb-pending';
    return new FilePendingWriteStore(database === 'main' ? directory : path.join(directory, 'sites', database));
}
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
