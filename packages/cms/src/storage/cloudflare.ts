import { createR2StorageProvider, type R2StorageBucket } from '@cossackframework/framework/storage/r2';
import { organizationDatabases } from '@cossackframework/romedb';
import { DurableObjectPendingWriteStore, type DurableObjectNamespaceLike } from '@cossackframework/romedb/cloudflare';
import type { CmsStorage } from './index';

/** The part of the Cloudflare Images binding the CMS uses. */
interface ImagesBinding {
    input(stream: ReadableStream<Uint8Array>): ImagesChain;
}
interface ImagesChain {
    transform(options: Record<string, unknown>): ImagesChain;
    output(options: { format: string; quality?: number }): Promise<{ response(): Response }>;
}

/** The bindings {@link cloudflareStorage} reads. */
export interface CloudflareStorageBindings {
    /**
     * RomeDB database URL. Workers reach RomeDB over HTTP: a RomeDB Cloud database, or
     * `romedb serve` in development (`pnpm dev` starts it for a loopback URL).
     */
    ROMEDB_URL?: string;
    /** Database grant (Cloud `query` scope) or the local service token. Server-only. */
    ROMEDB_TOKEN?: string;
    /** Where added sites keep their databases: a RomeDB Cloud organization URL, or `romedb serve --directory`. */
    ROMEDB_SITES_URL?: string;
    /** Organization key with the `manage` and `query` scopes, for ROMEDB_SITES_URL. Server-only. */
    ROMEDB_SITES_TOKEN?: string;
    /** Durable Object namespace for RomeDBPendingWrites (exported from src/index.ts). */
    ROMEDB_PENDING?: DurableObjectNamespaceLike;
    /** R2 bucket for uploaded media (r2_buckets in wrangler.jsonc). */
    MEDIA?: R2StorageBucket;
    /** Cloudflare Images (images in wrangler.jsonc): resized variants, crops and modern formats. */
    IMAGES?: ImagesBinding;
}

/**
 * The CMS's storage on Cloudflare Workers: RomeDB over HTTP, unconfirmed writes in a Durable
 * Object, media in R2 and resized images through the Images binding.
 */
export const cloudflareStorage: CmsStorage<CloudflareStorageBindings> = {
    databaseConnection(env) {
        const url = env.ROMEDB_URL;
        const token = env.ROMEDB_TOKEN;
        if (!url || !token) throw new Error('The CMS needs ROMEDB_URL and ROMEDB_TOKEN: a RomeDB Cloud database, or a loopback URL that pnpm dev serves with romedb serve.');
        return { url, token };
    },
    /** Null while sites cannot have their own database (no ROMEDB_SITES_URL). */
    siteDatabase(env, database) {
        const sites = env.ROMEDB_SITES_URL;
        if (!sites) return null;
        if (!env.ROMEDB_SITES_TOKEN) throw new Error('ROMEDB_SITES_URL needs ROMEDB_SITES_TOKEN, an organization key with the manage and query scopes.');
        return { url: `${sites.replace(/\/$/, '')}/databases/${database}`, token: env.ROMEDB_SITES_TOKEN };
    },
    siteDirectory(env) {
        return env.ROMEDB_SITES_URL && env.ROMEDB_SITES_TOKEN ? organizationDatabases({ url: env.ROMEDB_SITES_URL, token: env.ROMEDB_SITES_TOKEN }) : null;
    },
    /**
     * Writes are saved in a Durable Object before dispatch, so an unconfirmed write survives the
     * isolate. Each database has its own objects; the main site's keep their name.
     */
    pendingWrites(env, database = 'main') {
        if (!env.ROMEDB_PENDING) throw new Error('Bind the ROMEDB_PENDING Durable Object (class RomeDBPendingWrites) in wrangler.jsonc.');
        return new DurableObjectPendingWriteStore(env.ROMEDB_PENDING, database === 'main' ? {} : { name: `romedb:${database}` });
    },
    /** Media bytes live in R2. Without the binding, uploads are unavailable. */
    mediaStorage(env) {
        return env.MEDIA ? createR2StorageProvider(env.MEDIA) : undefined;
    },
    /**
     * Resized images through the Images binding. Local development runs a low-fidelity version
     * without crops; variants then keep the whole image.
     */
    imageTransformer(env) {
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
                    const output = await chain.output({ format: `image/${request.format}`, quality: request.quality });
                    return new Uint8Array(await output.response().arrayBuffer());
                };
                if (whole) return run(false);
                try { return await run(true); } catch { return run(false); }
            },
        };
    },
    // Webhook deliveries use the Worker's own fetch, which cannot reach private networks.
    // A request's subrequests are cancelled with it, so the CMS ends its database calls itself.
    cancelsRequestIo: true,
};
