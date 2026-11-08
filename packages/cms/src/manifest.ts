/**
 * The CMS fields of a plugin manifest (`cossack-plugin.json`), validated as data. A plugin
 * package never executes during installation; the host trusts what the manifest declares
 * only after this check, the policy lints and an administrator's grant.
 */
import { blockProblems, CORE_BLOCKS, flattenBlocks, validateBlocks, type Block, type BlockDeclaration } from './blocks';
import { blocksShapeProblem } from './block-shape';
import { collectionProblems, LOCALE, type CollectionDefinition } from './collections';
import { editorLayoutProblems, editorLayoutShapeProblem } from './editor-layout';
import { FIELD_BLOCKS, fieldGroupProblems, type FieldGroup } from './field-groups';
import { defineAction, defineFilter, type ExtensionPoint } from '@cossackframework/core/hooks';
import { cronProblem } from './cron';
import { EXTENSION_POINTS } from './hooks';
import { OWNER_NAME, resourceProblems, type ResourceAction, type ResourceDeclaration } from './resource';
import { themeProblems, type ThemeManifest } from './theme';
import { pluginSettingsProblems, type PluginSettingsDeclaration } from './plugin-settings';

export interface CommandOption {
    readonly type: 'string' | 'number' | 'boolean';
    readonly description?: string;
    readonly required?: boolean;
}

export interface PluginCommand {
    /** Lowercase name: `cossack <plugin>:<name>`. */
    readonly name: string;
    readonly description: string;
    readonly options?: { readonly [name: string]: CommandOption };
    /** Permission the operator needs, in addition to the dashboard. */
    readonly permission?: string;
}

/** What `permissions.users` lets a plugin do with the site's members. */
export type UserAction = 'read' | 'write';
/** Capabilities a manifest switches on in `permissions`; each is the grant `capability:<name>`. */
export const CAPABILITIES = Object.freeze(['files', 'mail', 'jobs', 'cache', 'ai', 'payments', 'unrestricted'] as const);
export type Capability = (typeof CAPABILITIES)[number];
/** The grant that lifts every limit, from `permissions.unrestricted`. */
export const UNRESTRICTED_GRANT = 'capability:unrestricted';
/** A job the clock queues: `cron` is five UTC fields as Cloudflare reads them (1 = Sunday); `name` is the job handler. */
export interface PluginSchedule {
    readonly name: string;
    readonly cron: string;
    readonly description?: string;
}

/** An extension point a plugin defines. */
export interface ProvidedPoint {
    /** `<plugin>.<name>`, such as `shop.order-placed`. */
    readonly point: string;
    readonly kind: 'action' | 'filter';
    /** Incremented for incompatible payload or value changes. */
    readonly version: number;
    /** Per-handler deadline in milliseconds. Default 5000. */
    readonly timeoutMs?: number;
    readonly description?: string;
}

export interface SlotLink {
    readonly label: string;
    readonly href: string;
    readonly permission?: string;
}

/** A plugin's maker as its manifest names them. */
export interface PluginAuthor {
    readonly name: string;
    readonly url?: string;
    readonly email?: string;
}

export interface CmsPluginManifest {
    readonly schemaVersion: 1;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    /** Who made the plugin, shown on its card: a name, with a website and an email address. */
    readonly author?: PluginAuthor;
    readonly compatibility?: { readonly [pkg: string]: string };
    readonly dependencies?: { readonly [pkg: string]: string };
    readonly resources?: readonly ResourceDeclaration[];
    /**
     * Site collections, such as a portfolio theme's `projects`: entries with URLs, an archive
     * and a dashboard section like posts, stored as `cms/<name>`. Migrated and granted with the plugin.
     */
    readonly collections?: readonly Omit<CollectionDefinition, 'builtin' | 'plugin'>[];
    /** Block types named `<plugin>/<name>`; `ui.ts` renders them through its `blocks` export. */
    readonly blocks?: readonly BlockDeclaration[];
    /**
     * Field groups the plugin ships, with IDs starting with `<plugin>-`: meta boxes attached to
     * collections, taxonomies, users or menus. They are stored with the other groups when the
     * plugin is granted (an upgrade replaces them), tagged with the plugin and read-only in the
     * dashboard; their fields stay with the entries.
     */
    readonly fieldGroups?: readonly Omit<FieldGroup, 'plugin'>[];
    /**
     * Patterns the plugin ships: sections of core blocks and its own, offered in the pattern
     * picker and as starting layouts. Stored once as `<plugin>-<slug>` when the plugin is
     * granted or the theme activated; a pattern the site already has is left as it is.
     */
    readonly patterns?: readonly ManifestPattern[];
    /**
     * Tabs and sidebar boxes the plugin adds to a collection's entry editor while it is active:
     * a partial editor layout per collection, its own or another's. Tab IDs are prefixed with the
     * plugin's name; a layout the administrator saved keeps a tab it already placed.
     */
    readonly editor?: readonly { readonly collection: string; readonly tabs?: readonly Block[]; readonly sidebar?: readonly Block[] }[];
    /**
     * Extension points the plugin's server code registers handlers for: the CMS's own, or those
     * another installed plugin `provides`. Each needs the `hook:<point>` grant.
     */
    readonly hooks?: readonly { readonly point: string; readonly version: number }[];
    /**
     * Extension points the plugin defines for other plugins, named `<plugin>.<point>`. The host
     * builds them from this list; the plugin invokes them through `context.hooks.doAction` and
     * `applyFilters`, and a consumer looks one up by name with `context.hooks.point()`.
     */
    readonly provides?: readonly ProvidedPoint[];
    readonly permissions?: {
        /** Access to resources the plugin does not own: `{ "cms/posts": ["read"] }`. */
        readonly resources?: { readonly [resource: string]: readonly ResourceAction[] };
        /** Hosts the plugin's server code may contact, such as `api.example.com`. */
        readonly network?: readonly string[];
        /** Permissions the plugin defines for roles, named `<plugin>:<name>`. */
        readonly define?: readonly string[];
        /** Library files the plugin owns, through `context.files`. */
        readonly files?: boolean;
        /** Email sent as the site, through `context.mail`. */
        readonly mail?: boolean;
        /** Work queued for later, and the manifest's `schedules`, through `context.jobs`. */
        readonly jobs?: boolean;
        /** A namespace in the site's cache, through `context.cache`. */
        readonly cache?: boolean;
        /** The application's AI provider, through `context.ai`. */
        readonly ai?: boolean;
        /** Checkouts with the application's payments provider, through `context.payments`; `cms.payment.event` brings the results. */
        readonly payments?: boolean;
        /** No limits: `context.unrestricted()` gives the database, the host and every binding, and the policy lint steps aside. Installing and granting it each carry a danger warning. */
        readonly unrestricted?: boolean;
        /** The site's members through `context.users`: `read` them; `write` creates members and keeps the plugin's meta on them. */
        readonly users?: readonly UserAction[];
        /** Names of the application's bindings the plugin reads through `context.secrets`, such as `STRIPE_SECRET_KEY`. */
        readonly secrets?: readonly string[];
    };
    readonly ui?: {
        /** Links shown in dashboard slots, such as `dashboard.nav`. */
        readonly slots?: { readonly [slot: string]: readonly SlotLink[] };
    };
    readonly commands?: readonly PluginCommand[];
    /** Jobs the clock queues while the plugin is active; needs `permissions.jobs`. */
    readonly schedules?: readonly PluginSchedule[];
    /** Scalar options rendered under Settings → Plugins in the plugin's own namespace. */
    readonly settings?: PluginSettingsDeclaration;
    /** A site theme: its `templates/` files (or `ui.ts` `theme` export) are the site templates. */
    readonly theme?: ThemeManifest;
    /** A square image in the plugin's `assets/` directory, such as `assets/logo.png`. Default: `assets/logo.*`. */
    readonly logo?: string;
    /** A 4:3 image for the Plugins and Themes screens, such as `assets/cover.png`. Default: `assets/cover.*`. */
    readonly cover?: string;
    /**
     * The interface languages the plugin translates, such as `["vi"]`: a language pack's
     * `translations/<code>.json` (the application's text) and `translations/<code>/<plugin>.json`
     * (another plugin's). Each code needs its directory or file.
     */
    readonly translations?: readonly string[];
    /** Rendered by `cossack add plugin`: the npm package the plugin came from. */
    readonly package?: string;
    readonly [field: string]: unknown;
}

/**
 * Host slots plugins can fill with `ui.slots` links: the dashboard navigation, the dashboard's
 * taskbar and the site's taskbar signed-in users see. `dashboard.overview` takes components, from
 * the plugin's `ui.ts` `slots` export.
 */
export const HOST_SLOTS = Object.freeze(['dashboard.nav', 'dashboard.overview', 'dashboard.taskbar', 'site.taskbar'] as const);
export type HostSlot = (typeof HOST_SLOTS)[number];

/** A pattern a plugin ships, stored as `<plugin>-<slug>` in the patterns collection. */
export interface ManifestPattern {
    /** 1 to 40 lowercase letters, digits and hyphens. */
    readonly slug: string;
    readonly title: string;
    /** Changes to the stored pattern show everywhere it is used. Off by default: editors get a copy to change. */
    readonly synced?: boolean;
    /** Collections whose new entries may start from the pattern. */
    readonly starter?: readonly string[];
    readonly blocks: readonly Block[];
}
const PATTERN_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const KNOWN_FIELDS = new Set(['schemaVersion', 'name', 'version', 'description', 'author', 'authorUrl', 'compatibility', 'dependencies', 'resources', 'collections', 'blocks', 'fieldGroups', 'patterns', 'editor', 'hooks', 'permissions', 'ui', 'provides', 'commands', 'schedules', 'settings', 'theme', 'logo', 'cover', 'translations', 'package', 'source']);
const COLLECTION_NAME = /^[a-z][a-zA-Z0-9_]{0,40}$/;
const ARTWORK = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(?:png|jpe?g|webp|gif|avif|svg)$/;
const HOST = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$/;
const ACTIONS = new Set(['read', 'create', 'update', 'delete']);
const USER_ACTIONS = new Set(['read', 'write']);
const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
/** Bindings the host and the application own; a plugin names its own. */
const RESERVED_SECRET = /^(?:ROMEDB_|APP_|CMS_|CLOUDFLARE_|SMTP_|S3_|TURNSTILE_|OAUTH_|COSSACK_)|^(?:MAIL_FROM|EMAIL|AI|DB|KV|R2|STORAGE)$/;
const SCHEDULE_NAME = /^[a-z][a-z0-9-]{0,40}$/;
/** An extension point name, as `@cossackframework/core/hooks` accepts it. */
const POINT = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

/** Whether a point name belongs to a plugin rather than the CMS: `<plugin>.<name>` with a plugin prefix other than `cms`. */
export function isPluginPoint(point: string): boolean {
    return POINT.test(point) && point.includes('.') && !point.startsWith('cms.');
}

/** The plugin a point name belongs to: the segment before its first dot. */
export function pointOwner(point: string): string {
    return point.slice(0, point.indexOf('.'));
}

/** The extension points a manifest provides, built for the hook registry. Call on a valid manifest. */
export function providedPoints(manifest: CmsPluginManifest): ExtensionPoint[] {
    return (manifest.provides ?? []).map(declaration => {
        const options = { version: declaration.version, ...(declaration.timeoutMs !== undefined ? { timeoutMs: declaration.timeoutMs } : {}) };
        return declaration.kind === 'action' ? defineAction(declaration.point, options) : defineFilter(declaration.point, options);
    });
}

/** Problems with a manifest's CMS fields. Empty when it can be hosted. */
export function manifestProblems(manifest: unknown): string[] {
    const problems: string[] = [];
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return ['The manifest must be an object.'];
    const value = manifest as CmsPluginManifest;
    if (value.schemaVersion !== 1) problems.push('schemaVersion must be 1.');
    if (typeof value.name !== 'string' || !OWNER_NAME.test(value.name) || value.name.length > 64) problems.push('name must be a plugin name.');
    if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)) problems.push('version must be a semantic version.');
    for (const key of Object.keys(value)) if (!KNOWN_FIELDS.has(key)) problems.push(`${key} is not a manifest field.`);
    if (value.settings !== undefined) problems.push(...pluginSettingsProblems(value.settings));
    if (value.translations !== undefined && (!Array.isArray(value.translations) || value.translations.length > 50 || new Set(value.translations).size !== value.translations.length
        || value.translations.some(code => typeof code !== 'string' || !LOCALE.test(code)))) problems.push('translations lists at most 50 distinct language codes, such as vi or pt-br.');
    const name = value.name;
    const resourceNames = new Set<string>();
    for (const [index, resource] of (Array.isArray(value.resources) ? value.resources : value.resources === undefined ? [] : [null]).entries()) {
        if (!resource || typeof resource !== 'object') { problems.push(`resources[${index}] must be a resource declaration.`); continue; }
        if (resource.owner !== undefined && resource.owner !== name) problems.push(`resources[${index}] must belong to the plugin.`);
        for (const problem of resourceProblems({ ...resource, owner: name })) problems.push(`resource ${resource.name}: ${problem}`);
        if (resourceNames.has(resource.name)) problems.push(`resource ${resource.name} is declared twice.`);
        resourceNames.add(resource.name);
    }
    const collectionNames = new Set<string>();
    for (const [index, collection] of (Array.isArray(value.collections) ? value.collections : value.collections === undefined ? [] : [null]).entries()) {
        if (!collection || typeof collection !== 'object') { problems.push(`collections[${index}] must be a collection definition.`); continue; }
        if ('builtin' in collection || 'plugin' in collection) problems.push(`collection ${collection.name}: builtin and plugin are set by the host.`);
        for (const problem of collectionProblems(collection as CollectionDefinition)) problems.push(`collection ${collection.name}: ${problem}`);
        if (collectionNames.has(collection.name)) problems.push(`collection ${collection.name} is declared twice.`);
        collectionNames.add(collection.name);
    }
    const blockNames = new Set<string>();
    for (const [index, block] of (Array.isArray(value.blocks) ? value.blocks : value.blocks === undefined ? [] : [null]).entries()) {
        if (!block || typeof block !== 'object') { problems.push(`blocks[${index}] must be a block declaration.`); continue; }
        problems.push(...blockProblems(block, name));
        if (blockNames.has(block.name)) problems.push(`block ${block.name} is declared twice.`);
        blockNames.add(block.name);
    }
    // Groups are checked against the core and field blocks here; the host checks them against every block type when it stores them.
    const groupTypes = new Map([...CORE_BLOCKS, ...FIELD_BLOCKS].map(block => [block.name, block]));
    const groupIds = new Set<string>();
    for (const [index, group] of (Array.isArray(value.fieldGroups) ? value.fieldGroups : value.fieldGroups === undefined ? [] : [null]).entries()) {
        if (!group || typeof group !== 'object') { problems.push(`fieldGroups[${index}] must be a field group.`); continue; }
        const id = String(group.id);
        if ('plugin' in group) problems.push(`field group ${id}: plugin is set by the host.`);
        if (typeof group.id !== 'string' || !group.id.startsWith(`${name}-`)) problems.push(`field group ${id}: IDs start with ${name}-.`);
        for (const problem of fieldGroupProblems(group as FieldGroup, groupTypes).problems) problems.push(`field group ${id}: ${problem}`);
        if (groupIds.has(id)) problems.push(`field group ${id} is declared twice.`);
        groupIds.add(id);
    }
    // Patterns hold core blocks and the plugin's own; the host checks them against every active type when it stores them.
    const patternTypes = new Map([...CORE_BLOCKS, ...(Array.isArray(value.blocks) ? value.blocks as BlockDeclaration[] : [])].filter(block => block && typeof block.name === 'string').map(block => [block.name, block]));
    const patternSlugs = new Set<string>();
    const patterns = Array.isArray(value.patterns) ? value.patterns : value.patterns === undefined ? [] : [null];
    if (patterns.length > 24) problems.push('patterns lists at most 24 patterns.');
    for (const [index, pattern] of patterns.entries()) {
        if (!pattern || typeof pattern !== 'object') { problems.push(`patterns[${index}] must be a pattern.`); continue; }
        const slug = String(pattern.slug);
        if (typeof pattern.slug !== 'string' || !PATTERN_SLUG.test(pattern.slug) || pattern.slug.length > 40) problems.push(`patterns[${index}]: slug is 1 to 40 lowercase letters, digits and hyphens.`);
        else if (patternSlugs.has(slug)) problems.push(`pattern ${slug} is declared twice.`);
        patternSlugs.add(slug);
        if (typeof pattern.title !== 'string' || !pattern.title.trim() || pattern.title.length > 120) problems.push(`pattern ${slug}: needs a title of at most 120 characters.`);
        if (pattern.synced !== undefined && typeof pattern.synced !== 'boolean') problems.push(`pattern ${slug}: synced is on or off.`);
        if (pattern.starter !== undefined && (!Array.isArray(pattern.starter) || !pattern.starter.every((entry: unknown) => typeof entry === 'string' && COLLECTION_NAME.test(entry)))) problems.push(`pattern ${slug}: starter lists collection names.`);
        const shape = blocksShapeProblem(pattern.blocks);
        if (shape) { problems.push(`pattern ${slug}: blocks ${shape}`); continue; }
        if (!(pattern.blocks as unknown[]).length) problems.push(`pattern ${slug}: needs at least one block.`);
        for (const [path, error] of Object.entries(validateBlocks(pattern.blocks as Block[], patternTypes).errors)) problems.push(`pattern ${slug}: block ${path} ${error}`);
    }
    const editorCollections = new Set<string>();
    for (const [index, entry] of (Array.isArray(value.editor) ? value.editor : value.editor === undefined ? [] : [null]).entries()) {
        if (!entry || typeof entry !== 'object' || typeof entry.collection !== 'string' || !COLLECTION_NAME.test(entry.collection)) { problems.push(`editor[${index}] must name a collection.`); continue; }
        const layout = { tabs: entry.tabs ?? [], sidebar: entry.sidebar ?? [] };
        const shape = editorLayoutShapeProblem(layout);
        if (shape) problems.push(`editor ${entry.collection}: the layout ${shape}`);
        else problems.push(...editorLayoutProblems(layout, { partial: true }).problems.map(problem => `editor ${entry.collection}: ${problem}`));
        if (editorCollections.has(entry.collection)) problems.push(`editor ${entry.collection} is declared twice.`);
        editorCollections.add(entry.collection);
    }
    const provided = new Set<string>();
    for (const [index, declaration] of (Array.isArray(value.provides) ? value.provides : value.provides === undefined ? [] : [null]).entries()) {
        if (!declaration || typeof declaration !== 'object') { problems.push(`provides[${index}] must be an extension point declaration.`); continue; }
        const point = String(declaration.point);
        if (typeof declaration.point !== 'string' || !isPluginPoint(declaration.point) || pointOwner(declaration.point) !== name) problems.push(`provides: ${point} must be named ${name}.<name>.`);
        else if (provided.has(point)) problems.push(`provides: ${point} is declared twice.`);
        provided.add(point);
        if (declaration.kind !== 'action' && declaration.kind !== 'filter') problems.push(`provides: ${point} must be an action or a filter.`);
        if (!Number.isSafeInteger(declaration.version) || declaration.version < 1) problems.push(`provides: ${point} needs a version of 1 or more.`);
        if (declaration.timeoutMs !== undefined && (!Number.isSafeInteger(declaration.timeoutMs) || declaration.timeoutMs < 1 || declaration.timeoutMs > 600_000)) problems.push(`provides: ${point} timeoutMs must be 1 to 600000.`);
        if (declaration.description !== undefined && (typeof declaration.description !== 'string' || declaration.description.length > 300)) problems.push(`provides: ${point} description is at most 300 characters.`);
    }
    const points = new Map(EXTENSION_POINTS.map(point => [point.name, point.version]));
    for (const hook of value.hooks ?? []) {
        const point = hook?.point;
        // A plugin's point is checked against its provider when the host loads both.
        if (typeof point === 'string' && isPluginPoint(point)) {
            if (!Number.isSafeInteger(hook.version) || hook.version < 1) problems.push(`hooks: ${point} needs a version of 1 or more.`);
        } else if (!points.has(point)) problems.push(`hooks: ${String(point)} is not a CMS extension point.`);
        else if (hook.version !== points.get(point)) problems.push(`hooks: ${point} is version ${points.get(point)}, not ${String(hook.version)}.`);
    }
    const permissions = value.permissions ?? {};
    for (const [resource, actions] of Object.entries(permissions.resources ?? {})) {
        if (!/^[a-z][a-z0-9-]*\/[a-z][a-z0-9_]*$/.test(resource)) problems.push(`permissions.resources: ${resource} is not a resource ID.`);
        if (!Array.isArray(actions) || !actions.length || actions.some(action => !ACTIONS.has(action))) problems.push(`permissions.resources.${resource} must list read, create, update or delete.`);
    }
    for (const host of permissions.network ?? []) if (typeof host !== 'string' || !HOST.test(host)) problems.push(`permissions.network: ${String(host)} is not a host name.`);
    for (const permission of permissions.define ?? []) {
        if (typeof permission !== 'string' || !permission.startsWith(`${name}:`) || !/^[a-z0-9-]+:[a-z][a-z0-9._-]{0,63}$/.test(permission)) problems.push(`permissions.define: ${String(permission)} must be named ${name}:<name>.`);
    }
    for (const capability of CAPABILITIES) if (permissions[capability] !== undefined && typeof permissions[capability] !== 'boolean') problems.push(`permissions.${capability} is true or false.`);
    if (permissions.users !== undefined && (!Array.isArray(permissions.users) || !permissions.users.length || permissions.users.some(action => !USER_ACTIONS.has(action)))) problems.push('permissions.users must list read or write.');
    if (permissions.secrets !== undefined && !Array.isArray(permissions.secrets)) problems.push('permissions.secrets must list binding names.');
    for (const secret of Array.isArray(permissions.secrets) ? permissions.secrets : []) {
        if (typeof secret !== 'string' || !SECRET_NAME.test(secret)) problems.push(`permissions.secrets: ${String(secret)} must be an upper-case binding name.`);
        else if (RESERVED_SECRET.test(secret)) problems.push(`permissions.secrets: ${secret} belongs to the host.`);
    }
    const schedules = Array.isArray(value.schedules) ? value.schedules : value.schedules === undefined ? [] : [null];
    if (schedules.length > 20) problems.push('schedules: at most 20.');
    if (schedules.length && permissions.jobs !== true && permissions.unrestricted !== true) problems.push('schedules need permissions.jobs.');
    const scheduleNames = new Set<string>();
    for (const [index, schedule] of schedules.entries()) {
        if (!schedule || typeof schedule !== 'object') { problems.push(`schedules[${index}] must be an object.`); continue; }
        if (typeof schedule.name !== 'string' || !SCHEDULE_NAME.test(schedule.name)) problems.push(`schedules[${index}] needs a name of lowercase letters, digits and hyphens.`);
        else if (scheduleNames.has(schedule.name)) problems.push(`schedules: ${schedule.name} is listed twice.`);
        else scheduleNames.add(schedule.name);
        const problem = cronProblem(schedule.cron);
        if (problem) problems.push(`schedules[${index}]: cron ${problem}`);
        if (schedule.description !== undefined && (typeof schedule.description !== 'string' || schedule.description.length > 200)) problems.push(`schedules[${index}]: description is up to 200 characters.`);
    }
    for (const [slot, links] of Object.entries(value.ui?.slots ?? {})) {
        if (!(HOST_SLOTS as readonly string[]).includes(slot)) problems.push(`ui.slots: ${slot} is not a host slot (${HOST_SLOTS.join(', ')}).`);
        for (const link of Array.isArray(links) ? links : []) {
            if (typeof link?.label !== 'string' || !link.label || link.label.length > 60) problems.push(`ui.slots.${slot}: links need a label.`);
            if (typeof link?.href !== 'string' || !link.href.startsWith('/') || link.href.startsWith('//')) problems.push(`ui.slots.${slot}: link ${String(link?.label)} needs a same-site path.`);
        }
    }
    if (value.theme !== undefined) {
        problems.push(...themeProblems(value.theme));
        // An area's default blocks: checked like a saved area against the core types. A plugin's block is checked when its plugin is active, so here it only has to be a block.
        for (const [area, entry] of Object.entries((value.theme as ThemeManifest | null)?.areas ?? {})) {
            const blocks = entry && typeof entry === 'object' ? entry.blocks : undefined;
            if (!Array.isArray(blocks) || blocksShapeProblem(blocks)) continue;
            const types = new Map<string, BlockDeclaration>(CORE_BLOCKS.map(block => [block.name, block]));
            for (const block of flattenBlocks(blocks)) if (!types.has(block.type)) types.set(block.type, { name: block.type, label: block.type, fields: {}, children: {} });
            for (const [path, problem] of Object.entries(validateBlocks(blocks, types).errors)) problems.push(`theme.areas.${area}.blocks ${path} ${problem}`);
        }
    }
    if (value.author !== undefined) problems.push(...authorProblems(value.author));
    for (const key of ['logo', 'cover'] as const) {
        if (value[key] !== undefined && (typeof value[key] !== 'string' || !ARTWORK.test(value[key]))) problems.push(`${key} must name a PNG, JPEG, WebP, GIF, AVIF or SVG file in assets/, such as assets/${key}.png.`);
    }
    const commandNames = new Set<string>();
    for (const command of value.commands ?? []) {
        if (typeof command?.name !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(command.name) || commandNames.has(command.name)) problems.push(`commands: ${String(command?.name)} needs a unique lowercase name.`);
        commandNames.add(command?.name);
        if (typeof command?.description !== 'string' || !command.description) problems.push(`commands: ${String(command?.name)} needs a description.`);
        for (const [option, rule] of Object.entries(command?.options ?? {})) {
            if (!/^[a-z][a-z0-9-]{0,40}$/.test(option) || !['string', 'number', 'boolean'].includes(rule?.type)) problems.push(`commands: ${command.name} option ${option} needs a type of string, number or boolean.`);
        }
    }
    return problems;
}

export class ManifestError extends Error {
    readonly problems: readonly string[];
    constructor(problems: readonly string[]) {
        super(`Invalid plugin manifest: ${problems.join(' ')}`);
        this.name = 'ManifestError';
        this.problems = problems;
    }
}

export function validateManifest(manifest: unknown): CmsPluginManifest {
    const problems = manifestProblems(manifest);
    if (problems.length) throw new ManifestError(problems);
    return manifest as CmsPluginManifest;
}

/**
 * The grants a manifest requests, as stable strings: `resource:<id>:<action>`,
 * `network:<host>` and `hook:<point>`. An upgrade that adds one needs a new grant.
 */
export function requestedGrants(manifest: CmsPluginManifest): string[] {
    const grants: string[] = [];
    for (const [resource, actions] of Object.entries(manifest.permissions?.resources ?? {})) for (const action of actions) grants.push(`resource:${resource}:${action}`);
    for (const host of manifest.permissions?.network ?? []) grants.push(`network:${host}`);
    for (const hook of manifest.hooks ?? []) grants.push(`hook:${hook.point}`);
    for (const capability of CAPABILITIES) if (manifest.permissions?.[capability] === true) grants.push(`capability:${capability}`);
    for (const action of manifest.permissions?.users ?? []) grants.push(`users:${action}`);
    for (const secret of manifest.permissions?.secrets ?? []) grants.push(`secret:${secret}`);
    return [...new Set(grants)].sort();
}

/** Validate command input against a manifest command. Returns typed values or problems. */
export function commandInput(command: PluginCommand, input: { readonly [name: string]: unknown }): { values: { [name: string]: string | number | boolean }; problems: string[] } {
    const values: { [name: string]: string | number | boolean } = {};
    const problems: string[] = [];
    const options = command.options ?? {};
    for (const key of Object.keys(input)) if (!Object.hasOwn(options, key)) problems.push(`--${key} is not an option of ${command.name}.`);
    for (const [name, rule] of Object.entries(options)) {
        const raw = input[name];
        if (raw === undefined) { if (rule.required) problems.push(`--${name} is required.`); continue; }
        if (rule.type === 'boolean') values[name] = raw === true || raw === 'true';
        else if (rule.type === 'number') {
            const number = typeof raw === 'number' ? raw : Number(raw);
            if (!Number.isFinite(number)) problems.push(`--${name} must be a number.`);
            else values[name] = number;
        } else if (typeof raw === 'string' && raw.length <= 1000) values[name] = raw;
        else problems.push(`--${name} must be text.`);
    }
    return { values, problems };
}

const AUTHOR_KEYS = new Set(['name', 'url', 'email']);

function authorProblems(author: unknown): string[] {
    if (!author || typeof author !== 'object' || Array.isArray(author)) return ['author is an object: { "name": "Acme", "url": "https://acme.example", "email": "hello@acme.example" }.'];
    const { name, url, email } = author as Record<string, unknown>;
    const problems: string[] = [];
    for (const key of Object.keys(author)) if (!AUTHOR_KEYS.has(key)) problems.push(`author.${key} is not an author field (name, url, email).`);
    if (typeof name !== 'string' || !name.trim() || name.length > 120) problems.push('author.name is a name of at most 120 characters.');
    if (url !== undefined && (typeof url !== 'string' || !/^https?:\/\/[^\s]{1,300}$/.test(url))) problems.push('author.url is a web address starting with https://.');
    if (email !== undefined && (typeof email !== 'string' || email.length > 191 || !/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/.test(email))) problems.push('author.email is an email address, such as hello@acme.example.');
    return problems;
}
