/**
 * IndexNow: tell Bing, Yandex, Naver and Seznam at once that pages changed, so their indexes
 * (and the answers built on them, such as Copilot) refresh in minutes. Pings run from the
 * outbox after a commit, so a failed one retries. Settings → IndexNow holds the key, which
 * the site serves at `/indexnow/<key>.txt`.
 */
import type { CmsSettings } from './site-settings';
import type { ResourceEvent } from '../hooks';
import type { CollectionDefinition } from '../collections';
import { systemPrincipal } from '../permissions';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
/** A key is 8 to 128 of a-z, A-Z, 0-9 and hyphens. */
export const INDEXNOW_KEY = /^[A-Za-z0-9-]{8,128}$/;

export interface IndexNowOptions {
    /** The public origin of the site, such as `https://example.com`; pings need it. */
    readonly siteUrl?: () => string | undefined;
    readonly fetch?: typeof globalThis.fetch;
    readonly now?: () => number;
    readonly endpoint?: string;
}

export class CmsIndexNow {
    readonly #settings: CmsSettings;
    readonly #siteUrl: () => string | undefined;
    readonly #fetch: typeof globalThis.fetch;
    readonly #endpoint: string;
    /** The last submissions made from this isolate, newest first, for the dashboard. */
    readonly recent: { at: number; urls: string[]; status: number }[] = [];
    readonly #now: () => number;

    constructor(settings: CmsSettings, options: IndexNowOptions = {}) {
        this.#settings = settings;
        this.#siteUrl = options.siteUrl ?? (() => undefined);
        this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
        this.#endpoint = options.endpoint ?? INDEXNOW_ENDPOINT;
        this.#now = options.now ?? Date.now;
    }

    /** The site's origin without a trailing slash, or null when unknown. */
    origin(): string | null {
        const url = this.#siteUrl()?.trim().replace(/\/+$/, '');
        return url && /^https?:\/\/[^/\s]+$/.test(url) ? url : null;
    }

    /** The key, made and stored the first time pings are on. Null while IndexNow is off. */
    async key(): Promise<string | null> {
        const settings = await this.#settings.all();
        if (!settings['indexnow.enabled']) return null;
        const stored = settings['indexnow.key'];
        if (INDEXNOW_KEY.test(stored)) return stored;
        const key = crypto.randomUUID().replaceAll('-', '');
        await this.#settings.update('indexnow', { key }, { principal: systemPrincipal('indexnow') });
        return key;
    }

    /** Where the key file is served. */
    keyLocation(origin: string, key: string): string {
        return `${origin}/indexnow/${key}.txt`;
    }

    /** Submit absolute or site-relative URLs. Throws on a failed request, so the outbox retries. Returns the response status, or null when off. */
    async submit(urls: readonly string[]): Promise<number | null> {
        const key = await this.key();
        const origin = this.origin();
        if (!key || !origin || !urls.length) return null;
        const list = [...new Set(urls.map(url => /^https?:\/\//.test(url) ? url : `${origin}${url}`))].filter(url => url.startsWith(`${origin}/`) || url === origin).slice(0, 10_000);
        if (!list.length) return null;
        const response = await this.#fetch(this.#endpoint, {
            method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ host: new URL(origin).host, key, keyLocation: this.keyLocation(origin, key), urlList: list }),
        });
        this.recent.unshift({ at: this.#now(), urls: list, status: response.status });
        this.recent.splice(20);
        // 200 and 202 accept the URLs; 4xx mean the key or URLs are wrong and retrying will not help.
        if (response.status >= 500 || response.status === 429) throw new Error(`IndexNow answered ${response.status}.`);
        return response.status;
    }

    /**
     * Whether an entry event changed a public page: the entry is or was published, in a
     * collection on the site that engines may index. Drafts and private collections ping nothing.
     */
    static concerns(event: ResourceEvent, collection: CollectionDefinition): boolean {
        if (collection.path === null || collection.path === undefined || collection.robots?.noindex || !event.record) return false;
        const publishable = collection.publishable !== false;
        if (!publishable) return collection.visibility === 'public';
        return event.previousStatus === 'published' || event.record.status === 'published';
    }
}
