/**
 * The CMS fields of a plugin manifest (`cossack-plugin.json`), validated as data. A plugin
 * package never executes during installation; the host trusts what the manifest declares
 * only after this check, the policy lints and an administrator's grant.
 */
import { blockProblems, type BlockDeclaration } from './blocks';
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
    readonly compatibility?: { readonly [pkg: string]: string };
    readonly dependencies?: { readonly [pkg: string]: string };
    readonly resources?: readonly ResourceDeclaration[];
    /** Block types named `<plugin>/<name>`; `ui.ts` renders them through its `blocks` export. */
    readonly blocks?: readonly BlockDeclaration[];
    /** Extension points the plugin's server code registers handlers for. */
    readonly hooks?: readonly { readonly point: string; readonly version: number }[];
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
    /** A site theme: its `ui.ts` exports `theme`, the templates. */
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

const KNOWN_FIELDS = new Set(['schemaVersion', 'name', 'version', 'description', 'compatibility', 'dependencies', 'resources', 'blocks', 'hooks', 'permissions', 'ui', 'commands', 'theme', 'logo', 'cover', 'package', 'source']);
const ARTWORK = /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(?:png|jpe?g|webp|gif|avif|svg)$/;
const HOST = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$/;
const ACTIONS = new Set(['read', 'create', 'update', 'delete']);

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
    const blockNames = new Set<string>();
    for (const [index, block] of (Array.isArray(value.blocks) ? value.blocks : value.blocks === undefined ? [] : [null]).entries()) {
        if (!block || typeof block !== 'object') { problems.push(`blocks[${index}] must be a block declaration.`); continue; }
        problems.push(...blockProblems(block, name));
        if (blockNames.has(block.name)) problems.push(`block ${block.name} is declared twice.`);
        blockNames.add(block.name);
    }
    const points = new Map(EXTENSION_POINTS.map(point => [point.name, point.version]));
    for (const hook of value.hooks ?? []) {
        if (!points.has(hook?.point)) problems.push(`hooks: ${String(hook?.point)} is not a CMS extension point.`);
        else if (hook.version !== points.get(hook.point)) problems.push(`hooks: ${hook.point} is version ${points.get(hook.point)}, not ${String(hook.version)}.`);
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
