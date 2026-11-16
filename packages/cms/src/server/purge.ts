/**
 * Purging the caches in front of the site. A change queues a `CachePurgeEvent` in the outbox
 * (topic `cache.purge`); the dispatcher runs the `cms.cache.purge` action, whose handlers are
 * the purgers: the Cloudflare one the application adds (`createCMS({ purgers })`) and any a
 * plugin registers for another CDN. A failed purge retries like a webhook; the last ones run
 * from this isolate show on Tools → Cache.
 */
import type { HookRegistry } from '@cossackframework/core/hooks';
import { cachePurge, type CachePurgeEvent } from '../hooks';
import { cacheTags } from '../cache';
import type { CmsCache } from './cache';
import type { Outbox } from './outbox';

export interface PurgeContext {
    /** The site's shared cache, for what a purger remembers between runs, such as a zone lookup. */
    readonly cache: CmsCache;
    readonly signal: AbortSignal;
}

/** Sends purges to one cache: Cloudflare, another CDN, a proxy. */
export interface CachePurger {
    readonly name: string;
    /** Throw to retry later (the outbox backs off); throw a `PurgeError` with `retry: false` to record the failure and stop. */
    purge(event: CachePurgeEvent, context: PurgeContext): Promise<void>;
}

/** A purge the cache refused; `retry` says whether trying again can help (a 429 or 5xx) or not (a bad token). */
export class PurgeError extends Error {
    readonly retry: boolean;
    readonly status: number | undefined;

    constructor(message: string, options: { retry: boolean; status?: number; cause?: unknown }) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = 'PurgeError';
        this.retry = options.retry;
        this.status = options.status;
    }
}

export interface PurgeRecord {
    readonly at: number;
    readonly eventId: string;
    readonly purger: string;
    readonly reason: string;
    readonly tags: readonly string[];
    readonly urls: readonly string[];
    readonly ok: boolean;
    /** What went wrong, and whether it retries. */
    readonly message: string;
}

export interface CmsPurgeOptions {
    readonly outbox: Outbox;
    readonly hooks: HookRegistry;
    readonly cache: CmsCache;
    /** The site's ID: `main`, or the registry ID. */
    readonly site: string;
    readonly purgers?: readonly CachePurger[];
    readonly now?: () => number;
    /** Called after an event is queued, so the request dispatches the outbox when it ends. */
    readonly queued?: () => void;
}

export class CmsPurge {
    readonly #outbox: Outbox;
    readonly #cache: CmsCache;
    readonly #site: string;
    readonly #now: () => number;
    readonly #queued: (() => void) | undefined;
    /** The purgers the application configured; plugins' handlers are not listed. */
    readonly purgers: readonly CachePurger[];
    /** The last purges run from this isolate, newest first. */
    readonly recent: PurgeRecord[] = [];
    /** The tags of this site's pages. */
    readonly tag: {
        readonly site: () => string;
        readonly collection: (collection: string) => string;
        readonly entry: (collection: string, id: string) => string;
        readonly term: (taxonomy: string, slug: string) => string;
    };

    constructor(options: CmsPurgeOptions) {
        this.#outbox = options.outbox;
        this.#cache = options.cache;
        this.#site = options.site;
        this.#now = options.now ?? Date.now;
        this.#queued = options.queued;
        this.purgers = options.purgers ?? [];
        const site = this.#site;
        this.tag = {
            site: () => cacheTags.site(site),
            collection: collection => cacheTags.collection(site, collection),
            entry: (collection, id) => cacheTags.entry(site, collection, id),
            term: (taxonomy, slug) => cacheTags.term(site, taxonomy, slug),
        };
        for (const purger of this.purgers) {
            options.hooks.addAction(cachePurge, async (event, context) => {
                try {
                    await purger.purge(event, { cache: this.#cache, signal: context.signal });
                    this.#record(purger, event, true, '');
                } catch (error) {
                    const retry = !(error instanceof PurgeError) || error.retry;
                    this.#record(purger, event, false, `${(error as Error).message || 'The purge failed.'}${retry ? ' Retrying.' : ''}`);
                    if (retry) throw error;
                }
            }, { plugin: `cms-purge-${purger.name}` });
        }
    }

    /** Whether purges reach a cache: a purger is configured, so pages may be held for long. */
    get configured(): boolean {
        return this.purgers.length > 0;
    }

    /**
     * Queue a purge: the tags and URLs given, or the whole site when neither is. Delivered after
     * this request by the outbox, with retries.
     */
    async queue(reason: string, input: { tags?: readonly string[]; urls?: readonly string[] } = {}): Promise<CachePurgeEvent> {
        const tags = [...new Set(input.tags ?? [])];
        const urls = [...new Set(input.urls ?? [])].filter(url => /^https?:\/\//.test(url)).slice(0, 500);
        const event: CachePurgeEvent = {
            eventId: crypto.randomUUID(), topic: 'cache.purge', at: this.#now(), site: this.#site, reason,
            tags: tags.length || urls.length ? tags : [this.tag.site()], urls,
        };
        await this.#outbox.enqueue('cache.purge', event);
        this.#queued?.();
        return event;
    }

    /** Queue a purge of every page of the site. */
    everything(reason: string): Promise<CachePurgeEvent> {
        return this.queue(reason);
    }

    #record(purger: CachePurger, event: CachePurgeEvent, ok: boolean, message: string): void {
        this.recent.unshift({ at: this.#now(), eventId: event.eventId, purger: purger.name, reason: event.reason, tags: event.tags, urls: event.urls, ok, message });
        this.recent.splice(20);
    }
}
