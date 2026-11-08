/**
 * What a plugin may do beyond its data: library files it owns, email as the site, jobs queued
 * for later (the clock's too, through the manifest's `schedules`), the site's members, a cache
 * namespace and the bindings it names. Each member checks the plugin's grant on every call and
 * throws `CMS_FORBIDDEN` when it is not held or `CMS_UNAVAILABLE` when the plugin is inactive
 * or the site lacks the service. See `specs/cms-plugin-capabilities.md`.
 */
import { CmsError } from '../errors';
import type { PluginJobEvent } from '../hooks';
import type { CmsPluginManifest } from '../manifest';
import { mediaUrl, type MediaKind } from '../media';
import { systemPrincipal, type Principal } from '../permissions';
import type { CmsCache } from './cache';
import type { CmsFile, FileMetadata, FileService } from './files';
import type { CmsMailer } from './mail';
import type { Outbox } from './outbox';
import type { CmsUser, CmsUsers } from './users';
import type { AiProvider, AiRequest } from './ai';
import type { Checkout, CheckoutInput, PaymentsProvider } from './payments';

export interface PluginFiles {
    /** Store a file the plugin owns in the media library; a stream needs its `size`. */
    upload(file: { name: string; contentType: string; size?: number; body: ReadableStream<Uint8Array> | Uint8Array | string } & FileMetadata): Promise<CmsFile>;
    /** Any library file. */
    get(id: string): Promise<CmsFile | null>;
    /** The plugin's own files. */
    list(options?: { kind?: MediaKind; search?: string; limit?: number; offset?: number }): Promise<{ items: CmsFile[]; total: number }>;
    /** Any library file's bytes. */
    open(id: string): Promise<{ file: CmsFile; body: ReadableStream<Uint8Array> } | null>;
    /** Title, alt, caption and description of one of the plugin's files. */
    update(id: string, patch: FileMetadata): Promise<CmsFile>;
    /** Delete one of the plugin's files. */
    delete(id: string): Promise<void>;
    /** The file's public address. */
    url(file: { readonly id: string; readonly name: string }): string;
}

export interface PluginMail {
    /** Send one email from the site's sender: the text, and the HTML the site's layout makes from it (Settings → Email). */
    send(message: { to: string; subject: string; text: string; replyTo?: string }): Promise<void>;
}

export interface PluginJobContext {
    /** The system principal `plugin:<name>`, for the plugin's repositories. */
    readonly principal: Principal;
    /** The occurrence a schedule queued, or null for a job the plugin queued. */
    readonly scheduledAt: number | null;
    readonly signal?: AbortSignal;
}
export type PluginJobHandler<P = unknown> = (payload: P, context: PluginJobContext) => unknown;

export interface PluginJobs {
    /** Name a handler at `register()`; the manifest's `schedules` run the handler of their name. */
    handle<P = unknown>(name: string, handler: PluginJobHandler<P>): void;
    /**
     * Queue a job for now, `at` a time or after `delayMs`. With a `key`, the same key queues once
     * and later calls return false. The payload is JSON up to 64 KB.
     */
    enqueue(name: string, payload?: unknown, options?: { at?: number; delayMs?: number; key?: string }): Promise<boolean>;
}

/** A member as a plugin sees it: no permissions, no account kind, only the plugin's own meta. */
export interface PluginUser {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly slug: string | null;
    readonly avatar: string | null;
    readonly status: 'active' | 'disabled';
    readonly roles: readonly string[];
    readonly createdAt: number;
    /** What the plugin stored with `setMeta`, or null. */
    readonly meta: unknown;
}

export interface PluginUsers {
    get(id: string): Promise<PluginUser | null>;
    findByEmail(email: string): Promise<PluginUser | null>;
    list(options?: { search?: string; role?: string; limit?: number; offset?: number }): Promise<{ items: PluginUser[]; total: number }>;
    /** Create a member. Roles must be assignable: every permission of theirs is the plugin's own (`<plugin>:…` or `<plugin>/…`), or they have none. */
    create(input: { email: string; name: string; password?: string; roles?: readonly string[] }): Promise<PluginUser>;
    /** Store a JSON value with the member under the plugin's own key; null removes it. */
    setMeta(id: string, value: unknown): Promise<boolean>;
}

export interface PluginCache {
    get<T = unknown>(key: string): Promise<T | undefined>;
    /** Store a value for `ttlMs` milliseconds, or until deleted. */
    set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
    delete(key: string): Promise<void>;
    remember<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T>;
}

export interface PluginAi {
    /** The application's model answers the prompt; `CMS_UNAVAILABLE` when the application has no provider. */
    complete(request: AiRequest): Promise<string>;
}

export interface PluginPayments {
    /** Start a checkout with the application's provider; the result arrives as a `cms.payment.event` action. */
    checkout(input: CheckoutInput): Promise<Checkout>;
    /** The provider's name, or null when the application has none. */
    readonly provider: string | null;
}

export interface PluginSecrets {
    /** The binding's value, or undefined when the application has none. The name must be in `permissions.secrets`. */
    get(name: string): Promise<string | undefined>;
}

export interface PluginCapabilities {
    readonly files: PluginFiles;
    readonly mail: PluginMail;
    readonly jobs: PluginJobs;
    readonly users: PluginUsers;
    readonly cache: PluginCache;
    readonly secrets: PluginSecrets;
    readonly ai: PluginAi;
    readonly payments: PluginPayments;
    /** Run the plugin's handler for one of its job events; throws so the outbox retries. */
    runJob(event: PluginJobEvent, context: { signal?: AbortSignal }): Promise<void>;
}

/** What the host lends the capabilities. */
export interface CapabilityHost {
    readonly name: string;
    readonly manifest: CmsPluginManifest;
    /** Throws unless the plugin is active and holds the grant. */
    allowed(grant: string, what: string): Promise<void>;
    /** An isolated plugin's job handlers, in its Worker: any job name is passed on to it. */
    readonly jobRunner?: (name: string, payload: unknown, context: PluginJobContext) => Promise<unknown>;
    readonly files: FileService | null;
    readonly mail: CmsMailer | null;
    readonly mailFrom: string;
    readonly users: CmsUsers;
    readonly cache: CmsCache;
    readonly outbox: Outbox;
    readonly secrets: (name: string) => string | undefined;
    readonly ai: AiProvider | null;
    readonly payments: PaymentsProvider | null;
    readonly now: () => number;
    /** An outbox row was added: dispatch after the request. */
    readonly queued: () => void;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const JOB_NAME = /^[a-z][a-z0-9-]{0,40}$/;
const JOB_KEY = /^[\x21-\x7e]{1,120}$/;
const CACHE_KEY = /^[\x21-\x7e]{1,150}$/;
const MAX_PAYLOAD = 64 * 1024;
const MAX_TEXT = 100 * 1024;
/** A job runs within a year. */
const MAX_DELAY = 366 * 24 * 60 * 60_000;

/** The user meta key a plugin's values live under: a system key (`_` and up to 40 characters). */
export function pluginMetaKey(plugin: string): string {
    const safe = plugin.replace(/-/g, '_');
    if (safe.length <= 37) return `_p_${safe}`;
    let hash = 0x811c9dc5;
    for (const char of plugin) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
    return `_p_${safe.slice(0, 28)}_${hash.toString(16).padStart(8, '0')}`;
}

export function pluginCapabilities(host: CapabilityHost): PluginCapabilities {
    const { name } = host;
    const owner = `plugin:${name}`;
    const principal = systemPrincipal(owner);
    const metaKey = pluginMetaKey(name);
    const handlers = new Map<string, PluginJobHandler>();

    const storage = (): FileService => {
        if (!host.files) throw new CmsError('CMS_UNAVAILABLE', 'The site has no file storage.');
        return host.files;
    };
    const own = async (id: string): Promise<CmsFile> => {
        const file = await storage().get(id);
        if (!file) throw new CmsError('CMS_NOT_FOUND', 'File not found.');
        if (file.owner !== owner) throw new CmsError('CMS_FORBIDDEN', `Plugin ${name} does not own this file.`);
        return file;
    };
    const files: PluginFiles = {
        upload: async file => {
            await host.allowed('capability:files', 'files');
            const service = storage();
            const { body, size: declared, ...metadata } = file;
            let stream: ReadableStream<Uint8Array>;
            let size: number;
            if (typeof body === 'string' || body instanceof Uint8Array) {
                const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body.slice();
                size = bytes.byteLength;
                stream = new Response(bytes.buffer as ArrayBuffer).body!;
            } else {
                if (!Number.isSafeInteger(declared) || (declared as number) < 0) throw new CmsError('CMS_VALIDATION', 'A streamed upload needs its size.');
                size = declared as number;
                stream = body;
            }
            return service.upload({ ...metadata, size, body: stream }, { principal, owner });
        },
        get: async id => { await host.allowed('capability:files', 'files'); return storage().get(id); },
        list: async (options = {}) => { await host.allowed('capability:files', 'files'); return storage().list({ ...options, owner }); },
        open: async id => { await host.allowed('capability:files', 'files'); return storage().open(id); },
        update: async (id, patch) => { await host.allowed('capability:files', 'files'); await own(id); return storage().update(id, patch, { principal }); },
        delete: async id => { await host.allowed('capability:files', 'files'); await own(id); await storage().delete(id, { principal }); },
        url: file => mediaUrl(file),
    };

    const mail: PluginMail = {
        send: async message => {
            await host.allowed('capability:mail', 'mail');
            if (!host.mail) throw new CmsError('CMS_UNAVAILABLE', 'The site cannot send email: no sender is configured.');
            if (typeof message?.to !== 'string' || message.to.length > 320 || !EMAIL.test(message.to)) throw new CmsError('CMS_VALIDATION', 'to must be one email address.');
            if (typeof message.subject !== 'string' || !message.subject.trim() || message.subject.length > 200) throw new CmsError('CMS_VALIDATION', 'subject is 1 to 200 characters.');
            if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > MAX_TEXT) throw new CmsError('CMS_VALIDATION', 'text is up to 100 KB.');
            if (message.replyTo !== undefined && (typeof message.replyTo !== 'string' || !EMAIL.test(message.replyTo))) throw new CmsError('CMS_VALIDATION', 'replyTo must be an email address.');
            await host.mail.send({ kind: 'plugin', plugin: host.name, to: message.to, from: host.mailFrom, subject: message.subject.trim(), text: message.text, ...(message.replyTo ? { replyTo: message.replyTo } : {}) });
        },
    };

    const jobs: PluginJobs = {
        handle: (jobName, handler) => {
            if (typeof jobName !== 'string' || !JOB_NAME.test(jobName)) throw new Error(`Plugin ${name} names job ${String(jobName)}; job names are lowercase letters, digits and hyphens.`);
            if (typeof handler !== 'function') throw new Error(`Plugin ${name} handles job ${jobName} without a function.`);
            if (handlers.has(jobName)) throw new Error(`Plugin ${name} handles job ${jobName} twice.`);
            handlers.set(jobName, handler as PluginJobHandler);
        },
        enqueue: async (jobName, payload = null, options = {}) => {
            await host.allowed('capability:jobs', 'jobs');
            // An isolated plugin checked its own handlers before asking.
            const known = typeof jobName === 'string' && (handlers.has(jobName) || (host.jobRunner !== undefined && JOB_NAME.test(jobName)));
            if (!known) throw new CmsError('CMS_NOT_FOUND', `Plugin ${name} has no handler for job ${String(jobName)}.`);
            const json = JSON.stringify(payload ?? null);
            if (json === undefined || json.length > MAX_PAYLOAD) throw new CmsError('CMS_LIMIT', 'A job payload is JSON up to 64 KB.');
            const now = host.now();
            let at = now;
            if (options.at !== undefined) {
                if (!Number.isFinite(options.at)) throw new CmsError('CMS_VALIDATION', 'at must be a time in milliseconds.');
                at = Math.max(now, Math.floor(options.at));
            } else if (options.delayMs !== undefined) {
                if (!Number.isFinite(options.delayMs) || options.delayMs < 0) throw new CmsError('CMS_VALIDATION', 'delayMs must be a non-negative number.');
                at = now + Math.floor(options.delayMs);
            }
            if (at - now > MAX_DELAY) throw new CmsError('CMS_VALIDATION', 'A job runs within a year.');
            if (options.key !== undefined && (typeof options.key !== 'string' || !JOB_KEY.test(options.key))) throw new CmsError('CMS_VALIDATION', 'A job key is 1-120 printable characters without spaces.');
            const eventId = `job:${name}:${jobName}:${options.key ?? crypto.randomUUID()}`;
            const event: PluginJobEvent = { eventId, topic: 'plugin.job', at: now, plugin: name, name: jobName, payload: JSON.parse(json) as unknown, scheduledAt: null, key: options.key ?? null };
            const queued = await host.outbox.enqueue('plugin.job', event, { availableAt: at, ignoreDuplicate: options.key !== undefined });
            if (queued) host.queued();
            return queued;
        },
    };

    const view = (user: CmsUser): PluginUser => Object.freeze({
        id: user.id, email: user.email, name: user.name, slug: user.slug, avatar: user.avatar, status: user.status, roles: Object.freeze([...user.roles]),
        createdAt: user.createdAt, meta: Object.hasOwn(user.meta, metaKey) ? structuredClone(user.meta[metaKey]) : null,
    });
    const assignable = async (): Promise<Set<string>> => {
        const roles = await host.users.roles({ limit: 100 });
        const own = (permission: string) => permission.startsWith(`${name}:`) || permission.startsWith(`${name}/`);
        return new Set(roles.filter(role => role.permissions.every(own)).map(role => role.id));
    };
    const users: PluginUsers = {
        get: async id => { await host.allowed('users:read', 'reading members'); const user = await host.users.get(id); return user ? view(user) : null; },
        findByEmail: async email => { await host.allowed('users:read', 'reading members'); const user = await host.users.findByEmail(email); return user ? view(user) : null; },
        list: async (options = {}) => {
            await host.allowed('users:read', 'reading members');
            const page = await host.users.list(options);
            return { items: page.items.map(view), total: page.total };
        },
        create: async input => {
            await host.allowed('users:write', 'creating members');
            const roles = [...new Set(input.roles ?? [])];
            if (roles.length) {
                const allowed = await assignable();
                for (const role of roles) if (!allowed.has(role)) throw new CmsError('CMS_FORBIDDEN', `Plugin ${name} may not assign the role ${role}.`);
            }
            return view(await host.users.create({ email: input.email, name: input.name, roles, ...(input.password !== undefined ? { password: input.password } : {}) }));
        },
        setMeta: async (id, value) => {
            await host.allowed('users:write', 'writing members');
            return host.users.setSystemMeta(id, metaKey, value === undefined ? null : value);
        },
    };

    const prefix = `plugin:${name}:`;
    const cacheKey = (key: string): string => {
        if (typeof key !== 'string' || !CACHE_KEY.test(key)) throw new CmsError('CMS_VALIDATION', 'Cache keys are 1-150 printable characters without spaces.');
        return prefix + key;
    };
    const cache: PluginCache = {
        get: async key => { await host.allowed('capability:cache', 'the cache'); return host.cache.get(cacheKey(key)); },
        set: async (key, value, ttlMs) => { await host.allowed('capability:cache', 'the cache'); await host.cache.set(cacheKey(key), value, ttlMs); },
        delete: async key => { await host.allowed('capability:cache', 'the cache'); await host.cache.delete(cacheKey(key)); },
        remember: async (key, ttlMs, compute) => { await host.allowed('capability:cache', 'the cache'); return (await host.cache.remember(cacheKey(key), ttlMs, compute)).value; },
    };

    const declaredSecrets = new Set(host.manifest.permissions?.secrets ?? []);
    const anySecret = host.manifest.permissions?.unrestricted === true;
    const secrets: PluginSecrets = {
        get: async secret => {
            if (typeof secret !== 'string' || (!anySecret && !declaredSecrets.has(secret))) throw new CmsError('CMS_FORBIDDEN', `Plugin ${name} does not declare the secret ${String(secret)}.`);
            await host.allowed(`secret:${secret}`, `the secret ${secret}`);
            return host.secrets(secret);
        },
    };

    const ai: PluginAi = {
        complete: async request => {
            await host.allowed('capability:ai', 'the AI provider');
            if (!host.ai) throw new CmsError('CMS_UNAVAILABLE', 'The application has no AI provider.');
            return host.ai.complete(request);
        },
    };
    const payments: PluginPayments = {
        get provider() { return host.payments?.name ?? null; },
        checkout: async input => {
            await host.allowed('capability:payments', 'payments');
            if (!host.payments) throw new CmsError('CMS_UNAVAILABLE', 'The application has no payments provider.');
            return host.payments.checkout(input);
        },
    };

    const runJob = async (event: PluginJobEvent, context: { signal?: AbortSignal }): Promise<void> => {
        // Inactive or revoked: the outbox retries and gives up in its own time.
        await host.allowed('capability:jobs', 'jobs');
        const runner = host.jobRunner;
        const handler = handlers.get(event.name) ?? (runner ? ((payload: unknown, context: PluginJobContext) => runner(event.name, payload, context)) : undefined);
        if (!handler) throw new CmsError('CMS_NOT_FOUND', `Plugin ${name} has no handler for job ${event.name}.`);
        await handler(event.payload, { principal, scheduledAt: event.scheduledAt, ...(context.signal ? { signal: context.signal } : {}) });
    };

    return Object.freeze({ files, mail, jobs, users, cache, secrets, ai, payments, runJob });
}
