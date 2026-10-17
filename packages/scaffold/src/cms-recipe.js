/**
 * The cms feature: the FastDB CMS host, its dashboard screens under /dashboard, first-run
 * setup, the public site and its default theme (src/plugins/default-theme). It requires auth and dashboard, whose storage modules come from
 * template/cms-store. Static files live under template/src/{cms,pages/dashboard/(cms),pages/(site)};
 * this module renders the parts that depend on the runtime adapter and patches entry files.
 */

/** Files owned by the cms capability. */
export function isCmsPath(rel) {
  return rel.startsWith('src/cms/') || rel.startsWith('src/pages/dashboard/(cms)/') || rel.startsWith('src/pages/(site)/')
    || rel.startsWith('src/pages/auth/setup/') || rel.startsWith('src/pages/api/cms/') || rel.startsWith('src/pages/api/auth/') || rel === 'src/config/cms.ts'
    // The default theme is a plugin rendered as application source.
    || rel.startsWith('src/plugins/default-theme/');
}

export function cmsRecipeFiles({ adapter }) {
  return {
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
      ? `import { DurableObjectPendingWriteStore, type DurableObjectNamespaceLike } from '@cossackframework/fastdb/cloudflare';
import type { PendingWriteStore } from '@cossackframework/fastdb';

export interface PendingBindings {
    /** Durable Object namespace for FastDBPendingWrites (exported from src/index.ts). */
    FASTDB_PENDING?: DurableObjectNamespaceLike;
}

/** Writes are saved in a Durable Object before dispatch, so an unconfirmed write survives the isolate. */
export function pendingWrites(env: PendingBindings): PendingWriteStore {
    if (!env.FASTDB_PENDING) throw new Error('Bind the FASTDB_PENDING Durable Object (class FastDBPendingWrites) in wrangler.jsonc.');
    return new DurableObjectPendingWriteStore(env.FASTDB_PENDING);
}
`
      : `import { FilePendingWriteStore } from '@cossackframework/fastdb/node';
import type { PendingWriteStore } from '@cossackframework/fastdb';

export interface PendingBindings {
    /** Directory for unconfirmed writes. Default .cossack/fastdb-pending. */
    FASTDB_PENDING_DIR?: string;
}

/** Writes are saved as private files before dispatch, so an unconfirmed write survives a restart. */
export function pendingWrites(env: PendingBindings): PendingWriteStore {
    return new FilePendingWriteStore(env.FASTDB_PENDING_DIR ?? '.cossack/fastdb-pending');
}
`,
  };
}

/** Worker entry: export the pending-write Durable Object and run maintenance from cron. */
export function patchCmsWorkerEntry(source, { schedules }) {
  let patched = source.replace("import { template } from './root';", "import { template } from './root';\nimport { cmsFor } from './cms/index';\nimport { runMaintenance } from './cms/maintenance';");
  patched = patched.replace('export { SseDurableObject };', "export { SseDurableObject };\n// Unconfirmed FastDB writes (FASTDB_PENDING) survive isolate restarts here.\nexport { FastDBPendingWrites } from '@cossackframework/fastdb/cloudflare';");
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
    .replace("import { template } from './root';", "import { template } from './root';\nimport { cmsFor } from './cms/index';\nimport { runMaintenance } from './cms/maintenance';")
    .replace('  runtime.attach(server, fetch);', `  runtime.attach(server, fetch);
  // Recover unconfirmed writes and deliver outbox events in the background.
  const maintenance = setInterval(() => {
    runMaintenance(cmsFor(env as never)).catch(error => console.error('[cms] maintenance failed', error));
  }, 60_000);
  maintenance.unref();`);
}

/** Vite: plugin policy lints fail builds (raw FastQL, undeclared network, permissions or hooks). */
export function patchCmsViteConfig(source) {
  return source
    .replace("import { cossackSsg } from '@cossackframework/framework/vite-ssg-plugin';", "import { cossackSsg } from '@cossackframework/framework/vite-ssg-plugin';\nimport { cossackPluginPolicy } from 'cossack/plugin-policy';")
    .replace('    cossackConfig(),', '    cossackConfig(),\n    // Rendered plugins must stay within their manifest; violations fail the build.\n    cossackPluginPolicy(),');
}

export function cmsSetupCode() {
  return [...crypto.getRandomValues(new Uint8Array(12))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
