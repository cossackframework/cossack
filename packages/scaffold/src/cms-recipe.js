/**
 * The cms feature: the RomeDB CMS host, its dashboard screens under /dashboard, first-run
 * setup, the public site and its default theme (src/plugins/default-theme). It requires auth and
 * dashboard; the files the feature owns, including the RomeDB storage modules that replace the
 * database ones, live in the @cossackframework/cms package under `app/` and are listed in its
 * `cossack-recipe.json`. This module renders the parts that depend on the runtime adapter and
 * patches entry files.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

/** The CMS application inside @cossackframework/cms: the source of the feature's files. */
export const cmsAppDir = path.join(path.dirname(createRequire(import.meta.url).resolve('@cossackframework/cms/package.json')), 'app');
const manifest = JSON.parse(await fs.readFile(path.join(cmsAppDir, 'cossack-recipe.json'), 'utf8'));
const cmsDirectories = manifest.files.filter(entry => entry.endsWith('/'));
const cmsFiles = new Set(manifest.files.filter(entry => !entry.endsWith('/')));
/** Shared auth and dashboard modules the CMS store replaces; the scaffold's versions serve other recipes. */
const cmsReplaces = manifest.replaces;
/** Produced by {@link cmsRecipeFiles} for the runtime adapter; a copy in the CMS application is its own. */
const cmsRendered = new Set(manifest.rendered);

/** Files only the cms capability renders. */
export function isCmsPath(rel) {
  return cmsFiles.has(rel) || cmsDirectories.some(directory => rel.startsWith(directory));
}

/** The feature's files, as paths relative to the application root, read from the CMS package. */
export async function cmsAppFiles() {
  const files = [...cmsFiles, ...cmsReplaces];
  for (const directory of cmsDirectories) {
    const root = path.join(cmsAppDir, directory);
    const walk = async (dir, prefix) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const rel = `${prefix}${entry.name}`;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${rel}/`);
        else if (entry.isFile() && !cmsRendered.has(rel)) files.push(rel);
      }
    };
    await walk(root, directory);
  }
  return files.sort();
}

export function cmsRecipeFiles({ adapter }) {
  return {
    'src/cms/database.ts': adapter === 'cloudflare'
      ? `import type { RomeDBOptions } from '@cossackframework/romedb';

export interface DatabaseBindings {
    /**
     * RomeDB database URL. Workers reach RomeDB over HTTP: a RomeDB Cloud database, or
     * \`romedb serve\` in development (\`pnpm dev\` starts it for a loopback URL).
     */
    ROMEDB_URL?: string;
    /** Database grant (Cloud \`query\` scope) or the local service token. Server-only. */
    ROMEDB_TOKEN?: string;
}

/** How the CMS reaches its database. */
export function databaseConnection(env: DatabaseBindings): Pick<RomeDBOptions, 'url' | 'token' | 'connect'> {
    const url = env.ROMEDB_URL;
    const token = env.ROMEDB_TOKEN;
    if (!url || !token) throw new Error('The CMS needs ROMEDB_URL and ROMEDB_TOKEN: a RomeDB Cloud database, or a loopback URL that pnpm dev serves with romedb serve.');
    return { url, token };
}
`
      : `import type { RomeDBOptions } from '@cossackframework/romedb';
import { connectNode, isServiceUrl } from '@cossackframework/romedb/node';

export interface DatabaseBindings {
    /**
     * A file path opens the database in this process and creates it on first use (default
     * storage/romedb/app.romedb). A URL connects to \`romedb serve\` (\`pnpm dev\` starts it for a
     * loopback URL) or to a RomeDB Cloud database.
     */
    ROMEDB_URL?: string;
    /** Credential for a service or Cloud URL. Server-only. Files need none. */
    ROMEDB_TOKEN?: string;
}

/** How the CMS reaches its database. One process owns a file; share it through \`romedb serve\`. */
export function databaseConnection(env: DatabaseBindings): Pick<RomeDBOptions, 'url' | 'token' | 'connect'> {
    const url = env.ROMEDB_URL || 'storage/romedb/app.romedb';
    const token = env.ROMEDB_TOKEN || undefined;
    if (isServiceUrl(url) && !token) throw new Error(\`ROMEDB_TOKEN is required for \${url}. Use a file path in ROMEDB_URL to keep the database in this process.\`);
    return { url, ...(token ? { token } : {}), connect: () => connectNode({ url, ...(token ? { token } : {}) }) };
}
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

/** Writes are saved in a Durable Object before dispatch, so an unconfirmed write survives the isolate. */
export function pendingWrites(env: PendingBindings): PendingWriteStore {
    if (!env.ROMEDB_PENDING) throw new Error('Bind the ROMEDB_PENDING Durable Object (class RomeDBPendingWrites) in wrangler.jsonc.');
    return new DurableObjectPendingWriteStore(env.ROMEDB_PENDING);
}
`
      : `import { FilePendingWriteStore } from '@cossackframework/romedb/node';
import type { PendingWriteStore } from '@cossackframework/romedb';

export interface PendingBindings {
    /** Directory for unconfirmed writes. Default .cossack/romedb-pending. */
    ROMEDB_PENDING_DIR?: string;
}

/** Writes are saved as private files before dispatch, so an unconfirmed write survives a restart. */
export function pendingWrites(env: PendingBindings): PendingWriteStore {
    return new FilePendingWriteStore(env.ROMEDB_PENDING_DIR ?? '.cossack/romedb-pending');
}
`,
  };
}

/** Worker entry: export the pending-write Durable Object and run maintenance from cron. */
export function patchCmsWorkerEntry(source, { schedules }) {
  let patched = source.replace("import { template } from './root';", "import { template } from './root';\nimport { cmsFor } from './cms/index';\nimport { runMaintenance } from './cms/maintenance';\nimport { pluginRouteActive } from './cms/middleware';");
  patched = patched.replace('  htmlTemplate: template,\n', '  htmlTemplate: template,\n  // A rendered plugin\'s pages and handlers answer only while the plugin is active in the CMS.\n  isPluginActive: pluginRouteActive,\n');
  patched = patched.replace('export { SseDurableObject };', "export { SseDurableObject };\n// Unconfirmed RomeDB writes (ROMEDB_PENDING) survive isolate restarts here.\nexport { RomeDBPendingWrites } from '@cossackframework/romedb/cloudflare';");
  const maintenance = 'ctx.waitUntil(runMaintenance(cmsFor(env as never), { warm: true }));';
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
    .replace("import { template } from './root';", "import { template } from './root';\nimport { cmsFor } from './cms/index';\nimport { runMaintenance } from './cms/maintenance';\nimport { pluginRouteActive } from './cms/middleware';")
    // A rendered plugin's pages and handlers answer only while the plugin is active in the CMS.
    .replace('htmlTemplate: template, runtimeAdapter: runtime })', 'htmlTemplate: template, runtimeAdapter: runtime, isPluginActive: pluginRouteActive })')
    .replace('  runtime.attach(server, fetch);', `  runtime.attach(server, fetch);
  // Recover unconfirmed writes and deliver outbox events in the background.
  const maintenance = setInterval(() => {
    runMaintenance(cmsFor(env as never)).catch(error => console.error('[cms] maintenance failed', error));
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
    .replace("import { cossackSsg } from '@cossackframework/framework/vite-ssg-plugin';", `import { cossackSsg } from '@cossackframework/framework/vite-ssg-plugin';\nimport { cossackPluginPolicy } from 'cossack/plugin-policy';\nimport { ${cloudflare ? 'romedbDev, romedbDevVars' : 'romedbDev'} } from '@cossackframework/romedb/dev';`)
    .replace('  plugins: [\n', '  plugins: [\n    // Starts `romedb serve` in development when ROMEDB_URL is a loopback URL.\n    romedbDev(),\n')
    .replace('    cossackConfig(),', '    cossackConfig(),\n    // Rendered plugins must stay within their manifest; violations fail the build.\n    cossackPluginPolicy(),');
  if (cloudflare) {
    patched = patched.replace("      viteEnvironment: { name: 'ssr' },\n", "      viteEnvironment: { name: 'ssr' },\n      // The token of the local romedb serve that romedbDev started.\n      config: romedbDevVars,\n");
  } else {
    patched = patched.replace("            noExternal: [\n              'hono',", "            // RomeDB's native addon loads with Node, not through Vite.\n            external: ['@romedb/node'],\n            noExternal: [\n              'hono',");
  }
  return patched;
}

export function cmsSetupCode() {
  return [...crypto.getRandomValues(new Uint8Array(12))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
