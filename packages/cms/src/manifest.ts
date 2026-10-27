/**
 * The CMS fields of a plugin manifest (`cossack-plugin.json`), validated as data. A plugin
 * package never executes during installation; the host trusts what the manifest declares
 * only after this check, the policy lints and an administrator's grant.
 */
import { blockProblems, type BlockDeclaration } from './blocks';
import { collectionProblems, type CollectionDefinition } from './collections';
import { defineAction, defineFilter, type ExtensionPoint } from '@cossackframework/core/hooks';
import { EXTENSION_POINTS } from './hooks';
import { OWNER_NAME, resourceProblems, type ResourceAction, type ResourceDeclaration } from './resource';
import { themeProblems, type ThemeManifest } from './theme';

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

export interface CmsPluginManifest {
    readonly schemaVersion: 1;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    /** Who made the plugin, shown on its card: a name, with a website. */
    readonly author?: string;
    readonly authorUrl?: string;
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
    };
    readonly ui?: {
        /** Links shown in dashboard slots, such as `dashboard.nav`. */
        readonly slots?: { readonly [slot: string]: readonly SlotLink[] };
    };
    readonly commands?: readonly PluginCommand[];
    /** A site theme: its `templates/` files (or `ui.ts` `theme` export) are the site templates. */
    readonly theme?: ThemeManifest;
    /** A square image in the plugin's `assets/` directory, such as `assets/logo.png`. Default: `assets/logo.*`. */
    readonly logo?: string;
    /** A 4:3 image for the Plugins and Themes screens, such as `assets/cover.png`. Default: `assets/cover.*`. */
    readonly cover?: string;
    /** Rendered by `cossack add plugin`: the npm package the plugin came from. */
    readonly package?: string;
    readonly [field: string]: unknown;
}

/** Dashboard slots plugins can fill. Components come from the plugin's `ui.ts` `slots` export. */
export const HOST_SLOTS = Object.freeze(['dashboard.nav', 'dashboard.overview'] as const);
export type HostSlot = (typeof HOST_SLOTS)[number];

const KNOWN_FIELDS = new Set(['schemaVersion', 'name', 'version', 'description', 'author', 'authorUrl', 'compatibility', 'dependencies', 'resources', 'collections', 'blocks', 'hooks', 'permissions', 'ui', 'provides', 'commands', 'theme', 'logo', 'cover', 'package', 'source']);
const ARTWORK = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(?:png|jpe?g|webp|gif|avif|svg)$/;
const HOST = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$/;
const ACTIONS = new Set(['read', 'create', 'update', 'delete']);
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
    for (const [slot, links] of Object.entries(value.ui?.slots ?? {})) {
        if (!(HOST_SLOTS as readonly string[]).includes(slot)) problems.push(`ui.slots: ${slot} is not a host slot (${HOST_SLOTS.join(', ')}).`);
        for (const link of Array.isArray(links) ? links : []) {
            if (typeof link?.label !== 'string' || !link.label || link.label.length > 60) problems.push(`ui.slots.${slot}: links need a label.`);
            if (typeof link?.href !== 'string' || !link.href.startsWith('/') || link.href.startsWith('//')) problems.push(`ui.slots.${slot}: link ${String(link?.label)} needs a same-site path.`);
        }
    }
    if (value.theme !== undefined) problems.push(...themeProblems(value.theme));
    if (value.author !== undefined && (typeof value.author !== 'string' || !value.author.trim() || value.author.length > 120)) problems.push('author is a name of at most 120 characters.');
    if (value.authorUrl !== undefined && (typeof value.authorUrl !== 'string' || !/^https?:\/\/[^\s]{1,300}$/.test(value.authorUrl))) problems.push('authorUrl is a web address starting with https://.');
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
