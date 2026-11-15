import path from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { createS3StorageProvider } from '@cossackframework/framework/storage/s3';
import { LocalStorageProvider } from '@cossackframework/node-adapter/storage';
import { organizationDatabases } from '@cossackframework/romedb';
import { connectNode, fileDatabases, FilePendingWriteStore, isServiceUrl } from '@cossackframework/romedb/node';
import { publicOnlyFetch } from '../node';
import type { CmsStorage } from './index';

/** The environment values {@link nodeStorage} reads. */
export interface NodeStorageBindings {
    /**
     * A file path opens the database in this process and creates it on first use (default
     * storage/romedb/app.romedb). A URL connects to `romedb serve` (`pnpm dev` starts it for a
     * loopback URL) or to a RomeDB Cloud database.
     */
    ROMEDB_URL?: string;
    /** Credential for a service or Cloud URL. Server-only. Files need none. */
    ROMEDB_TOKEN?: string;
    /**
     * Where added sites keep their databases when ROMEDB_URL is a URL: a RomeDB Cloud organization
     * URL, or `romedb serve --directory`. With a file, each site is a file beside it.
     */
    ROMEDB_SITES_URL?: string;
    /** Organization key with the `manage` and `query` scopes, for ROMEDB_SITES_URL. Server-only. */
    ROMEDB_SITES_TOKEN?: string;
    /** Directory for unconfirmed writes. Default .cossack/romedb-pending. */
    ROMEDB_PENDING_DIR?: string;
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

const DEFAULT_DATABASE = 'storage/romedb/app.romedb';

/**
 * The CMS's storage on Node: a RomeDB file in this process or a service URL, unconfirmed
 * writes as private files, media in a local directory or S3, and resized images through sharp.
 */
export const nodeStorage: CmsStorage<NodeStorageBindings> = {
    /** One process owns a file; share it through `romedb serve`. */
    databaseConnection(env) {
        const url = env.ROMEDB_URL || DEFAULT_DATABASE;
        const token = env.ROMEDB_TOKEN || undefined;
        if (isServiceUrl(url) && !token) throw new Error(`ROMEDB_TOKEN is required for ${url}. Use a file path in ROMEDB_URL to keep the database in this process.`);
        return { url, ...(token ? { token } : {}), connect: () => connectNode({ url, ...(token ? { token } : {}) }) };
    },
    /**
     * A file beside the main one (storage/romedb/<database>.romedb), or a database of
     * ROMEDB_SITES_URL. Null when the main database is a URL and ROMEDB_SITES_URL is not set.
     */
    siteDatabase(env, database) {
        const sites = env.ROMEDB_SITES_URL;
        if (sites) {
            const token = env.ROMEDB_SITES_TOKEN;
            if (!token) throw new Error('ROMEDB_SITES_URL needs ROMEDB_SITES_TOKEN, an organization key with the manage and query scopes.');
            const url = `${sites.replace(/\/$/, '')}/databases/${database}`;
            return { url, token, connect: () => connectNode({ url, token }) };
        }
        const main = env.ROMEDB_URL || DEFAULT_DATABASE;
        if (isServiceUrl(main)) return null;
        const url = path.join(path.dirname(main), `${database}.romedb`);
        return { url, connect: () => connectNode({ url }) };
    },
    /** Files beside the main one, or under ROMEDB_SITES_URL. Null when neither applies. */
    siteDirectory(env) {
        if (env.ROMEDB_SITES_URL && env.ROMEDB_SITES_TOKEN) return organizationDatabases({ url: env.ROMEDB_SITES_URL, token: env.ROMEDB_SITES_TOKEN });
        const main = env.ROMEDB_URL || DEFAULT_DATABASE;
        return isServiceUrl(main) ? null : fileDatabases(path.dirname(main));
    },
    /**
     * Writes are saved as private files before dispatch, so an unconfirmed write survives a
     * restart. Each added site has its own folder (sites/<database>); the main site's are at the top.
     */
    pendingWrites(env, database = 'main') {
        const directory = env.ROMEDB_PENDING_DIR ?? '.cossack/romedb-pending';
        return new FilePendingWriteStore(database === 'main' ? directory : path.join(directory, 'sites', database));
    },
    /** Media bytes live in S3 when S3_BUCKET is set, otherwise in a local directory owned by this process. */
    mediaStorage(env) {
        if (!env.S3_BUCKET) return new LocalStorageProvider({ root: env.MEDIA_DIR || 'storage/media' });
        const client = new S3Client({
            region: env.S3_REGION || 'auto',
            // Presigned browser uploads need this: otherwise the SDK signs a checksum of an empty body.
            requestChecksumCalculation: 'WHEN_REQUIRED',
            ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
            ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY ? { credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } } : {}),
        });
        return createS3StorageProvider({ client, bucket: env.S3_BUCKET });
    },
    /** Resized variants, crops and modern formats through sharp, loaded on first use. */
    imageTransformer() {
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
    },
    /** Webhook deliveries refuse names that resolve to this machine or a private network. */
    webhookFetch: publicOnlyFetch,
};
