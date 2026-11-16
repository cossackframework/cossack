import type { StorageProvider } from '@cossackframework/core/storage';
import type { DatabaseDirectory, PendingWriteStore, RomeDBOptions } from '@cossackframework/romedb';
import type { ImageTransformer } from '../server/images';

/** How to reach one RomeDB database. */
export type DatabaseConnection = Pick<RomeDBOptions, 'url' | 'token' | 'connect'>;

/**
 * Where the CMS keeps its data on one runtime: the database, unconfirmed writes, media bytes
 * and resized images. A project names one in `src/cms.config.ts` (`cloudflareStorage` from
 * `@cossackframework/cms/storage/cloudflare`, `nodeStorage` from `@cossackframework/cms/storage/node`), and
 * replaces a member to keep something elsewhere: `{ ...nodeStorage, mediaStorage: env => ... }`.
 * `env` is the runtime's environment bindings.
 */
export interface CmsStorage<Env = never> {
    /** How the CMS reaches its database. */
    databaseConnection(env: Env): DatabaseConnection;
    /** How the CMS reaches an added site's database, or null while sites cannot have their own. */
    siteDatabase(env: Env, database: string): DatabaseConnection | null;
    /** Creates and deletes added sites' databases, or null when sites cannot have their own. */
    siteDirectory(env: Env): DatabaseDirectory | null;
    /** Where unconfirmed writes wait. `database` is `main` or an added site's database. */
    pendingWrites(env: Env, database?: string): PendingWriteStore;
    /** Where media bytes live. Without one, uploads are unavailable. */
    mediaStorage(env: Env): StorageProvider | undefined;
    /** Resized variants, crops and modern formats. Without one, images keep their size. */
    imageTransformer(env: Env): ImageTransformer | undefined;
    /** The `fetch` of webhook deliveries; unset uses the runtime's own. */
    readonly webhookFetch?: typeof fetch;
}
