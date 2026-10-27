/**
 * The CMS host: resource registry, repositories, plugin hooks and commands, schema and
 * grant activation, outbox, users and stores, all over one RomeDB binding.
 */
import { createHookRegistry, type ActionHandler, type ActionPoint, type FilterHandler, type FilterPoint, type HookRegistry } from '@cossackframework/core/hooks';
import type { StorageProvider } from '@cossackframework/core/storage';
import { ClientError, type RomeDB, type Statement, type Value, type WorkLimits } from '@cossackframework/romedb';
import { blockId, blockMedia, blockProblems, validateBlocks, type Block, type BlockDeclaration } from '../blocks';
import { blocksShapeProblem, type FieldDeclaration } from '../fields';
import { collectionProblems, collectionResource, CORE_FIELDS, entryUrl, extendCollection, LOCALE, orderedFields, type CollectionDefinition } from '../collections';
import { derivedFields, fieldGroupDeclarations, fieldGroupProblems, fieldVisibility, flattenGroupFields, metaProblems, sameTarget, type FieldGroup, type FieldGroupTarget } from '../field-groups';
import { CmsFieldGroups } from './field-groups';
import { CmsError } from '../errors';
import type { CmsModule } from '../module';
import { appearance, general, media, type SettingsGroup } from '../settings';
import { assembleSiteTheme, entryTemplateChoices, layerPresets, siteThemeProblems, type ArchiveView, type SiteTheme, type EntryView, type SiteView, type ThemeData, type ThemeManifest, type ThemePresets } from '../theme';
import type { MenuItem, MenuItemView } from '../menus';
import { recordTitle } from '../forms';
import type { RecordShape } from '../records';
import { taxonomyProblems, type TaxonomyDeclaration } from '../taxonomy';
import { manifestProblems, requestedGrants, type CmsPluginManifest, type PluginCommand, type SlotLink } from '../manifest';
import { ANONYMOUS, evaluateRule, hasPermission, PERMISSIONS, principalId, systemPrincipal, userPrincipal, type Principal } from '../permissions';
import { AVATAR_TYPES, mediaUrl } from '../media';
import { canonicalJson, declarationHash, resolveResource, type Resource, type ResourceAction, type ResourceDeclaration } from '../resource';
import { Outbox, type OutboxOptions } from './outbox';
import { ResourceRepository, type FieldFilter, type ListOptions, type OperationContext } from './repository';
import { migrate, planSchema, readCatalog, type MigrationReport, type SchemaPlan } from './schema';
import { FileService, type FileServiceOptions } from './files';
import { HOST_STEPS, HOST_TABLES } from './host-schema';
import { CmsSettings } from './site-settings';
import { createAuthSessionStore, createJobStore, createNotificationStore, createOAuthStateStore, createSessionStore } from './stores';
import { CmsMenus } from './menus';
import { CmsAreas } from './areas';
import { CmsTaxonomies } from './taxonomies';
import { CmsUsers } from './users';
import { CmsPreviews, type PreviewLink } from './previews';
import { CmsAutosaves, type Autosave } from './autosaves';
import { CmsRedirects } from './redirects';
import { CmsApiTokens, type ApiTokenScope } from './api-tokens';
import { CmsWebhooks } from './webhooks';
import type { WebhookEvent } from '../webhooks';
import { afterCommit, commentBeforeSave, formSubmitted, menuBeforeSave, termBeforeSave, type FormSubmittedEvent, type ResourceEvent, type WriteActor } from '../hooks';
import { CmsForms, type CmsMail } from './forms';
import { CmsComments } from './comments';
import { CmsSecurity } from './security';
import type { ImageTransformer } from './images';
import { checkComment, COMMENT_STATUSES, type CommentShape, type CommentStatus } from '../comments';
import { sha256Hex } from './tokens';
import type { SiteSettings } from '../settings';

/** Structural plugin registration, as `@cossackframework/framework/plugins` provides it. */
export interface PluginRegistrationLike {
    readonly name: string;
    readonly version: string;
    readonly manifest?: { readonly [field: string]: unknown };
    readonly module?: { readonly [name: string]: unknown } | null;
    readonly ui?: { readonly [name: string]: unknown } | null;
    /** The plugin's `templates/*.ts` modules by file stem; a theme's templates. */
    readonly templates?: { readonly [stem: string]: { readonly [name: string]: unknown } };
    /** URLs of the plugin's images by path, such as `assets/logo.png`. */
    readonly assets?: { readonly [path: string]: string };
}

export type { CmsModule };

export interface CmsOptions {
    readonly db: RomeDB;
    /** Application resources; owner defaults to `app`. */
    readonly resources?: readonly ResourceDeclaration[];
    readonly modules?: readonly CmsModule[];
    /** Rendered plugins from the static registry. */
    readonly plugins?: readonly PluginRegistrationLike[];
    readonly hooks?: HookRegistry;
    readonly now?: () => number;
    readonly workLimits?: { readonly read?: WorkLimits; readonly write?: WorkLimits };
    /** How long schema and grant activation stays cached. Default 30 seconds. */
    readonly activationTtlMs?: number;
    readonly outbox?: OutboxOptions;
    /** Network access for plugins, checked against granted hosts. Default `globalThis.fetch`. */
    readonly fetch?: typeof globalThis.fetch;
    /** Object storage for media: R2 on Workers, S3 or a local directory on Node. Without it, `files` is null. */
    readonly storage?: StorageProvider;
    readonly files?: FileServiceOptions;
    /** Makes resized image variants: the Images binding on Workers, sharp on Node. */
    readonly images?: ImageTransformer;
    /** Taxonomies beyond those of the modules. */
    readonly taxonomies?: readonly TaxonomyDeclaration[];
    /** Block types beyond those of the modules and plugins. */
    readonly blocks?: readonly BlockDeclaration[];
    /** Settings groups beyond General, Media and those of the modules. */
    readonly settings?: readonly SettingsGroup[];
    /**
     * First path segments the application routes itself, which entries at the site root
     * cannot take as slugs. Default: api, auth, dashboard, feed, media, preview and search.
     */
    readonly reservedPaths?: readonly string[];
    /** How long a theme loader may run before the page renders without its data. Default 1500 ms. */
    readonly themeLoaderTimeoutMs?: number;
    /** The largest JSON a theme loader may return, in characters. Default 65536. */
    readonly themeDataLimit?: number;
    /** Sends form notification emails. Without it they are skipped. */
    readonly mail?: CmsMail;
    /** The sender of form notification emails. Default `no-reply@example.com`. */
    readonly mailFrom?: string;
}

/** The site's languages: the default one without a URL prefix, the others under `/<code>/`. */
export interface SiteLanguages {
    readonly default: string;
    readonly others: readonly string[];
    readonly all: readonly string[];
    /** More than one language. */
    readonly multilingual: boolean;
}

/** A theme from a rendered plugin. */
export interface ThemeInfo {
    /** The plugin's name. */
    readonly name: string;
    readonly version: string;
    readonly label: string;
    readonly description: string;
    /** From the plugin's manifest; empty when it names none. */
    readonly author: string;
    readonly authorUrl: string;
    readonly locations: readonly { readonly name: string; readonly label: string }[];
    /** Its widget areas, its parent's first. */
    readonly areas: readonly { readonly name: string; readonly label: string }[];
    /** The theme it extends, or null. */
    readonly parent: string | null;
    /** Image URLs from the plugin's assets, or null for the default artwork. */
    readonly logo: string | null;
    readonly cover: string | null;
    /** The settings group of its options (its parent's and its own), named after the plugin, or null. */
    readonly options: SettingsGroup | null;
    /** Its presets over its parent's, slug by slug; `resolvePresets` adds the defaults and the site's changes. */
    readonly presets: ThemePresets;
    /** Why the theme cannot be used; empty when it can. */
    readonly problems: readonly string[];
}

export interface CommandContext {
    readonly principal: Principal;
    readonly signal?: AbortSignal;
}

export type CommandHandler = (input: { readonly [name: string]: string | number | boolean }, context: CommandContext) => unknown | Promise<unknown>;

/** What a plugin's `server.ts` `register()` receives. Everything is limited to the manifest and its grant. */
export interface PluginContext {
    readonly name: string;
    readonly version: string;
    /** Resource IDs the plugin declares. */
    readonly resources: readonly string[];
    readonly hooks: {
        addAction<P>(point: ActionPoint<P>, handler: ActionHandler<P>, options?: { priority?: number }): void;
        addFilter<V, I>(point: FilterPoint<V, I>, handler: FilterHandler<V, I>, options?: { priority?: number }): void;
    };
    /** Handlers for the manifest's commands: `cossack <plugin>:<command>`. */
    readonly commands: { add(name: string, handler: CommandHandler): void };
    /** Data access limited to the plugin's own resources and its granted ones. */
    readonly cms: PluginCms;
    /** `fetch` limited to the manifest's granted network hosts. */
    readonly fetch: typeof globalThis.fetch;
}

export interface PluginCms {
    resource(id: string): PluginResource;
}

/** What a theme loader receives besides the view. Reads go through the plugin's grants as the visitor. */
export interface ThemeLoaderContext {
    /** The theme plugin's repositories: its own resources and its granted ones. */
    readonly cms: PluginCms;
    /** The visitor; pass it to every read, such as `cms.resource(id).list(query, { principal })`. */
    readonly principal: Principal;
    /** Aborts when the loader runs out of time. */
    readonly signal: AbortSignal;
    /** The active theme's option values. */
    readonly options: { readonly [name: string]: unknown };
    /** The page's language. */
    readonly locale: string;
    /** The loader's key, such as `entry-projects`. */
    readonly template: string;
}

/**
 * A theme loader, exported from the theme's `server.ts` as `loaders[<template>]`. `layout`
 * receives the `SiteView`; entry loaders the `EntryView`; list loaders the `ArchiveView`. It
 * returns plain JSON, which templates read as `helpers.data`.
 */
export type ThemeLoader = { bivarianceHack(view: SiteView | EntryView | ArchiveView, context: ThemeLoaderContext): unknown }['bivarianceHack'];
export type ThemeLoaders = { readonly [template: string]: ThemeLoader };

export type PluginResource = Pick<ResourceRepository, 'get' | 'list' | 'search' | 'create' | 'update' | 'delete'>;

export interface PluginStatus {
    readonly name: string;
    readonly version: string;
    readonly description: string;
    /** From the manifest; empty when it names none. */
    readonly author: string;
    readonly authorUrl: string;
    /** Image URLs from the plugin's assets, or null for the default artwork. */
    readonly logo: string | null;
    readonly cover: string | null;
    /** Only a theme: nothing to grant, managed under Appearance. */
    readonly themeOnly: boolean;
    readonly active: boolean;
    readonly reason?: string;
    /** Grants the manifest requests that are not granted yet. */
    readonly missing: readonly string[];
}

export interface ActivationStatus {
    readonly resources: { readonly id: string; readonly active: boolean }[];
    readonly plugins: readonly PluginStatus[];
}

interface HostedPlugin {
    readonly registration: PluginRegistrationLike;
    readonly manifest: CmsPluginManifest;
    readonly problems: readonly string[];
    readonly resources: readonly string[];
    readonly requested: readonly string[];
    readonly commands: Map<string, CommandHandler>;
}

interface Activation {
    readonly hashes: ReadonlyMap<string, string>;
    readonly grants: ReadonlyMap<string, ReadonlySet<string>>;
    /** Host schema versions in the ledger; empty before setup. */
    readonly hostVersions: ReadonlySet<number>;
}

/** Every plugin needs this grant; disabling a plugin removes it with the others. */
export const PLUGIN_ENABLED = 'plugin:enabled';

export class CmsHost {
    readonly db: RomeDB;
    readonly hooks: HookRegistry;
    readonly users: CmsUsers;
    readonly outbox: Outbox;
    readonly authSessions: ReturnType<typeof createAuthSessionStore>;
    readonly oauthStates: ReturnType<typeof createOAuthStateStore>;
    readonly sessions: ReturnType<typeof createSessionStore>;
    readonly taxonomies: CmsTaxonomies;
    readonly settings: CmsSettings;
    readonly menus: CmsMenus;
    /** Widget areas of themes: block lists edited under Appearance → Widgets. */
    readonly areas: CmsAreas;
    /** Field groups: meta boxes attached to collections, taxonomies, users and menu items. */
    readonly fieldGroups: CmsFieldGroups;
    readonly previews: CmsPreviews;
    readonly autosaves: CmsAutosaves;
    readonly redirects: CmsRedirects;
    readonly apiTokens: CmsApiTokens;
    readonly webhooks: CmsWebhooks;
    readonly comments: CmsComments;
    /** Forms' submissions: taking them, notifications, and handling them in the dashboard. */
    readonly forms: CmsForms;
    /** Second factors and passkeys of users. */
    readonly security: CmsSecurity;
    /** Media files, when the host has object storage. */
    readonly files: FileService | null;
    readonly readLimits: WorkLimits;
    readonly writeLimits: WorkLimits;
    /** Increments on every committed mutation, so request middleware can schedule delivery. */
    outboxWrites = 0;
    /** Code-declared resources: modules, the application and plugins. */
    readonly #static = new Map<string, Resource>();
    /** Static resources and the current collections. */
    #resources = new Map<string, Resource>();
    readonly #repositories = new Map<string, ResourceRepository>();
    readonly #plugins = new Map<string, HostedPlugin>();
    readonly #builtinCollections = new Map<string, CollectionDefinition>();
    readonly #builtinTaxonomies = new Map<string, TaxonomyDeclaration>();
    #collections = new Map<string, CollectionDefinition>();
    /** Stored field groups, as last loaded; `#apply` merges their fields into the targets. */
    #groups: readonly FieldGroup[] = [];
    #taxonomies = new Map<string, TaxonomyDeclaration>();
    readonly #blocks = new Map<string, BlockDeclaration & { readonly plugin?: string }>();
    readonly #themes = new Map<string, ThemeInfo>();
    /** Plugins that are active, as of the last `ready()` or grant: their collections are on the site. */
    #activePlugins = new Set<string>();
    readonly #reservedPaths: ReadonlySet<string>;
    readonly #now: () => number;
    readonly #activationTtl: number;
    readonly #fetch: typeof globalThis.fetch;
    readonly #loaderTimeout: number;
    readonly #dataLimit: number;
    #activation: { at: number; state: Promise<Activation> } | undefined;
    #definitions: { at: number; state: Promise<void> } | undefined;
    #upgrading: Promise<void> | undefined;
    #installed = false;

    constructor(options: CmsOptions) {
        this.db = options.db;
        this.hooks = options.hooks ?? createHookRegistry();
        this.#now = options.now ?? Date.now;
        this.#activationTtl = options.activationTtlMs ?? 30_000;
        this.#reservedPaths = new Set(options.reservedPaths ?? ['api', 'auth', 'dashboard', 'feed', 'media', 'preview', 'search']);
        this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
        this.#loaderTimeout = options.themeLoaderTimeoutMs ?? 1500;
        this.#dataLimit = options.themeDataLimit ?? 65_536;
        this.readLimits = { rowsRead: 50_000, vmSteps: 2_000_000, ...options.workLimits?.read };
        this.writeLimits = { rowsRead: 50_000, rowMutations: 1_000, vmSteps: 2_000_000, ...options.workLimits?.write };
        const modules = options.modules ?? [];
        for (const module of modules) for (const declaration of module.resources) this.#register(resolveResource(declaration, module.owner));
        for (const declaration of options.resources ?? []) this.#register(resolveResource(declaration, declaration.owner ?? 'app'));
        for (const registration of options.plugins ?? []) this.#host(registration);
        for (const taxonomy of [...modules.flatMap(module => module.taxonomies ?? []), ...(options.taxonomies ?? [])]) {
            const problems = taxonomyProblems(taxonomy);
            if (problems.length || this.#builtinTaxonomies.has(taxonomy.name)) throw new Error(`Taxonomy ${taxonomy.name}: ${problems.join(' ') || 'declared twice.'}`);
            this.#builtinTaxonomies.set(taxonomy.name, Object.freeze({ ...taxonomy, builtin: true }));
        }
        for (const definition of modules.flatMap(module => module.collections ?? [])) {
            const problems = collectionProblems(definition);
            if (problems.length || this.#builtinCollections.has(definition.name)) throw new Error(`Collection ${definition.name}: ${problems.join(' ') || 'declared twice.'}`);
            this.#builtinCollections.set(definition.name, Object.freeze({ ...definition, builtin: true }));
        }
        // Plugin collections are built in, tagged with the plugin; a name another declares makes the plugin invalid.
        for (const plugin of [...this.#plugins.values()]) {
            if (plugin.problems.length) continue;
            const taken = (plugin.manifest.collections ?? []).filter(definition => this.#builtinCollections.has(definition.name)).map(definition => `Collection ${definition.name} is already declared.`);
            if (taken.length) { this.#plugins.set(plugin.manifest.name, { ...plugin, problems: taken, requested: [] }); continue; }
            for (const definition of plugin.manifest.collections ?? []) this.#builtinCollections.set(definition.name, Object.freeze({ ...definition, builtin: true, plugin: plugin.manifest.name }));
        }
        const blocks = [...modules.flatMap(module => (module.blocks ?? []).map(block => ({ block, owner: undefined as string | undefined }))), ...(options.blocks ?? []).map(block => ({ block, owner: undefined }))];
        for (const plugin of this.#plugins.values()) if (!plugin.problems.length) blocks.push(...(plugin.manifest.blocks ?? []).map(block => ({ block, owner: plugin.manifest.name })));
        for (const { block, owner } of blocks) {
            const problems = blockProblems(block);
            if (problems.length || this.#blocks.has(block.name)) throw new Error(`Block ${block.name}: ${problems.join(' ') || 'declared twice.'}`);
            this.#blocks.set(block.name, Object.freeze({ ...block, ...(owner ? { plugin: owner } : {}) }));
        }
        this.#apply(new Map(), new Map());
        this.fieldGroups = new CmsFieldGroups(this.db, { now: this.#now });
        this.users = new CmsUsers(this.db, { now: this.#now, checkMeta: (meta, previous) => this.#checkMeta({ kind: 'users' }, meta, previous) });
        this.redirects = new CmsRedirects(this.db, { now: this.#now });
        this.apiTokens = new CmsApiTokens(this.db, { now: this.#now });
        this.webhooks = new CmsWebhooks(this.db, { now: this.#now, fetch: this.#fetch });
        this.comments = new CmsComments(this.db, { now: this.#now });
        this.forms = new CmsForms(this, { ...(options.mail ? { mail: options.mail } : {}), ...(options.mailFrom ? { mailFrom: options.mailFrom } : {}) });
        this.security = new CmsSecurity(this.db, { now: this.#now });
        // Entry events become webhook deliveries; the outbox retries this until they are queued.
        this.hooks.addAction(afterCommit, event => this.#queueWebhooks(event), { plugin: 'cms' });
        // A saved form brings its submissions table up to date; a deleted one takes its table along.
        this.hooks.addAction(afterCommit, async event => {
            if (event.resource !== 'cms/forms') return;
            if (event.topic === 'resource.deleted') await this.forms.dropTable(event.id);
            else if (event.record) await this.forms.load(event.record);
        }, { plugin: 'cms' });
        // Submissions send the form's notifications and queue webhooks; both retry with the outbox.
        this.hooks.addAction(formSubmitted, event => this.forms.notify(event), { plugin: 'cms' });
        this.hooks.addAction(formSubmitted, event => this.#queueFormWebhooks(event), { plugin: 'cms' });
        this.outbox = new Outbox(this.db, this.hooks, { now: this.#now, ...options.outbox });
        this.authSessions = createAuthSessionStore(this.db, { now: this.#now, request: requestMetadata });
        this.oauthStates = createOAuthStateStore(this.db);
        this.sessions = createSessionStore(this.db, { now: this.#now });
        this.taxonomies = new CmsTaxonomies(this.db, {
            taxonomies: () => this.#taxonomies,
            now: this.#now,
            beforeSave: (draft, input) => this.hooks.applyFilters(termBeforeSave, draft, input),
            checkMeta: taxonomy => (meta, previous) => this.#checkMeta({ kind: 'taxonomy', name: taxonomy }, meta, previous),
            usage: name => this.resources.flatMap(resource => Object.entries(resource.fields)
                .filter(([, declaration]) => declaration.taxonomy === name).map(([field]) => ({ resource: resource.id, storage: resource.storage, field }))),
            canAssign: (principal, taxonomy) => this.taxonomies.usage(taxonomy.name).some(({ resource: id }) => {
                const resource = this.#resources.get(id);
                return resource !== undefined && (evaluateRule(resource.access.create, principal) !== 'deny' || evaluateRule(resource.access.update, principal) !== 'deny');
            }),
            // A term archive keeps answering at its old slug.
            slugChanged: (taxonomy, from, to, guard) => taxonomy.path ? this.redirects.automatic(`/${taxonomy.path}/${from}`, `/${taxonomy.path}/${to}`, { guard: guard.rql, params: guard.params }) : [],
        });
        for (const resource of this.#static.values()) for (const [name, declaration] of Object.entries(resource.fields)) {
            if (declaration.taxonomy && !this.#builtinTaxonomies.has(declaration.taxonomy)) throw new Error(`${resource.id}.${name} uses taxonomy ${declaration.taxonomy}, which no module declares.`);
        }
        const groups = [general, media, appearance, ...modules.flatMap(module => module.settings ?? []), ...(options.settings ?? [])];
        for (const plugin of this.#plugins.values()) {
            if (!plugin.manifest.theme) continue;
            const theme = this.#hostTheme(plugin, new Set(groups.map(group => group.id)));
            if (theme.options && !theme.problems.length) groups.push(theme.options);
            this.#themes.set(theme.name, theme);
        }
        this.settings = new CmsSettings(this.db, groups, { now: this.#now });
        this.menus = new CmsMenus(this.db, { now: this.#now, checkMeta: (meta, previous) => this.#checkMeta({ kind: 'menus' }, meta, previous), resolve: (items, locale) => this.#resolveMenu(items, locale), beforeSave: (items, input) => this.hooks.applyFilters(menuBeforeSave, items, input) });
        this.areas = new CmsAreas(this.db, { now: this.#now, check: blocks => this.#checkBlocks(blocks) });
        this.previews = new CmsPreviews(this.db, { now: this.#now });
        this.autosaves = new CmsAutosaves(this.db, { now: this.#now });
        this.files = options.storage ? new FileService(this.db, options.storage, { now: this.#now, ...(options.images ? { images: options.images } : {}), ...options.files }) : null;
        for (const module of modules) module.register?.({ hooks: this.hooks, settings: this.settings, taxonomies: this.taxonomies, collection: name => this.#collections.get(name), blocks: () => this.#blocks, now: this.#now });
        for (const plugin of this.#plugins.values()) this.#registerPlugin(plugin);
        if (!options.hooks) this.hooks.freeze();
    }

    now(): number { return this.#now(); }

    get resources(): readonly Resource[] { return [...this.#resources.values()]; }

    resourceById(id: string): Resource {
        const resource = this.#resources.get(id) ?? this.forms.resourceById(id);
        if (!resource) throw new CmsError('CMS_NOT_FOUND', `Unknown resource ${id}.`);
        return resource;
    }

    resource(id: string): ResourceRepository {
        let repository = this.#repositories.get(id);
        if (!repository) {
            this.resourceById(id);
            repository = new ResourceRepository(this, id);
            this.#repositories.set(id, repository);
        }
        return repository;
    }

    /**
     * Load collection and taxonomy definitions made in the dashboard. Cached like activation;
     * request middleware awaits this so `resource()` sees current collections.
     */
    ready(options: { force?: boolean } = {}): Promise<void> {
        const now = this.#now();
        if (options.force || !this.#definitions || now - this.#definitions.at > this.#activationTtl) {
            const state = this.#loadDefinitions().then(() => options.force ? undefined : this.#upgrade()).then(() => this.#refreshPlugins());
            this.#definitions = { at: now, state };
            state.catch(() => { this.#definitions = undefined; });
        }
        return this.#definitions.state;
    }

    /** Current collections: built-in ones first, then by label. Collections of inactive plugins are left out. */
    collections(): CollectionDefinition[] {
        return [...this.#collections.values()].filter(collection => this.#shown(collection))
            .sort((a, b) => Number(!a.builtin) - Number(!b.builtin) || a.label.localeCompare(b.label));
    }

    #shown(collection: CollectionDefinition): boolean {
        return !collection.plugin || this.#activePlugins.has(collection.plugin);
    }

    /** Which plugins are active, for the collections they ship. */
    async #refreshPlugins(): Promise<void> {
        const state = await this.#state().catch(() => null);
        const active = new Set<string>();
        if (state) for (const plugin of this.#plugins.values()) if ((await this.#pluginStatus(plugin, state)).active) active.add(plugin.manifest.name);
        this.#activePlugins = active;
    }

    /** The module's definition of a built-in collection, without fields an administrator added. */
    builtinCollection(name: string): CollectionDefinition | undefined {
        return this.#builtinCollections.get(name);
    }

    collection(name: string): CollectionDefinition {
        const definition = this.#collections.get(name);
        if (!definition || !this.#shown(definition)) throw new CmsError('CMS_NOT_FOUND', `Unknown collection ${name}.`);
        return definition;
    }

    /** Block types from modules and active plugins, for the editor's block picker. */
    async blocks(): Promise<(BlockDeclaration & { readonly plugin?: string })[]> {
        const available: (BlockDeclaration & { readonly plugin?: string })[] = [];
        for (const block of this.#blocks.values()) if (!block.plugin || await this.pluginActive(block.plugin)) available.push(block);
        return available;
    }

    /** Every registered block type, for validation and rendering. */
    get blockTypes(): ReadonlyMap<string, BlockDeclaration> { return this.#blocks; }

    /**
     * Store a profile picture in the media library and set it on the user. The user themself or
     * a user manager may; still and animated images up to 5 MB. Returns the picture's URL.
     */
    async uploadAvatar(userId: string, file: { name: string; contentType: string; size: number; body: ReadableStream<Uint8Array> }, context: { principal: Principal; signal?: AbortSignal }): Promise<string> {
        const self = context.principal.kind === 'user' && context.principal.id === userId;
        if (!self && !hasPermission(context.principal, PERMISSIONS.manageUsers)) throw new CmsError(context.principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to change this picture.');
        if (!this.files) throw new CmsError('CMS_UNAVAILABLE', 'Media storage is not configured.');
        if (!AVATAR_TYPES.includes(file.contentType.split(';')[0]!.trim().toLowerCase())) throw new CmsError('CMS_VALIDATION', 'Choose a PNG, JPEG, GIF, WebP or AVIF image.');
        const user = await this.users.get(userId);
        if (!user) throw new CmsError('CMS_NOT_FOUND', 'User not found.');
        const stored = await this.files.upload({ ...file, title: `Avatar of ${user.name}` }, { principal: systemPrincipal('avatar'), owner: userId, maxBytes: 5 * 1024 * 1024, ...(context.signal ? { signal: context.signal } : {}) });
        const url = mediaUrl(stored);
        await this.users.update(userId, { avatar: url });
        return url;
    }

    /**
     * Publish scheduled entries whose publication time has come, as `system:scheduler`, so
     * their webhooks and outbox events fire at that moment. Returns how many were published.
     */
    async publishDue(options: { limit?: number } = {}): Promise<number> {
        const scheduler = { principal: systemPrincipal('scheduler') };
        let published = 0;
        for (const collection of this.#collections.values()) {
            if (collection.publishable === false) continue;
            const repository = this.resource(`cms/${collection.name}`);
            let due: readonly RecordShape[];
            try {
                due = (await repository.list({ where: { status: 'scheduled', publishedAt: { lte: this.#now() } }, order: { field: 'publishedAt', direction: 'asc' }, limit: options.limit ?? 50 }, scheduler)).records;
            } catch (error) {
                if (error instanceof CmsError && error.code === 'CMS_UNAVAILABLE') continue;
                throw error;
            }
            for (const record of due) {
                try {
                    await repository.update(record.id, { status: 'published' }, { ...scheduler, expectedRevision: record.rev });
                    published++;
                } catch (error) {
                    // Changed meanwhile: the next run sees the current revision.
                    if (!(error instanceof CmsError && error.code === 'CMS_CONFLICT')) throw error;
                }
            }
        }
        return published;
    }

    /**
     * Published, indexable entries of a collection on the site for its XML sitemap, oldest
     * first, `limit` (at most 1,000) from `offset`: their URLs and last changes.
     */
    async sitemapEntries(name: string, options: { offset?: number; limit?: number } = {}): Promise<{ url: string; updatedAt: number }[]> {
        const collection = this.collection(name);
        if (collection.path === null || collection.path === undefined || collection.slug === false || (collection.publishable === false && collection.visibility !== 'public')) return [];
        const limit = Math.min(Math.max(options.limit ?? 1000, 1), 1000);
        const offset = Math.min(Math.max(options.offset ?? 0, 0), 1_000_000);
        const resource = this.resourceById(`cms/${collection.name}`);
        await this.assertActive(resource);
        const result = await this.db.read([{
            rql: `SELECT id, "slug", "parent", "locale", "seo", "_updatedAt", "_createdAt", "_owner" FROM ${resource.storage}${collection.publishable === false ? '' : ` WHERE "status" = 'published'`} ORDER BY "_createdAt", record::id(id) LIMIT ${limit} OFFSET ${offset}`,
        }], { workLimits: this.readLimits });
        const records = result.results[0]!.rows.map(([id, slug, parent, locale, seo, updatedAt, createdAt, owner]) => Object.freeze({
            id: String((id as { key: unknown }).key), rev: 0, slug, parent: parent && typeof parent === 'object' && 'key' in parent ? String((parent as { key: unknown }).key) : null,
            locale, seo, status: 'published', updatedAt: Number(updatedAt as bigint), createdAt: Number(createdAt as bigint), owner: (owner as string | null) ?? null,
        }) as RecordShape);
        const indexable = records.filter(record => !(record.seo && typeof record.seo === 'object' && (record.seo as { noindex?: unknown }).noindex === true));
        const urls = await this.entryUrls(collection, indexable);
        return indexable.flatMap(record => urls.get(record.id) ? [{ url: urls.get(record.id)!, updatedAt: record.updatedAt }] : []);
    }

    /** A shareable link to preview an entry the principal may edit. */
    async createPreviewLink(resourceId: string, id: string, principal: Principal, ttlMs?: number): Promise<PreviewLink> {
        await this.#editable(resourceId, id, principal);
        return this.previews.create(resourceId, id, principalId(principal), ttlMs);
    }

    async revokePreviewLinks(resourceId: string, id: string, principal: Principal): Promise<void> {
        await this.#editable(resourceId, id, principal);
        await this.previews.revoke(resourceId, id);
    }

    /** The entry a preview link opens, read whatever its status, or null. */
    async previewByToken(token: string): Promise<{ resource: Resource; record: RecordShape } | null> {
        const link = await this.previews.verify(token);
        if (!link || !this.#resources.has(link.resource)) return null;
        const record = await this.resource(link.resource).get(link.recordId, { principal: systemPrincipal('preview') });
        return record ? { resource: this.resourceById(link.resource), record } : null;
    }

    /** Store the editor's unsaved values of an entry (`new` before its first save) for its user. */
    async autosave(resourceId: string, id: string, principal: Principal, data: unknown): Promise<number> {
        const user = await this.#autosaver(resourceId, id, principal);
        return this.autosaves.save(resourceId, id, user, data);
    }

    async latestAutosave(resourceId: string, id: string, principal: Principal): Promise<Autosave | null> {
        if (principal.kind !== 'user') return null;
        return this.autosaves.get(resourceId, id, principal.id);
    }

    async discardAutosave(resourceId: string, id: string, principal: Principal): Promise<void> {
        if (principal.kind === 'user') await this.autosaves.discard(resourceId, id, principal.id);
    }

    async #autosaver(resourceId: string, id: string, principal: Principal): Promise<string> {
        if (principal.kind !== 'user') throw new CmsError('CMS_UNAUTHENTICATED', 'Sign in to save drafts.');
        if (id === 'new') {
            if (evaluateRule(this.resourceById(resourceId).access.create, principal) === 'deny') throw new CmsError('CMS_FORBIDDEN', `Not allowed to create ${resourceId}.`);
        } else await this.#editable(resourceId, id, principal);
        return principal.id;
    }

    /** The record, when the principal may read and update it. */
    async #editable(resourceId: string, id: string, principal: Principal): Promise<RecordShape> {
        const repository = this.resource(resourceId);
        const record = await repository.get(id, { principal });
        if (!record) throw new CmsError('CMS_NOT_FOUND', 'Record not found.');
        if (!repository.canUpdate(record, principal)) throw new CmsError(principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to edit this entry.');
        return record;
    }

    /**
     * The principal of an application password, with its access, or null. Only the content
     * API accepts these; `read` access may only read.
     */
    async tokenPrincipal(token: string): Promise<{ principal: Principal; scope: ApiTokenScope; userId: string } | null> {
        const verified = await this.apiTokens.verify(token);
        if (!verified) return null;
        const user = await this.users.get(verified.userId);
        if (!user || user.status !== 'active') return null;
        return { principal: userPrincipal(user.id, user.roles, user.permissions), scope: verified.scope, userId: user.id };
    }

    /** Whether visitors can comment on the entry: its collection takes comments, it is open, and not too old. */
    commentsOpen(collection: CollectionDefinition, record: RecordShape, settings: SiteSettings): boolean {
        if (!collection.comments || record.commentsOpen === false) return false;
        const days = settings['discussion.closeAfterDays'];
        const since = typeof record.publishedAt === 'number' ? record.publishedAt : record.createdAt;
        return !days || this.#now() - since < days * 24 * 60 * 60 * 1000;
    }

    /**
     * Post a comment on an entry visitors can read and comment on. Discussion settings decide
     * whether it appears at once, waits for moderation or goes to spam; moderators' comments
     * appear at once. `trap` is the form's hidden field, which only bots fill in.
     */
    async postComment(input: { collection: string; entry: string; parent?: string | null; content?: string; authorName?: string; authorEmail?: string; authorUrl?: string; trap?: string },
        context: { principal: Principal; ip?: string; userAgent?: string }): Promise<{ comment: CommentShape; collection: CollectionDefinition; entry: RecordShape; url: string | null }> {
        const collection = this.#collections.get(input.collection);
        if (!collection?.comments) throw new CmsError('CMS_NOT_FOUND', 'This entry does not take comments.');
        const resource = `cms/${collection.name}`;
        const record = await this.resource(resource).get(input.entry, { principal: ANONYMOUS });
        if (!record || (collection.publishable !== false && record.status !== 'published')) throw new CmsError('CMS_NOT_FOUND', 'This entry does not take comments.');
        const settings = await this.settings.all();
        if (!this.commentsOpen(collection, record, settings)) throw new CmsError('CMS_FORBIDDEN', 'Comments are closed.');
        const user = context.principal.kind === 'user' ? await this.users.get(context.principal.id) : null;
        if (settings['discussion.requireSignIn'] && !user) throw new CmsError('CMS_UNAUTHENTICATED', 'Sign in to comment.');
        const fields = checkComment(user ? { content: input.content, authorName: user.name, authorEmail: user.email, authorUrl: input.authorUrl } : input, !user && settings['discussion.requireNameEmail']);
        let parentId: string | null = null;
        if (input.parent) {
            const parent = await this.comments.get(input.parent);
            if (!parent || parent.resource !== resource || parent.recordId !== record.id || parent.status !== 'approved') throw new CmsError('CMS_VALIDATION', 'The comment you reply to is gone.');
            let depth = 1;
            for (let current: CommentShape | null = parent; current?.parentId && depth <= 10; depth++) current = await this.comments.get(current.parentId);
            if (depth >= settings['discussion.threadDepth']) throw new CmsError('CMS_VALIDATION', 'Replies cannot nest deeper here.');
            parentId = parent.id;
        }
        const ipHash = context.ip ? await sha256Hex(`cms-comment:${context.ip}`) : null;
        if (ipHash) {
            const last = await this.comments.lastFrom(ipHash);
            if (last !== null && this.#now() - last < 15_000) throw new CmsError('CMS_LIMIT', 'You are posting comments too quickly. Wait a moment and try again.');
        }
        const status: CommentStatus = input.trap ? 'spam' : hasPermission(context.principal, PERMISSIONS.moderateComments) ? 'approved'
            : await commentStatus(fields, settings, () => this.comments.hasApproved(fields.authorEmail));
        // Plugins check, change or hold the comment: spam filters, profanity lists, extra rules.
        const filtered = await this.hooks.applyFilters(commentBeforeSave, Object.freeze({ ...fields, status }), Object.freeze({
            collection: collection.name, entry: record.id, parent: parentId, actor: writeActorOf(context.principal), ...(context.ip ? { ip: context.ip } : {}), ...(context.userAgent ? { userAgent: context.userAgent } : {}),
        }));
        if (!filtered || typeof filtered !== 'object' || !(COMMENT_STATUSES as readonly string[]).includes(filtered.status)) throw new CmsError('CMS_VALIDATION', 'A plugin returned an invalid comment.');
        const checked = checkComment(filtered, !user && settings['discussion.requireNameEmail']);
        const comment = await this.comments.create({ id: crypto.randomUUID(), resource, recordId: record.id, parentId, userId: user?.id ?? null, ...checked,
            status: filtered.status, ipHash, userAgent: context.userAgent?.slice(0, 300) ?? null });
        const url = (await this.entryUrls(collection, [record])).get(record.id) ?? null;
        return { comment, collection, entry: record, url };
    }

    /** Moderate comments; needs `cms:comments`. */
    async moderateComments(ids: readonly string[], status: CommentStatus | 'delete', principal: Principal): Promise<void> {
        if (!hasPermission(principal, PERMISSIONS.moderateComments)) throw new CmsError(principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to moderate comments.');
        if (status === 'delete') await this.comments.delete(ids);
        else await this.comments.setStatus(ids, status);
    }

    async #queueFormWebhooks(event: FormSubmittedEvent): Promise<void> {
        if (!(await this.webhooks.wants(['form.submitted'], 'forms'))) return;
        const { submission } = event;
        await this.webhooks.enqueue({
            event: 'form.submitted', eventId: `${event.eventId}:form.submitted`, at: event.at, collection: 'forms',
            form: { id: event.form.id, slug: event.form.slug, title: event.form.title },
            submission: { id: submission.id, status: submission.status, values: submission.values, meta: submission.meta, user: submission.user, createdAt: submission.createdAt, stored: event.stored },
        });
    }

    async #queueWebhooks(event: ResourceEvent): Promise<void> {
        const collection = event.resource.startsWith('cms/') ? this.#collections.get(event.resource.slice(4)) : undefined;
        if (!collection) return;
        const publishable = collection.publishable !== false;
        const was = event.previousStatus === 'published';
        const is = event.record?.status === 'published';
        const events: WebhookEvent[] = event.topic === 'resource.created' ? ['entry.created', ...(publishable && is ? ['entry.published' as const] : [])]
            : event.topic === 'resource.deleted' ? ['entry.deleted']
            : publishable && !was && is ? ['entry.published'] : publishable && was && !is ? ['entry.unpublished'] : ['entry.updated'];
        if (!(await this.webhooks.wants(events, collection.name))) return;
        const url = event.record && (!publishable || is) ? (await this.entryUrls(collection, [event.record])).get(event.record.id) ?? null : null;
        const entry = event.record ? { ...event.record, url } : { id: event.id };
        for (const name of events) {
            await this.webhooks.enqueue({ event: name, eventId: `${event.eventId}:${name}`, at: event.at, collection: collection.name, entry, previousStatus: event.previousStatus ?? null });
        }
    }

    /** Themes from rendered plugins, valid ones first, by label. */
    themes(): ThemeInfo[] {
        return [...this.#themes.values()].sort((a, b) => Number(a.problems.length > 0) - Number(b.problems.length > 0) || a.label.localeCompare(b.label));
    }

    /**
     * The active theme's name: the Appearance setting when it names a usable theme, otherwise
     * the first usable one. Null when there is none.
     */
    async activeTheme(): Promise<string | null> {
        const chosen = await this.settings.get('appearance.theme').catch(() => '');
        const usable = [...this.#themes.values()].filter(theme => !theme.problems.length).sort((a, b) => a.name.localeCompare(b.name));
        return usable.find(theme => theme.name === chosen)?.name ?? usable[0]?.name ?? null;
    }

    async activateTheme(name: string, principal: Principal): Promise<void> {
        const theme = this.#themes.get(name);
        if (!theme) throw new CmsError('CMS_NOT_FOUND', `Unknown theme ${name}.`);
        if (theme.problems.length) throw new CmsError('CMS_VALIDATION', `${theme.label} cannot be used: ${theme.problems.join(' ')}`);
        await this.settings.update('appearance', { theme: name }, { principal });
    }

    /**
     * Templates an editor can choose for one entry: the active theme's `entry-*` templates,
     * except those named after a collection (`entry-posts`), which apply to it already.
     */
    async entryTemplates(): Promise<string[]> {
        const theme = this.#siteTheme(await this.activeTheme());
        const collections = new Set([...this.#collections.keys()].map(collection => `entry-${collection}`));
        return entryTemplateChoices(theme && !siteThemeProblems(theme).length ? theme as SiteTheme : undefined).filter(template => !collections.has(template));
    }

    /** The keys of a theme's loaders, from its `server.ts` `loaders` export. */
    themeLoaders(name: string | null): string[] {
        return [...new Set(this.#themeChain(name).flatMap(plugin => Object.keys(loadersOf(plugin))))];
    }

    /** A theme's plugin and its parent's, child first. */
    #themeChain(name: string | null): HostedPlugin[] {
        const plugin = name ? this.#plugins.get(name) : undefined;
        if (!plugin?.manifest.theme) return [];
        const parent = this.#parentOf(plugin);
        return parent ? [plugin, parent] : [plugin];
    }

    #parentOf(plugin: HostedPlugin): HostedPlugin | undefined {
        const name = (plugin.manifest.theme as ThemeManifest | undefined)?.extends;
        const parent = name && name !== plugin.manifest.name ? this.#plugins.get(name) : undefined;
        return parent?.manifest.theme ? parent : undefined;
    }

    /** A usable theme's templates, layered over its parent's; undefined when it has problems. */
    #siteTheme(name: string | null): SiteTheme | undefined {
        const info = name ? this.#themes.get(name) : undefined;
        if (!info || info.problems.length) return undefined;
        const [plugin, parent] = this.#themeChain(name);
        return assembleSiteTheme(plugin!.registration, parent?.registration) as SiteTheme;
    }

    /**
     * Run the first of the candidates a theme has a loader for, with the theme plugin's grants,
     * the visitor principal and a time limit. Returns its plain JSON, or `{}` when the theme has
     * no such loader, is not active, fails, runs out of time or returns too much.
     */
    async themeData(name: string | null, candidates: readonly string[], view: SiteView | EntryView | ArchiveView,
        context: { principal: Principal; options?: { readonly [name: string]: unknown }; locale?: string }): Promise<ThemeData> {
        // A child's loader wins over its parent's for the same key; each runs with its own plugin's grants.
        const chain = this.#themeChain(name);
        let plugin: HostedPlugin | undefined;
        let template: string | undefined;
        for (const candidate of candidates) {
            plugin = chain.find(entry => typeof loadersOf(entry)[candidate] === 'function');
            if (plugin) { template = candidate; break; }
        }
        const loaders = plugin ? loadersOf(plugin) : undefined;
        if (!plugin || !template || !loaders || plugin.problems.length || this.#themes.get(name!)?.problems.length) return {};
        if (!(await this.pluginActive(plugin.manifest.name))) return {};
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error(`timed out after ${this.#loaderTimeout} ms`)); }, this.#loaderTimeout);
        });
        try {
            const result = await Promise.race([Promise.resolve().then(() => loaders![template]!(view, {
                cms: this.pluginCms(plugin.manifest.name), principal: context.principal, signal: controller.signal,
                options: context.options ?? {}, locale: context.locale ?? ('locale' in view && typeof view.locale === 'string' ? view.locale : 'en'), template,
            })), timeout]);
            if (result === undefined || result === null) return {};
            if (typeof result !== 'object' || Array.isArray(result)) throw new Error('it must return an object.');
            const json = JSON.stringify(result);
            if (json.length > this.#dataLimit) throw new Error(`it returned ${json.length} characters, more than ${this.#dataLimit}.`);
            return JSON.parse(json) as ThemeData;
        } catch (error) {
            console.warn(`[cms] theme loader ${plugin.manifest.name}.${template} failed: ${(error as Error).message}`);
            return {};
        } finally {
            clearTimeout(timer);
        }
    }

    /** Widget areas of the active theme, then those only other themes declare. */
    async areaLocations(): Promise<{ name: string; label: string; theme: string; active: boolean }[]> {
        const active = await this.activeTheme();
        const seen = new Set<string>();
        const areas: { name: string; label: string; theme: string; active: boolean }[] = [];
        for (const theme of [...this.themes()].sort((a, b) => Number(b.name === active) - Number(a.name === active))) {
            if (theme.problems.length) continue;
            for (const area of theme.areas) {
                if (seen.has(area.name)) continue;
                seen.add(area.name);
                areas.push({ ...area, theme: theme.name, active: theme.name === active });
            }
        }
        return areas;
    }

    /** Blocks for a widget area, checked as a blocks field checks them; their files must be ready. */
    async #checkBlocks(value: unknown): Promise<Block[]> {
        const shape = blocksShapeProblem(value);
        if (shape) throw new CmsError('CMS_VALIDATION', `Widgets ${shape}`, { fields: { blocks: shape } });
        const { blocks, errors } = validateBlocks(value as Block[], this.#blocks);
        const first = Object.entries(errors)[0];
        if (first) throw new CmsError('CMS_VALIDATION', `${first[0]}: ${first[1]}`, { fields: errors });
        const plugins = [...new Set(blocks.map(block => this.#blocks.get(block.type)?.plugin).filter((plugin): plugin is string => !!plugin))];
        for (const plugin of plugins) if (!(await this.pluginActive(plugin))) throw new CmsError('CMS_VALIDATION', `Blocks of ${plugin} are not available while the plugin is inactive.`);
        const files = [...new Set(blockMedia(blocks, this.#blocks))];
        if (files.length > 100) throw new CmsError('CMS_VALIDATION', 'Widgets name too many files.');
        if (files.length) {
            const list = files.map((_, index) => `$m${index}`).join(', ');
            const found = await this.db.read([{ rql: `SELECT count(*) FROM cms_files WHERE status = 'ready' AND id IN (${list})`, params: Object.fromEntries(files.map((file, index) => [`$m${index}`, file])) }]);
            if (Number(found.results[0]!.rows[0]![0] as bigint) !== files.length) throw new CmsError('CMS_VALIDATION', 'Widgets name a missing file.');
        }
        return blocks;
    }

    /** Menu locations of the active theme, then those only other themes declare. */
    async menuLocations(): Promise<{ name: string; label: string; theme: string; active: boolean }[]> {
        const active = await this.activeTheme();
        const seen = new Set<string>();
        const locations: { name: string; label: string; theme: string; active: boolean }[] = [];
        for (const theme of [...this.themes()].sort((a, b) => Number(b.name === active) - Number(a.name === active))) {
            if (theme.problems.length) continue;
            for (const location of theme.locations) {
                if (seen.has(location.name)) continue;
                seen.add(location.name);
                locations.push({ ...location, theme: theme.name, active: theme.name === active });
            }
        }
        return locations;
    }

    /**
     * Slugs an entry of a collection served at the site root cannot take, among `base` and
     * `base-N`: routes of the application, the first segments of collection and taxonomy
     * paths, and the slugs of other root collections' entries.
     */
    async rootSlugConflicts(resourceId: string, base: string): Promise<string[]> {
        const name = resourceId.startsWith('cms/') ? resourceId.slice(4) : '';
        const collection = this.#collections.get(name);
        if (!collection || collection.path !== '') return [];
        const reserved = new Set(this.#reservedPaths);
        // Language prefixes, such as /fr, on a site with several languages.
        const languages = await this.languages();
        if (languages.multilingual) for (const code of languages.all) reserved.add(code);
        for (const other of this.#collections.values()) if (other.path) reserved.add(other.path.split('/')[0]!);
        for (const taxonomy of this.#taxonomies.values()) if (taxonomy.path) reserved.add(taxonomy.path);
        const taken = [...reserved].filter(word => word === base || word.startsWith(`${base}-`));
        const others = [...this.#collections.values()].filter(other => other.name !== name && other.path === '' && other.slug !== false);
        const statements = others.map(other => ({
            rql: `SELECT "slug" FROM ${this.resourceById(`cms/${other.name}`).storage} WHERE "slug" = $slug OR "slug" LIKE $prefix LIMIT 1000`,
            params: { $slug: base, $prefix: `${base}-%` },
        }));
        if (statements.length) for (const result of (await this.db.read(statements)).results) for (const row of result.rows) taken.push(row[0] as string);
        return taken;
    }

    /**
     * Where a collection's archive lists its entries: `/<path>`, or for posts served at the site
     * root, the Reading settings' posts page (or the home page when it shows the latest posts).
     */
    async archiveUrl(collection: CollectionDefinition, locale?: string | null): Promise<string | null> {
        const prefix = this.localePrefix(locale, await this.languages());
        if (collection.path) return `${prefix}/${collection.path}`;
        if (collection.path !== '' || collection.name !== 'posts') return null;
        const settings = await this.settings.all();
        let page = settings['reading.pageForPosts'] && this.#collections.has('pages')
            ? await this.resource('cms/pages').get(settings['reading.pageForPosts'], { principal: ANONYMOUS }).catch(() => null) : null;
        // In another language, the posts page's translation lists that language's posts.
        if (page && prefix) page = (await this.translations(this.collection('pages'), page)).get(locale!) ?? null;
        if (page?.status === 'published') return (await this.entryUrls(this.collection('pages'), [page])).get(page.id) ?? null;
        return settings['reading.showOnFront'] === 'posts' ? prefix || '/' : null;
    }

    /** The site's languages from Settings → Languages; the first is the default, served without a prefix. */
    async languages(): Promise<SiteLanguages> {
        const settings = await this.settings.all().catch(() => null);
        const configured = settings?.['languages.default'];
        const main = typeof configured === 'string' && LOCALE.test(configured) ? configured : 'en';
        const others = [...new Set(String(settings?.['languages.others'] ?? '').split(',').map(code => code.trim()).filter(code => LOCALE.test(code) && code !== main))];
        return { default: main, others, all: [main, ...others], multilingual: others.length > 0 };
    }

    /** `/<code>` for an entry in another language than the default; empty otherwise. */
    localePrefix(locale: unknown, languages: SiteLanguages): string {
        return languages.multilingual && typeof locale === 'string' && languages.others.includes(locale) ? `/${locale}` : '';
    }

    /**
     * Change the site's languages. Entries saved while the site had one language take the
     * default, so every entry belongs to a language.
     */
    async saveLanguages(input: { default: string; others: readonly string[] }, principal: Principal): Promise<SiteLanguages> {
        const codes = [input.default, ...input.others].map(code => String(code).trim().toLowerCase());
        if (codes.some(code => !LOCALE.test(code)) || new Set(codes).size !== codes.length || codes.length > 20) {
            throw new CmsError('CMS_VALIDATION', 'Languages are distinct codes such as en, fr or pt-br, at most 20.');
        }
        await this.settings.update('languages', { default: codes[0], others: codes.slice(1).join(',') }, { principal });
        for (const collection of this.#collections.values()) {
            const storage = this.resourceById(`cms/${collection.name}`).storage;
            await this.db.write([{ rql: `UPDATE ${storage} SET "locale" = $locale WHERE "locale" IS NULL`, params: { $locale: codes[0]! } }],
                { kind: 'cms.languages', workLimits: { rowsRead: 1_000_000, rowMutations: 100_000, vmSteps: 10_000_000 } }).catch(error => {
                // A collection whose table is not created yet has nothing to label.
                if (!(error instanceof ClientError && /no such table|not found|does not exist/i.test(error.message))) throw error;
            });
        }
        this.menus.refresh();
        return this.languages();
    }

    /**
     * An entry's translations by language, itself included, as the principal may read them.
     * A translation group is named after its first entry, which keeps no group of its own.
     */
    async translations(collection: CollectionDefinition, record: RecordShape, context: OperationContext = { principal: ANONYMOUS }): Promise<Map<string, RecordShape>> {
        const languages = await this.languages();
        const localeOf = (entry: RecordShape) => typeof entry.locale === 'string' ? entry.locale : languages.default;
        const found = new Map<string, RecordShape>([[localeOf(record), record]]);
        const group = typeof record.translationGroup === 'string' ? record.translationGroup : record.id;
        const repository = this.resource(`cms/${collection.name}`);
        const members = (await repository.list({ where: { translationGroup: group }, limit: 50 }, context)).records;
        const source = group !== record.id ? (await repository.getMany([group], context)).get(group) : undefined;
        for (const entry of [...(source ? [source] : []), ...members]) if (!found.has(localeOf(entry))) found.set(localeOf(entry), entry);
        return found;
    }

    /**
     * Start a translation of an entry: a draft copy in the language and the entry's translation
     * group, with its parent's translation as parent. An existing translation is returned instead.
     */
    async translateEntry(collectionName: string, id: string, locale: string, principal: Principal): Promise<RecordShape> {
        const languages = await this.languages();
        if (!languages.all.includes(locale)) throw new CmsError('CMS_VALIDATION', `${locale} is not one of the site's languages.`);
        const collection = this.collection(collectionName);
        const repository = this.resource(`cms/${collection.name}`);
        const source = await repository.get(id, { principal });
        if (!source) throw new CmsError('CMS_NOT_FOUND', 'Entry not found.');
        const existing = (await this.translations(collection, source, { principal })).get(locale);
        if (existing) return existing;
        const input: { [field: string]: unknown } = {};
        for (const [name, declaration] of Object.entries(repository.resource.fields)) {
            if (['slug', 'status', 'publishedAt', 'locale', 'translationGroup', 'parent'].includes(name) || source[name] === undefined || source[name] === null) continue;
            if (declaration.access?.write && !hasPermission(principal, declaration.access.write)) continue;
            input[name] = source[name];
        }
        if (collection.hierarchical && typeof source.parent === 'string') {
            const parent = (await repository.getMany([source.parent], { principal })).get(source.parent);
            const translated = parent ? (await this.translations(collection, parent, { principal })).get(locale) : undefined;
            if (translated) input.parent = translated.id;
        }
        return repository.create({ ...input, locale, translationGroup: typeof source.translationGroup === 'string' ? source.translationGroup : source.id, ...(collection.publishable === false ? {} : { status: 'draft' }) }, { principal });
    }

    /**
     * Public URLs of a collection's entries: the collection's path and, for nested
     * collections, the slugs of their ancestors, read in one request per level.
     */
    async entryUrls(collection: CollectionDefinition, records: readonly RecordShape[], context: OperationContext = { principal: ANONYMOUS }): Promise<Map<string, string | null>> {
        const urls = new Map<string, string | null>();
        if (collection.path === null || collection.path === undefined || collection.slug === false) {
            for (const record of records) urls.set(record.id, null);
            return urls;
        }
        const known = new Map(records.map(record => [record.id, record]));
        const languages = await this.languages();
        if (collection.hierarchical) {
            let missing = [...new Set(records.map(record => record.parent as string | null).filter((id): id is string => !!id && !known.has(id)))];
            for (let depth = 0; missing.length && depth < 8; depth++) {
                const found = await this.resource(`cms/${collection.name}`).getMany(missing, context);
                for (const record of found.values()) known.set(record.id, record);
                missing = [...new Set([...found.values()].map(record => record.parent as string | null).filter((id): id is string => !!id && !known.has(id)))];
            }
        }
        for (const record of records) {
            const slugs: string[] = [];
            let current: RecordShape | undefined = record;
            for (let depth = 0; current && depth < 9; depth++) {
                if (typeof current.slug !== 'string') { slugs.length = 0; break; }
                slugs.unshift(current.slug);
                const parent: string | null = collection.hierarchical ? current.parent as string | null : null;
                current = parent ? known.get(parent) : undefined;
                if (parent && !current) { slugs.length = 0; break; }
            }
            const url = entryUrl(collection.path, slugs);
            urls.set(record.id, url ? `${this.localePrefix(record.locale, languages)}${url}` : null);
        }
        return urls;
    }

    /**
     * Create or change a collection. Its table and indexes change in one migration step that
     * also stores the definition; built-in collections store only their added fields.
     */
    async saveCollection(given: CollectionDefinition, principal: Principal): Promise<CollectionDefinition> {
        this.#authorizeBuilder(principal);
        await this.ready({ force: true });
        const before = this.#collections.get(given.name);
        const builtin = this.#builtinCollections.get(given.name);
        // A layout compiles to the fields; its field blocks are checked as a field group's.
        let input = given;
        if (given.layout !== undefined) {
            const scope = [...CORE_FIELDS, ...(given.taxonomies ?? [])];
            const checked = validateBlocks(Array.isArray(given.layout) ? given.layout : [], this.#blocks, { fieldGroup: { scope } });
            const first = Object.entries(checked.errors)[0];
            if (first) throw new CmsError('CMS_VALIDATION', `Layout block ${first[0]}: ${first[1]}`, { fields: { layout: `${first[0]}: ${first[1]}` } });
            const fields = fieldGroupDeclarations(checked.blocks, this.#blocks);
            for (const [name, declaration] of Object.entries(builtin?.fields ?? {})) if (Object.hasOwn(fields, name)) fields[name] = declaration;
            input = { ...given, fields, fieldOrder: Object.keys(fields), layout: checked.blocks };
        }
        const stored: CollectionDefinition = builtin ? {
            name: input.name, label: input.label, singular: input.singular, ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.icon !== undefined ? { icon: input.icon } : {}), ...(input.path !== undefined ? { path: input.path } : {}),
            ...(input.comments !== undefined ? { comments: input.comments } : {}),
            ...(input.template !== undefined ? { template: input.template } : {}),
            ...(input.templateLock !== undefined ? { templateLock: input.templateLock } : {}),
            ...(input.layout !== undefined ? { layout: input.layout } : {}),
            taxonomies: (input.taxonomies ?? []).filter(name => !(builtin.taxonomies ?? []).includes(name)),
            fields: Object.fromEntries(Object.entries(input.fields ?? {}).filter(([name]) => !Object.hasOwn(builtin.fields, name))),
            // The module's fields are not stored, so their place among the added ones is.
            fieldOrder: [...(input.fieldOrder ?? Object.keys(input.fields ?? {}))],
        } : (({ fieldOrder, ...rest }) => ({ ...rest, fields: orderedFields(input.fields ?? {}, fieldOrder), builtin: false }))(input);
        const definition = builtin ? extendCollection(builtin, stored) : stored;
        const problems = collectionProblems(definition);
        if (!builtin && this.#static.has(`cms/${definition.name}`)) problems.push(`cms/${definition.name} is already a resource.`);
        for (const taxonomy of definition.taxonomies ?? []) if (!this.#taxonomies.has(taxonomy)) problems.push(`Taxonomy ${taxonomy} does not exist.`);
        for (const [name, declaration] of Object.entries(definition.fields)) {
            if (declaration.kind === 'reference' && declaration.target !== `cms/${definition.name}` && !this.#resources.has(declaration.target!)) problems.push(`Field ${name} refers to ${declaration.target}, which does not exist.`);
            for (const type of declaration.blocks ?? []) if (!this.#blocks.has(type)) problems.push(`Field ${name} allows ${type}, which is not a block type.`);
        }
        // The content template is checked like an entry's blocks, against the content field's allowed types.
        if (definition.template?.length && !problems.length) {
            const content = Object.values(definition.fields).find(declaration => declaration.kind === 'blocks');
            const { errors } = validateBlocks(definition.template, this.#blocks, content?.blocks ? { allowed: content.blocks } : {});
            problems.push(...Object.entries(errors).map(([path, message]) => `Template block ${path}: ${message}`));
        }
        if (problems.length) throw new CmsError('CMS_VALIDATION', problems.join(' '), { fields: { definition: problems.join(' ') } });
        // The same resource `ready()` builds from the stored definition; its hash is what the migration records.
        const resource = this.#collectionResource(definition, this.#taxonomyLabels());
        const row: Statement = {
            rql: 'INSERT INTO cms_collections (name, definition, updated_at, updated_by) VALUES ($name, $definition, $now, $by) ON CONFLICT (name) DO UPDATE SET definition = excluded.definition, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
            params: { $name: definition.name, $definition: JSON.stringify(stored), $now: this.#now(), $by: principalId(principal) },
        };
        const resources = [...[...this.#resources.values()].filter(entry => entry.id !== resource.id), resource];
        let attached = false;
        const plan = await planSchema(resources, await readCatalog(this.db, resources.map(entry => entry.storage)));
        const blocked = plan.blocked.filter(problem => problem.resource === resource.id);
        if (blocked.length) throw new CmsError('CMS_VALIDATION', blocked.map(problem => problem.message).join(' '));
        const report = await migrate(this.db, resources, { now: this.#now, only: [resource.id], attach: id => id === resource.id ? (attached = true, [row]) : [] });
        if (report.failed) throw new CmsError('CMS_CONFLICT', `The collection could not be saved: ${report.failed.message}`);
        if (!attached) await this.db.write([row], { kind: 'cms.collections', retryConflicts: 5 });
        this.#activation = undefined;
        await this.ready({ force: true });
        const saved = this.collection(definition.name);
        if (before && before.path !== saved.path) await this.#pathRedirects(before, saved, principal);
        return saved;
    }

    /**
     * Automatic redirects for an entry whose URL changes while it stays published, added to the
     * entry's write and guarded by it. Called by repositories.
     */
    async redirectStatements(resource: Resource, before: RecordShape, after: RecordShape, guard: { rql: string; params: { [key: string]: Value } }, by: string | null): Promise<Statement[]> {
        const collection = resource.owner === 'cms' ? this.#collections.get(resource.name) : undefined;
        if (!collection || collection.path === null || collection.path === undefined || collection.slug === false) return [];
        const live = (record: RecordShape) => collection.publishable === false || record.status === 'published';
        if (!live(before) || !live(after) || (before.slug === after.slug && before.parent === after.parent && before.locale === after.locale)) return [];
        const from = (await this.entryUrls(collection, [before])).get(before.id);
        const to = (await this.entryUrls(collection, [after])).get(after.id);
        return from && to && from !== to ? this.redirects.automatic(from, to, { guard: guard.rql, params: guard.params, by }) : [];
    }

    /**
     * Old links keep working after a collection's URL path changes: `/<old>/*` redirects to the
     * new path, the archive to the new archive, and entries that leave the site root one by one.
     */
    async #pathRedirects(before: CollectionDefinition, after: CollectionDefinition, principal: Principal): Promise<void> {
        if (before.path === null || before.path === undefined || after.path === null || after.path === undefined || before.slug === false) return;
        const pairs: { from: string; to: string; prefix?: boolean }[] = [];
        if (before.path) {
            pairs.push({ from: `/${before.path}`, to: after.path ? `/${after.path}` : '/', prefix: true });
            const archive = await this.archiveUrl(after);
            if (archive) pairs.push({ from: `/${before.path}`, to: archive });
        } else {
            // Entries leave the site root: a prefix of / would catch every missing page.
            const repository = this.resource(`cms/${after.name}`);
            const where: { [field: string]: FieldFilter } = after.publishable === false ? {} : { status: 'published' };
            for (let offset = 0; offset < 1000; offset += 100) {
                const page = await repository.list({ where, order: { field: 'createdAt', direction: 'asc' }, limit: 100, offset }, { principal: systemPrincipal('redirects') });
                const urls = await this.entryUrls(after, page.records);
                for (const record of page.records) {
                    const to = urls.get(record.id);
                    if (to && typeof record.slug === 'string') pairs.push({ from: `/${record.slug}`, to });
                }
                if (!page.more) break;
            }
        }
        await this.redirects.record(pairs, principalId(principal));
        // The new path serves the collection again: an older redirect away from it goes.
        if (after.path) await this.redirects.dropPrefix(`/${after.path}`);
    }

    /** Delete a collection the dashboard defined, with its table and entries. */
    async deleteCollection(name: string, principal: Principal): Promise<void> {
        this.#authorizeBuilder(principal);
        await this.ready({ force: true });
        if (this.#builtinCollections.has(name)) throw new CmsError('CMS_FORBIDDEN', 'Built-in collections cannot be deleted.');
        const definition = this.collection(name);
        const id = `cms/${definition.name}`;
        const referrers = this.resources.filter(resource => resource.id !== id && Object.values(resource.fields).some(field => field.kind === 'reference' && field.target === id));
        if (referrers.length) throw new CmsError('CMS_CONFLICT', `${referrers.map(resource => resource.label ?? resource.id).join(', ')} refer to this collection.`);
        const storage = this.resourceById(id).storage;
        const info = await this.db.read([{ rql: 'INFO FOR DB' }]);
        const exists = ((info.results[0]!.rows[0]![0] as { tables?: { name: string }[] }).tables ?? []).some(table => table.name === storage);
        await this.db.write([
            ...(exists ? [{ rql: `DROP TABLE ${storage}` }] : []),
            { rql: 'DELETE FROM cms_collections WHERE name = $name', params: { $name: name } },
            { rql: 'DELETE FROM cms_schema_state WHERE resource = $id', params: { $id: id } },
        ], { kind: 'cms.collections' });
        this.#activation = undefined;
        await this.ready({ force: true });
    }

    /** Create or change a taxonomy. Built-in taxonomies keep their name and nesting. */
    async saveTaxonomy(input: TaxonomyDeclaration, principal: Principal): Promise<TaxonomyDeclaration> {
        this.#authorizeBuilder(principal);
        await this.ready({ force: true });
        const builtin = this.#builtinTaxonomies.get(input.name);
        const declaration: TaxonomyDeclaration = builtin ? { ...builtin, label: input.label, singular: input.singular, path: input.path ?? null, ...(input.description !== undefined ? { description: input.description } : {}) }
            : { name: input.name, label: input.label, singular: input.singular, hierarchical: input.hierarchical, path: input.path ?? null, ...(input.description !== undefined ? { description: input.description } : {}) };
        const problems = taxonomyProblems(declaration);
        // Collections store a taxonomy's terms in a field of the same name.
        if (!builtin && (CORE_FIELDS.includes(declaration.name) || [...this.#collections.values()].some(collection => Object.hasOwn(collection.fields, declaration.name)))) problems.push(`${declaration.name} is already a field name.`);
        if (problems.length) throw new CmsError('CMS_VALIDATION', problems.join(' '));
        const current = this.#taxonomies.get(declaration.name);
        if (current?.hierarchical && !declaration.hierarchical) {
            const nested = await this.db.read([{ rql: 'SELECT count(*) FROM cms_terms WHERE taxonomy = $taxonomy AND parent_id IS NOT NULL', params: { $taxonomy: declaration.name } }]);
            if (Number(nested.results[0]!.rows[0]![0] as bigint)) throw new CmsError('CMS_CONFLICT', `Some ${declaration.label.toLowerCase()} have parents. Move them to the top level first.`);
        }
        await this.db.write([{
            rql: 'INSERT INTO cms_taxonomies (name, definition, updated_at, updated_by) VALUES ($name, $definition, $now, $by) ON CONFLICT (name) DO UPDATE SET definition = excluded.definition, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
            params: { $name: declaration.name, $definition: JSON.stringify(declaration), $now: this.#now(), $by: principalId(principal) },
        }], { kind: 'cms.collections', retryConflicts: 5 });
        await this.ready({ force: true });
        // Term archives keep answering at the old path.
        if (current?.path && declaration.path && current.path !== declaration.path) await this.redirects.record([{ from: `/${current.path}`, to: `/${declaration.path}`, prefix: true }], principalId(principal));
        return this.taxonomies.declaration(declaration.name);
    }

    /** Delete a taxonomy the dashboard defined, with its terms. Collections must stop using it first. */
    async deleteTaxonomy(name: string, principal: Principal): Promise<void> {
        this.#authorizeBuilder(principal);
        await this.ready({ force: true });
        if (this.#builtinTaxonomies.has(name)) throw new CmsError('CMS_FORBIDDEN', 'Built-in taxonomies cannot be deleted.');
        this.taxonomies.declaration(name);
        const users = this.collections().filter(collection => collection.taxonomies?.includes(name));
        if (users.length) throw new CmsError('CMS_CONFLICT', `${users.map(collection => collection.label).join(', ')} use this taxonomy.`);
        await this.db.write([
            { rql: 'DELETE FROM cms_terms WHERE taxonomy = $name', params: { $name: name } },
            { rql: 'DELETE FROM cms_taxonomies WHERE name = $name', params: { $name: name } },
        ], { kind: 'cms.collections' });
        await this.ready({ force: true });
    }

    /** Resources the principal may read, for navigation. */
    readable(principal: Principal): Resource[] {
        return this.resources.filter(resource => evaluateRule(resource.access.read, principal) !== 'deny');
    }

    async plan(options: { signal?: AbortSignal } = {}): Promise<SchemaPlan> {
        return planSchema(this.resources, await readCatalog(this.db, this.resources.map(resource => resource.storage), options));
    }

    async migrate(options: { signal?: AbortSignal } = {}): Promise<MigrationReport> {
        const report = await migrate(this.db, this.resources, { ...options, now: this.#now });
        this.#activation = undefined;
        return report;
    }

    /**
     * A resource is active when the database records its current declaration and its plugin is
     * active. Writes to collections read the recorded hash fresh: a definition changed by another
     * isolate is reloaded before the write is validated.
     */
    async assertActive(resource: Resource, options: { fresh?: boolean } = {}): Promise<void> {
        const collection = resource.owner === 'cms' && this.#collections.has(resource.name);
        const recorded = async () => {
            if (!(options.fresh && collection)) return (await this.#state()).hashes.get(resource.id);
            const result = await this.db.read([{ rql: 'SELECT declaration_hash FROM cms_schema_state WHERE resource = $id', params: { $id: resource.id } }]);
            return result.results[0]!.rows[0]?.[0] as string | undefined;
        };
        let current = this.#resources.get(resource.id) ?? resource;
        let hash = await recorded();
        if (hash !== await declarationHash(current) && collection) {
            // Another isolate changed the collection: reload its definition and activation once.
            this.#activation = undefined;
            await this.ready({ force: true });
            current = this.#resources.get(resource.id) ?? current;
            hash = await recorded();
        }
        if (hash !== await declarationHash(current)) {
            throw new CmsError('CMS_UNAVAILABLE', `${resource.id} is waiting for a schema migration.`);
        }
        const owner = collection ? this.#collections.get(resource.name)?.plugin ?? resource.owner : resource.owner;
        const plugin = this.#plugins.get(owner);
        if (plugin && !(await this.#pluginStatus(plugin, await this.#state())).active) throw new CmsError('CMS_UNAVAILABLE', `Plugin ${owner} is not active.`);
    }

    async status(): Promise<ActivationStatus> {
        const state = await this.#state();
        const resources = await Promise.all(this.resources.map(async resource => ({ id: resource.id, active: state.hashes.get(resource.id) === await declarationHash(resource) })));
        const plugins = await Promise.all([...this.#plugins.values()].map(plugin => this.#pluginStatus(plugin, state)));
        return { resources, plugins };
    }

    async pluginActive(name: string): Promise<boolean> {
        const plugin = this.#plugins.get(name);
        return plugin ? (await this.#pluginStatus(plugin, await this.#state())).active : false;
    }

    /**
     * Record an administrator's grant of everything the plugin's manifest requests. An upgrade
     * that requests more leaves the plugin inactive until it is granted again.
     */
    async grantPlugin(name: string, principal: Principal): Promise<PluginStatus> {
        if (!hasPermission(principal, PERMISSIONS.managePlugins)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to manage plugins.');
        const plugin = this.#plugins.get(name);
        if (!plugin) throw new CmsError('CMS_NOT_FOUND', `Unknown plugin ${name}.`);
        if (plugin.problems.length) throw new CmsError('CMS_VALIDATION', `Plugin ${name} has an invalid manifest: ${plugin.problems.join(' ')}`);
        const now = this.#now();
        await this.db.write([
            { rql: 'DELETE FROM cms_grants WHERE subject = $subject', params: { $subject: `plugin:${name}` } },
            ...[PLUGIN_ENABLED, ...plugin.requested].map((permission, index) => ({
                rql: 'INSERT INTO cms_grants (id, subject, permission, revision, created_at) VALUES ($id, $subject, $permission, $revision, $now)',
                params: { $id: `${name}:${index}:${now}`, $subject: `plugin:${name}`, $permission: permission, $revision: now, $now: now },
            })),
        ], { kind: 'cms.grants', retryConflicts: 5 });
        this.#activation = undefined;
        await this.#refreshPlugins();
        return this.#pluginStatus(plugin, await this.#state());
    }

    /** Disable a plugin: its grants are removed; its hooks, commands and resources stop. Data stays. */
    async revokePlugin(name: string, principal: Principal): Promise<void> {
        if (!hasPermission(principal, PERMISSIONS.managePlugins)) throw new CmsError('CMS_FORBIDDEN', 'Not allowed to manage plugins.');
        await this.db.write([{ rql: 'DELETE FROM cms_grants WHERE subject = $subject', params: { $subject: `plugin:${name}` } }], { kind: 'cms.grants', retryConflicts: 5 });
        this.#activation = undefined;
        await this.#refreshPlugins();
    }

    /** Commands plugin manifests declare. */
    commands(): { plugin: string; command: PluginCommand }[] {
        return [...this.#plugins.values()].flatMap(plugin => (plugin.manifest.commands ?? []).map(command => ({ plugin: plugin.manifest.name, command })));
    }

    /** Run a plugin command as the principal: dashboard access, the command's permission and an active plugin are required. */
    async runCommand(plugin: string, name: string, input: { readonly [option: string]: string | number | boolean }, context: CommandContext): Promise<unknown> {
        const hosted = this.#plugins.get(plugin);
        const command = hosted?.manifest.commands?.find(entry => entry.name === name);
        const handler = hosted?.commands.get(name);
        if (!hosted || !command || !handler) throw new CmsError('CMS_NOT_FOUND', `Unknown command ${plugin}:${name}.`);
        if (!hasPermission(context.principal, PERMISSIONS.dashboard) || (command.permission && !hasPermission(context.principal, command.permission))) {
            throw new CmsError(context.principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', `Not allowed to run ${plugin}:${name}.`);
        }
        if (!(await this.pluginActive(plugin))) throw new CmsError('CMS_UNAVAILABLE', `Plugin ${plugin} is not active.`);
        return handler(input, context);
    }

    /** Links plugins add to a dashboard slot, for active plugins and permitted principals. */
    async slotLinks(slot: string, principal: Principal): Promise<(SlotLink & { plugin: string })[]> {
        const links: (SlotLink & { plugin: string })[] = [];
        for (const plugin of this.#plugins.values()) {
            const entries = plugin.manifest.ui?.slots?.[slot] ?? [];
            if (!entries.length || !(await this.pluginActive(plugin.manifest.name))) continue;
            for (const link of entries) if (!link.permission || hasPermission(principal, link.permission)) links.push({ ...link, plugin: plugin.manifest.name });
        }
        return links;
    }

    /** True once every host table exists. Background work waits for it on a fresh database. */
    async installed(): Promise<boolean> {
        if (this.#installed) return true;
        const result = await this.db.read([{ rql: 'INFO FOR DB' }]);
        const tables = new Set(((result.results[0]!.rows[0]![0] as { tables?: { name: string }[] }).tables ?? []).map(table => table.name));
        this.#installed = HOST_TABLES.every(name => tables.has(name));
        return this.#installed;
    }

    /** Forget cached activation, for example after a migration or grant made elsewhere. */
    refreshActivation(): void {
        this.#activation = undefined;
        // The next ready() re-reads which plugins are active, for their collections.
        this.#definitions = undefined;
    }

    /** Repositories limited to a plugin's own resources and its granted ones. */
    pluginCms(name: string): PluginCms {
        return {
            resource: id => {
                const plugin = this.#plugins.get(name);
                // Its own resources and the collections it ships.
                const own = (plugin?.resources.includes(id) || plugin?.manifest.collections?.some(collection => `cms/${collection.name}` === id)) ?? false;
                const requested = new Set((plugin?.requested ?? []).filter(grant => grant.startsWith(`resource:${id}:`)).map(grant => grant.slice(`resource:${id}:`.length) as ResourceAction));
                if (!own && !requested.size) throw new CmsError('CMS_FORBIDDEN', `Plugin ${name} has no grant for ${id}.`);
                const repository = this.resource(id);
                // Requested in the manifest and granted by an administrator.
                const check = (action: ResourceAction): Promise<void> => {
                    if (own) return Promise.resolve();
                    if (!requested.has(action)) throw new CmsError('CMS_FORBIDDEN', `Plugin ${name} may not ${action} ${id}.`);
                    return this.#state().then(state => {
                        if (!state.grants.get(`plugin:${name}`)?.has(`resource:${id}:${action}`)) throw new CmsError('CMS_FORBIDDEN', `Plugin ${name} is not granted ${action} on ${id}.`);
                    });
                };
                return {
                    get: (key, context) => check('read').then(() => repository.get(key, context)),
                    list: (options: ListOptions, context: OperationContext) => check('read').then(() => repository.list(options, context)),
                    search: (query, options, context) => check('read').then(() => repository.search(query, options, context)),
                    create: (input, context) => check('create').then(() => repository.create(input, context)),
                    update: (key, patch, context) => check('update').then(() => repository.update(key, patch, context)),
                    delete: (key, context) => check('delete').then(() => repository.delete(key, context)),
                };
            },
        };
    }

    /** Called after each committed mutation. Menus link to entries, so their cache is dropped. */
    outboxWritten(): void {
        this.outboxWrites++;
        this.menus.refresh();
    }

    jobs() { return createJobStore(this.db); }
    notifications() { return createNotificationStore(this.db); }

    #register(resource: Resource): Resource {
        if (this.#static.has(resource.id)) throw new Error(`Resource ${resource.id} is declared twice.`);
        if ([...this.#static.values()].some(other => other.storage === resource.storage)) throw new Error(`Resource ${resource.id} collides with another storage name.`);
        this.#static.set(resource.id, resource);
        this.#resources.set(resource.id, resource);
        return resource;
    }

    #authorizeBuilder(principal: Principal): void {
        if (!hasPermission(principal, PERMISSIONS.manageCollections)) throw new CmsError(principal.kind === 'anonymous' ? 'CMS_UNAUTHENTICATED' : 'CMS_FORBIDDEN', 'Not allowed to change collections.');
    }

    /**
     * A collection's resource: its own fields, then its groups', then the lists derived from rows
     * for filtering, with the layout of both. Saving and reloading build it the same way, so the
     * declaration hash a migration records is the one `ready()` checks writes against.
     */
    #collectionResource(definition: CollectionDefinition, labels: { [name: string]: string }): Resource {
        const groups = this.#groupFields({ kind: 'collection', name: definition.name });
        const fields = { ...definition.fields, ...groups.fields };
        const layout = [...(definition.layout ?? []), ...groups.layout];
        return resolveResource({ ...collectionResource({ ...definition, fields: { ...fields, ...derivedFields(fields) } }, labels), ...(layout.length ? { layout } : {}) }, 'cms');
    }

    #taxonomyLabels(): { [name: string]: string } {
        return Object.fromEntries([...this.#taxonomies.values()].map(taxonomy => [taxonomy.name, taxonomy.label]));
    }

    /**
     * After a package upgrade, apply what the CMS owns on the next request: new host tables and
     * built-in or dashboard collections whose declaration changed. Code-declared resources and
     * plugins wait for Tools → Schema. Concurrent isolates replan against the ledger.
     */
    async #upgrade(): Promise<void> {
        const state = await this.#state();
        if (!state.hostVersions.has(1)) return; // before setup
        const hostPending = HOST_STEPS.some(step => !state.hostVersions.has(step.version));
        const stale: string[] = [];
        for (const collection of this.#collections.values()) {
            const resource = this.#resources.get(`cms/${collection.name}`);
            if (resource && state.hashes.get(resource.id) !== await declarationHash(resource)) stale.push(resource.id);
        }
        if (!hostPending && !stale.length) return;
        this.#upgrading ??= migrate(this.db, this.resources, { now: this.#now, only: stale }).then(report => {
            if (report.failed) console.error(`[cms] could not upgrade the schema: ${report.failed.message}`);
        }, error => console.error('[cms] could not upgrade the schema', error)).finally(() => {
            this.#upgrading = undefined;
            this.#activation = undefined;
            this.#installed = false;
        });
        await this.#upgrading;
    }

    async #loadDefinitions(): Promise<void> {
        let collections: readonly (readonly unknown[])[] = [];
        let taxonomies: readonly (readonly unknown[])[] = [];
        try {
            const result = await this.db.read([
                { rql: 'SELECT name, definition FROM cms_collections ORDER BY name LIMIT 200' },
                { rql: 'SELECT name, definition FROM cms_taxonomies ORDER BY name LIMIT 200' },
            ]);
            collections = result.results[0]!.rows;
            taxonomies = result.results[1]!.rows;
        } catch (error) {
            // Before setup the tables do not exist; built-ins apply.
            if (!(error instanceof ClientError) || !/cms_collections|cms_taxonomies|no such table|not found/i.test(error.message)) throw error;
        }
        const parse = <T>(rows: readonly (readonly unknown[])[]) => new Map(rows.flatMap(([name, definition]) => {
            try { return [[name as string, JSON.parse(definition as string) as T] as const]; } catch { return []; }
        }));
        this.fieldGroups.reset();
        this.#groups = await this.fieldGroups.all();
        this.#apply(parse<CollectionDefinition>(collections), parse<TaxonomyDeclaration>(taxonomies));
    }

    /** The groups attached to a target, in order. */
    #groupsFor(target: FieldGroupTarget): FieldGroup[] {
        return this.#groups.filter(group => group.targets.some(entry => sameTarget(entry, target)));
    }

    /** A target's fields from its groups, after the group blocks are checked against the current types. */
    #groupFields(target: FieldGroupTarget): { fields: { [name: string]: FieldDeclaration }; layout: Block[] } {
        const fields: { [name: string]: FieldDeclaration } = {};
        const layout: Block[] = [];
        for (const group of this.#groupsFor(target)) {
            const { blocks } = validateBlocks(group.blocks, this.#blocks, { fieldGroup: true });
            Object.assign(fields, fieldGroupDeclarations(blocks, this.#blocks));
            layout.push(...blocks);
        }
        return { fields, layout };
    }

    /**
     * A target's meta as it is stored: the groups' fields checked, hidden fields cleared, the
     * fields the input leaves out kept from `previous`.
     */
    async #checkMeta(target: FieldGroupTarget, meta: unknown, previous: { readonly [field: string]: unknown } | null): Promise<{ readonly [field: string]: unknown }> {
        const { fields, layout } = this.#groupFields(target);
        if (meta !== undefined && (meta === null || typeof meta !== 'object' || Array.isArray(meta))) throw new CmsError('CMS_VALIDATION', 'Meta must be an object of fields.', { fields: { meta: 'must be an object of fields.' } });
        const merged = { ...previous, ...(meta as { [field: string]: unknown } | undefined) };
        const { errors, values } = metaProblems(fields, merged, () => blockId());
        const { hidden, values: cleared } = fieldVisibility(layout, this.#blocks, values);
        const names = new Map(flattenGroupFields(layout).map(block => [block.id, block.data.name as string]));
        for (const key of hidden) { const name = key.includes('/') ? undefined : names.get(key); if (name) { delete errors[name]; delete cleared[name]; } }
        if (Object.keys(errors).length) throw new CmsError('CMS_VALIDATION', Object.entries(errors).map(([name, error]) => `${fields[name]?.label ?? name} ${error}`).join(' '), { fields: errors });
        return cleared;
    }

    /** The field groups attached to a target, with their blocks, for editors. */
    fieldGroupsFor(target: FieldGroupTarget): FieldGroup[] {
        return this.#groupsFor(target);
    }

    /** Field names a group attached to the target cannot take: the target's own, core fields included. */
    #targetScope(target: FieldGroupTarget): string[] {
        switch (target.kind) {
            case 'collection': {
                const definition = this.#collections.get(target.name);
                return [...CORE_FIELDS, ...(definition?.taxonomies ?? []), ...Object.keys(definition?.fields ?? {})];
            }
            case 'taxonomy': return ['name', 'slug', 'description', 'parent', 'icon', 'path', 'depth', 'taxonomy'];
            case 'users': return ['email', 'name', 'avatar', 'status', 'roles', 'password'];
            case 'menus': return ['label', 'kind', 'url', 'collection', 'entry', 'taxonomy', 'term', 'newTab', 'className', 'attributes', 'children'];
        }
    }

    /** Save a field group: checked against the block types and each target's own fields, then the targets' schemas are planned. */
    async saveFieldGroup(input: FieldGroup, principal: Principal): Promise<FieldGroup> {
        this.#authorizeBuilder(principal);
        await this.ready({ force: true });
        const problems: string[] = [];
        for (const target of input.targets ?? []) {
            if (target.kind === 'collection' && !this.#collections.has(target.name)) problems.push(`Collection ${target.name} does not exist.`);
            if (target.kind === 'taxonomy' && !this.#taxonomies.has(target.name)) problems.push(`Taxonomy ${target.name} does not exist.`);
        }
        const scope = [...new Set((input.targets ?? []).flatMap(target => this.#targetScope(target)))];
        const checked = fieldGroupProblems(input, this.#blocks, scope);
        problems.push(...checked.problems);
        // Names are distinct across the groups of one target.
        for (const target of input.targets ?? []) for (const other of this.#groupsFor(target)) {
            if (other.id === input.id) continue;
            for (const name of Object.keys(fieldGroupDeclarations(other.blocks, this.#blocks))) if (Object.hasOwn(checked.fields, name)) problems.push(`Field ${name} is already in the group “${other.title}”.`);
        }
        for (const [name, declaration] of Object.entries(checked.fields)) {
            if (declaration.kind === 'reference' && !this.#resources.has(declaration.target!)) problems.push(`Field ${name} refers to ${declaration.target}, which does not exist.`);
            for (const type of declaration.blocks ?? []) if (!this.#blocks.has(type)) problems.push(`Field ${name} allows ${type}, which is not a block type.`);
        }
        if (problems.length) throw new CmsError('CMS_VALIDATION', problems.join(' '), { fields: { definition: problems.join(' ') } });
        const group: FieldGroup = {
            id: input.id, title: input.title.trim(), ...(input.description?.trim() ? { description: input.description.trim() } : {}),
            ...(input.placement ? { placement: input.placement } : {}), ...(input.order !== undefined ? { order: input.order } : {}),
            targets: [...input.targets], blocks: checked.blocks,
        };
        await this.fieldGroups.put(group, principal);
        await this.#migrateTargets(group, principal);
        return (await this.fieldGroups.get(group.id))!;
    }

    async deleteFieldGroup(id: string, principal: Principal): Promise<void> {
        this.#authorizeBuilder(principal);
        const group = await this.fieldGroups.get(id);
        if (!group) throw new CmsError('CMS_NOT_FOUND', 'Field group not found.');
        await this.fieldGroups.remove(id);
        await this.#migrateTargets(group, principal);
    }

    /** Re-resolve the collections a group touches and plan their schemas: indexes come and go, old values stay. */
    async #migrateTargets(group: FieldGroup, principal: Principal): Promise<void> {
        this.#activation = undefined;
        await this.ready({ force: true });
        const ids = group.targets.filter(target => target.kind === 'collection').map(target => `cms/${(target as { name: string }).name}`).filter(id => this.#resources.has(id));
        if (!ids.length) return;
        const resources = [...this.#resources.values()];
        const plan = await planSchema(resources, await readCatalog(this.db, resources.filter(entry => ids.includes(entry.id)).map(entry => entry.storage)));
        const blocked = plan.blocked.filter(problem => ids.includes(problem.resource));
        if (blocked.length) throw new CmsError('CMS_VALIDATION', blocked.map(problem => problem.message).join(' '));
        const report = await migrate(this.db, resources, { now: this.#now, only: ids });
        if (report.failed) throw new CmsError('CMS_CONFLICT', `The schema could not be updated: ${report.failed.message}`);
        void principal;
        this.#activation = undefined;
        await this.ready({ force: true });
    }

    /** Rebuild the registry from built-ins and stored definitions. Invalid stored definitions are skipped. */
    #apply(storedCollections: ReadonlyMap<string, CollectionDefinition>, storedTaxonomies: ReadonlyMap<string, TaxonomyDeclaration>): void {
        const taxonomies = new Map(this.#builtinTaxonomies);
        for (const [name, stored] of storedTaxonomies) {
            const builtin = this.#builtinTaxonomies.get(name);
            const next = builtin ? { ...builtin, label: stored.label ?? builtin.label, singular: stored.singular ?? builtin.singular, path: stored.path === undefined ? builtin.path : stored.path, ...(stored.description !== undefined ? { description: stored.description } : {}) } : { ...stored, builtin: false };
            if (!taxonomyProblems(next).length) taxonomies.set(name, Object.freeze(next));
        }
        const collections = new Map<string, CollectionDefinition>();
        for (const builtin of this.#builtinCollections.values()) {
            const stored = storedCollections.get(builtin.name);
            collections.set(builtin.name, stored ? extendCollection(builtin, stored) : builtin);
        }
        for (const [name, stored] of storedCollections) if (!this.#builtinCollections.has(name)) collections.set(name, { ...stored, builtin: false });
        const labels = Object.fromEntries([...taxonomies.values()].map(taxonomy => [taxonomy.name, taxonomy.label]));
        const resources = new Map(this.#static);
        const effective = new Map<string, CollectionDefinition>();
        for (const definition of collections.values()) {
            const known = { ...definition, taxonomies: (definition.taxonomies ?? []).filter(name => taxonomies.has(name)) };
            if (collectionProblems(known).length || this.#static.has(`cms/${known.name}`)) continue;
            try {
                const resource = this.#collectionResource(known, labels);
                const previous = this.#resources.get(resource.id);
                // Keep the same object when nothing changed, so callers holding it stay current. Field order counts.
                resources.set(resource.id, previous && canonicalJson(previous) === canonicalJson(resource) && sameKeyOrder(previous.fields, resource.fields) ? previous : resource);
                effective.set(known.name, Object.freeze(known));
            } catch { /* an invalid stored definition stays inactive */ }
        }
        this.#taxonomies = taxonomies;
        this.#collections = effective;
        this.#resources = resources;
        for (const id of this.#repositories.keys()) if (!resources.has(id)) this.#repositories.delete(id);
    }

    #hostTheme(plugin: HostedPlugin, groups: ReadonlySet<string>): ThemeInfo {
        const manifest = plugin.manifest.theme as ThemeManifest;
        const problems = [...plugin.problems];
        const parent = this.#parentOf(plugin);
        const parentManifest = parent?.manifest.theme as ThemeManifest | undefined;
        if (!problems.length && manifest?.extends) {
            if (manifest.extends === plugin.manifest.name) problems.push('A theme cannot extend itself.');
            else if (!parent) problems.push(`It extends ${manifest.extends}, which is not an installed theme.`);
            else if (parent.problems.length) problems.push(`Its parent theme ${manifest.extends} is invalid.`);
            else if (parentManifest?.extends) problems.push(`Its parent theme ${manifest.extends} extends another theme; themes extend one level.`);
        }
        if (!problems.length) problems.push(...siteThemeProblems(assembleSiteTheme(plugin.registration, parent?.registration)));
        // A child's options, locations and areas are layered over its parent's; its option values are its own.
        const inherited = manifest?.extends && parentManifest ? parentManifest : undefined;
        const fields = { ...inherited?.options, ...manifest?.options };
        const options = manifest && Object.keys(fields).length ? { id: plugin.manifest.name, label: manifest.label, permission: PERMISSIONS.manageAppearance, fields } : null;
        if (options && (groups.has(options.id) || !/^[a-z][a-z0-9-]{0,40}$/.test(options.id))) problems.push(`Its options need a settings group named ${options.id}, which is taken or too long.`);
        const named = (entries: { readonly [name: string]: string }) => Object.entries(entries).map(([name, label]) => ({ name, label }));
        return Object.freeze({
            name: plugin.registration.name, version: plugin.registration.version, ...authorOf(plugin),
            label: typeof manifest?.label === 'string' ? manifest.label : plugin.registration.name, description: typeof manifest?.description === 'string' ? manifest.description : '',
            locations: named({ ...inherited?.locations, ...manifest?.locations }), areas: named({ ...inherited?.areas, ...manifest?.areas }),
            parent: inherited ? manifest.extends! : null, ...artwork(plugin), options, presets: layerPresets(inherited?.presets, manifest?.presets), problems,
        });
    }

    /** Menu items for visitors: entries, archives and terms get their current titles and URLs; items whose target is gone are left out, their children move up. */
    async #resolveMenu(items: readonly MenuItem[], locale?: string): Promise<MenuItemView[]> {
        const languages = await this.languages();
        const translate = Boolean(locale && languages.multilingual);
        const entries = new Map<string, Set<string>>();
        const terms = new Set<string>();
        const collect = (list: readonly MenuItem[]) => {
            for (const item of list) {
                if (item.kind === 'entry' && item.collection && item.entry) entries.set(item.collection, (entries.get(item.collection) ?? new Set()).add(item.entry));
                if (item.kind === 'term' && item.term) terms.add(item.term);
                collect(item.children);
            }
        };
        collect(items);
        const found = new Map<string, { title: string; url: string | null }>();
        for (const [name, ids] of entries) {
            const collection = this.#collections.get(name);
            if (!collection) continue;
            try {
                const records = await this.resource(`cms/${name}`).getMany([...ids], { principal: ANONYMOUS });
                // In another language, an entry item shows the entry's translation when there is one.
                const shown = new Map<string, RecordShape>();
                for (const record of records.values()) shown.set(record.id, translate ? (await this.translations(collection, record)).get(locale!) ?? record : record);
                const urls = await this.entryUrls(collection, [...shown.values()]);
                for (const [id, record] of shown) found.set(`${name}:${id}`, { title: recordTitle(record, 'title'), url: urls.get(record.id) ?? null });
            } catch (error) {
                if (!(error instanceof CmsError)) throw error;
            }
        }
        const termRows = terms.size ? await this.taxonomies.getMany([...terms]) : new Map();
        const archives = new Map<string, string | null>();
        const visitArchives = async (list: readonly MenuItem[]): Promise<void> => {
            for (const item of list) {
                const collection = item.kind === 'archive' && item.collection ? this.#collections.get(item.collection) : undefined;
                if (collection && !archives.has(collection.name)) archives.set(collection.name, await this.archiveUrl(collection, translate ? locale : null));
                await visitArchives(item.children);
            }
        };
        await visitArchives(items);
        const resolve = (list: readonly MenuItem[]): MenuItemView[] => list.flatMap(item => {
            const children = resolve(item.children);
            let target: { title: string; url: string | null } | undefined;
            if (item.kind === 'link') target = { title: item.label, url: item.url ?? null };
            else if (item.kind === 'entry') target = found.get(`${item.collection}:${item.entry}`);
            else if (item.kind === 'archive') {
                const collection = item.collection ? this.#collections.get(item.collection) : undefined;
                const url = collection ? archives.get(collection.name) : null;
                target = collection && url ? { title: collection.label, url } : undefined;
            } else {
                const term = termRows.get(item.term ?? '');
                const taxonomy = term && term.taxonomy === item.taxonomy ? this.#taxonomies.get(term.taxonomy) : undefined;
                target = term && taxonomy?.path ? { title: term.name, url: `${translate ? this.localePrefix(locale, languages) : ''}/${taxonomy.path}/${term.slug}` } : undefined;
            }
            if (!target?.url) return children;
            return [Object.freeze({ id: item.id, label: item.label || target.title, url: target.url, newTab: item.newTab === true, kind: item.kind,
                className: item.className ?? '', attributes: Object.freeze({ ...item.attributes }), meta: Object.freeze({ ...item.meta }), children: Object.freeze(children) })];
        });
        return resolve(items);
    }

    #host(registration: PluginRegistrationLike): void {
        const manifest = (registration.manifest ?? { schemaVersion: 1, name: registration.name, version: registration.version }) as CmsPluginManifest;
        const problems = manifestProblems(manifest);
        if (manifest.name !== registration.name) problems.push(`The manifest names ${String(manifest.name)}, not ${registration.name}.`);
        const resources: string[] = [];
        if (!problems.length) {
            for (const declaration of manifest.resources ?? []) resources.push(this.#register(resolveResource({ ...declaration, owner: registration.name }, registration.name)).id);
        }
        this.#plugins.set(registration.name, { registration, manifest, problems, resources, requested: problems.length ? [] : requestedGrants(manifest), commands: new Map() });
    }

    #registerPlugin(plugin: HostedPlugin): void {
        const register = plugin.registration.module?.register;
        if (plugin.problems.length || typeof register !== 'function') return;
        const name = plugin.manifest.name;
        const active = () => this.pluginActive(name);
        const declared = new Set((plugin.manifest.hooks ?? []).map(hook => hook.point));
        const declaredCommands = new Set((plugin.manifest.commands ?? []).map(command => command.name));
        const checkHook = (point: string) => {
            if (!declared.has(point)) throw new Error(`Plugin ${name} registers ${point}, which its manifest does not declare in hooks.`);
        };
        const context: PluginContext = {
            name,
            version: plugin.manifest.version,
            resources: plugin.resources,
            hooks: {
                // A disabled, unmigrated or ungranted plugin's handlers do not run.
                addAction: (point, handler, options = {}) => {
                    checkHook(point.name);
                    this.hooks.addAction(point, async (payload, ctx) => { if (await active()) await handler(payload, ctx); }, { ...options, plugin: name });
                },
                addFilter: (point, handler, options = {}) => {
                    checkHook(point.name);
                    this.hooks.addFilter(point, async (value, ctx) => await active() ? handler(value, ctx) : value, { ...options, plugin: name });
                },
            },
            commands: {
                add: (command, handler) => {
                    if (!declaredCommands.has(command)) throw new Error(`Plugin ${name} adds command ${command}, which its manifest does not declare.`);
                    plugin.commands.set(command, handler);
                },
            },
            cms: this.pluginCms(name),
            fetch: async (input, init) => {
                const url = new URL(input instanceof Request ? input.url : String(input));
                const granted = (await this.#state()).grants.get(`plugin:${name}`) ?? new Set<string>();
                const hosts = [...granted].filter(grant => grant.startsWith('network:')).map(grant => grant.slice('network:'.length));
                if (!hosts.some(host => host === url.hostname || (host.startsWith('*.') && url.hostname.endsWith(host.slice(1))))) {
                    throw new CmsError('CMS_FORBIDDEN', `Plugin ${name} is not granted network access to ${url.hostname}.`);
                }
                return this.#fetch(input, init);
            },
        };
        (register as (context: PluginContext) => void)(context);
    }

    async #pluginStatus(plugin: HostedPlugin, state: Activation): Promise<PluginStatus> {
        const themeOnly = isThemeOnly(plugin.manifest);
        const base = { name: plugin.registration.name, version: plugin.registration.version, description: typeof plugin.manifest.description === 'string' ? plugin.manifest.description : '', ...authorOf(plugin), ...artwork(plugin), themeOnly };
        if (plugin.problems.length) return { ...base, active: false, reason: `Invalid manifest: ${plugin.problems.join(' ')}`, missing: [] };
        // A theme alone runs nothing on the server: choosing it under Appearance is all it needs.
        if (themeOnly) return { ...base, active: true, missing: [] };
        const unmigrated: string[] = [];
        for (const id of [...plugin.resources, ...(plugin.manifest.collections ?? []).map(collection => `cms/${collection.name}`)]) {
            const resource = this.#resources.get(id);
            if (!resource || state.hashes.get(id) !== await declarationHash(resource)) unmigrated.push(id);
        }
        const granted = state.grants.get(`plugin:${plugin.manifest.name}`) ?? new Set<string>();
        const missing = [PLUGIN_ENABLED, ...plugin.requested].filter(grant => !granted.has(grant));
        if (unmigrated.length) return { ...base, active: false, reason: `Waiting for a migration of ${unmigrated.join(', ')}.`, missing };
        if (missing.length) return { ...base, active: false, reason: granted.size ? `Needs a new grant for ${missing.join(', ')}.` : 'Not enabled.', missing };
        return { ...base, active: true, missing: [] };
    }

    #state(): Promise<Activation> {
        const now = this.#now();
        if (!this.#activation || now - this.#activation.at > this.#activationTtl) {
            const state = this.db.read([
                { rql: 'SELECT resource, declaration_hash FROM cms_schema_state ORDER BY resource LIMIT 1000' },
                { rql: "SELECT subject, permission FROM cms_grants WHERE subject LIKE 'plugin:%' ORDER BY subject, permission LIMIT 1000" },
                { rql: "SELECT version FROM cms_migrations WHERE kind = 'host' LIMIT 100" },
            ]).then(result => {
                const grants = new Map<string, Set<string>>();
                for (const [subject, permission] of result.results[1]!.rows) {
                    const set = grants.get(subject as string) ?? new Set<string>();
                    set.add(permission as string);
                    grants.set(subject as string, set);
                }
                return {
                    hashes: new Map(result.results[0]!.rows.map(([resource, hash]) => [resource as string, hash as string])), grants,
                    hostVersions: new Set(result.results[2]!.rows.map(([version]) => Number(version as bigint))),
                };
            }).catch(error => {
                // Before the first migration the host tables do not exist yet.
                if (/cms_schema_state|cms_grants|cms_migrations|no such table|not found/i.test(String((error as Error).message))) return { hashes: new Map<string, string>(), grants: new Map<string, Set<string>>(), hostVersions: new Set<number>() };
                throw error;
            });
            this.#activation = { at: now, state };
            state.catch(() => { this.#activation = undefined; });
        }
        return this.#activation.state;
    }
}

function sameKeyOrder(a: object, b: object): boolean {
    return Object.keys(a).join('\n') === Object.keys(b).join('\n');
}

/** Where a visitor's comment goes: spam for disallowed words, held for links or moderation rules, else approved. */
function writeActorOf(principal: Principal): WriteActor {
    return { kind: principal.kind, id: principalId(principal) };
}

async function commentStatus(fields: { content: string; authorName: string; authorEmail: string; authorUrl: string }, settings: SiteSettings, approvedBefore: () => Promise<boolean>): Promise<CommentStatus> {
    const text = `${fields.content}\n${fields.authorName}\n${fields.authorEmail}\n${fields.authorUrl}`.toLowerCase();
    const blocked = settings['discussion.blockedWords'].split('\n').map(word => word.trim().toLowerCase()).filter(Boolean);
    if (blocked.some(word => text.includes(word))) return 'spam';
    const links = (fields.content.match(/https?:\/\//gi) ?? []).length;
    if (settings['discussion.maxLinks'] > 0 && links >= settings['discussion.maxLinks']) return 'pending';
    const moderation = settings['discussion.moderation'];
    if (moderation === 'all') return 'pending';
    if (moderation === 'first') return await approvedBefore() ? 'approved' : 'pending';
    return 'approved';
}

/** A plugin's theme loaders, from its `server.ts` `loaders` export. */
function loadersOf(plugin: HostedPlugin): ThemeLoaders {
    const loaders = plugin.registration.module?.loaders;
    return loaders && typeof loaders === 'object' ? Object.fromEntries(Object.entries(loaders).filter(([, loader]) => typeof loader === 'function')) as ThemeLoaders : {};
}

/** A plugin that only ships a theme: no resources, blocks, hooks, commands, slots or permissions. */
function isThemeOnly(manifest: CmsPluginManifest): boolean {
    return manifest.theme !== undefined && !manifest.resources?.length && !manifest.collections?.length && !manifest.blocks?.length && !manifest.hooks?.length && !manifest.commands?.length
        && !Object.keys(manifest.ui?.slots ?? {}).length && !Object.keys(manifest.permissions?.resources ?? {}).length && !manifest.permissions?.network?.length && !manifest.permissions?.define?.length;
}

/** The plugin's logo and cover: the manifest's files, else `assets/logo.*` and `assets/cover.*`. */
function authorOf(plugin: HostedPlugin): { author: string; authorUrl: string } {
    return { author: typeof plugin.manifest.author === 'string' ? plugin.manifest.author.trim() : '', authorUrl: typeof plugin.manifest.authorUrl === 'string' ? plugin.manifest.authorUrl : '' };
}

function artwork(plugin: HostedPlugin): { logo: string | null; cover: string | null } {
    const assets = plugin.registration.assets ?? {};
    const pick = (declared: unknown, name: string) => (typeof declared === 'string' ? assets[declared] : undefined)
        ?? ['svg', 'png', 'webp', 'jpg', 'jpeg', 'gif', 'avif'].map(extension => assets[`assets/${name}.${extension}`]).find(Boolean) ?? null;
    return { logo: pick(plugin.manifest.logo, 'logo'), cover: pick(plugin.manifest.cover, 'cover') };
}

export function createCMS(options: CmsOptions): CmsHost {
    return new CmsHost(options);
}

/** Client address and browser of a sign-in, from a Hono context, for the sessions list. */
function requestMetadata(context: unknown): { ip?: string; userAgent?: string } {
    const request = (context as { req?: { header(name: string): string | undefined } } | undefined)?.req;
    if (!request || typeof request.header !== 'function') return {};
    const ip = request.header('cf-connecting-ip') ?? request.header('x-forwarded-for')?.split(',')[0]?.trim();
    const userAgent = request.header('user-agent');
    return { ...(ip ? { ip } : {}), ...(userAgent ? { userAgent } : {}) };
}
